// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @title LastLight
/// @notice Post-quantum crypto inheritance vaults on the QoreChain EVM.
///
/// An owner seals a secret for an heir. All encryption happens in the owner's
/// browser with ML-KEM-1024 (see packages/crypto); this contract never sees
/// anything readable. It only:
///   - records who the owner, heir and guardians are,
///   - tracks the owner's check-ins,
///   - decides when the vault is released (a missed check-in),
///   - accepts guardian handoffs only after release.
///
/// The encrypted pieces (about 8 KB per vault) are published in events rather
/// than storage, which keeps sealing cheap. The contract stores a hash of them
/// so the app can check that what it read from the logs is what was sealed.
contract LastLight {
    uint8 public constant MAX_GUARDIANS = 5;
    uint64 public constant MIN_PERIOD = 5 minutes;
    uint64 public constant MAX_PERIOD = 3650 days;
    /// @dev 12-byte nonce + 1024-byte padded secret + 16-byte tag (packages/crypto vault.ts).
    uint256 public constant ENCRYPTED_SECRET_SIZE = 1052;
    /// @dev 1-byte version + 1568-byte ML-KEM-1024 ciphertext + 12-byte nonce + 16-byte tag, plus payload.
    uint256 public constant MIN_ENVELOPE_SIZE = 1597;
    uint256 public constant MAX_ENVELOPE_SIZE = 4096;

    struct Vault {
        address owner;
        uint64 period;
        uint64 lastCheckIn;
        uint8 threshold;
        uint8 handoffCount;
        bool cancelled;
        address heir;
        bytes32 sealedHash;
        address[] guardians;
    }

    /// @notice For accounts whose native (qor1) and EVM (0x) sides use different keys, as QoreX's
    ///         classic accounts do: the native address where this EVM account published its
    ///         ML-KEM-1024 key. Set by the EVM account itself. A false claim only makes pieces be
    ///         encrypted to someone else's key, which the claimer then cannot open.
    mapping(address => string) public nativeAddressOf;

    mapping(uint256 => Vault) private vaults;
    mapping(address => uint256) public nonces;
    mapping(uint256 => mapping(address => bool)) public handedOff;
    /// @dev Every vault an address takes part in, as owner, heir or guardian.
    mapping(address => uint256[]) private involvement;

    event VaultCreated(
        uint256 indexed id,
        address indexed owner,
        address indexed heir,
        address[] guardians,
        uint8 threshold,
        uint64 period
    );
    event VaultSealed(uint256 indexed id, bytes encryptedSecret, bytes heirEnvelope, bytes[] guardianEnvelopes);
    event CheckedIn(uint256 indexed id, uint64 at, uint64 releaseAt);
    event Cancelled(uint256 indexed id);
    event Handoff(uint256 indexed id, address indexed guardian, bytes envelope, uint8 handoffCount);
    event NativeLinked(address indexed account, string nativeAddress);

    error NotOwner();
    error NotGuardian();
    error UnknownVault();
    error BadPeriod();
    error BadThreshold();
    error BadParty();
    error BadCiphertext();
    error VaultReleased();
    error NotReleased();
    error VaultCancelled();
    error AlreadyHandedOff();
    error BadNativeAddress();

    /// @notice Record the native qor1 address that holds this account's ML-KEM-1024 key.
    function linkNative(string calldata nativeAddress) external {
        bytes calldata b = bytes(nativeAddress);
        if (b.length < 39 || b.length > 90 || b[0] != "q" || b[1] != "o" || b[2] != "r" || b[3] != "1") {
            revert BadNativeAddress();
        }
        nativeAddressOf[msg.sender] = nativeAddress;
        emit NativeLinked(msg.sender, nativeAddress);
    }

    /// @notice The id the owner's next vault will get. The browser needs it before
    ///         sealing, because every envelope is bound to its vault id.
    function nextVaultId(address owner) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), owner, nonces[owner])));
    }

    /// @notice Seal a new vault. The id is `nextVaultId(msg.sender)` at the time of the call.
    function createVault(
        address heir,
        address[] calldata guardians,
        uint8 threshold,
        uint64 period,
        bytes calldata encryptedSecret,
        bytes calldata heirEnvelope,
        bytes[] calldata guardianEnvelopes
    ) external returns (uint256 id) {
        if (period < MIN_PERIOD || period > MAX_PERIOD) revert BadPeriod();
        uint256 n = guardians.length;
        if (n == 0 || n > MAX_GUARDIANS || threshold == 0 || threshold > n) revert BadThreshold();
        if (guardianEnvelopes.length != n) revert BadCiphertext();
        if (heir == address(0) || heir == msg.sender) revert BadParty();
        for (uint256 i = 0; i < n; i++) {
            address g = guardians[i];
            if (g == address(0) || g == msg.sender || g == heir) revert BadParty();
            for (uint256 j = 0; j < i; j++) if (guardians[j] == g) revert BadParty();
            _checkEnvelope(guardianEnvelopes[i]);
        }
        if (encryptedSecret.length != ENCRYPTED_SECRET_SIZE) revert BadCiphertext();
        _checkEnvelope(heirEnvelope);

        id = nextVaultId(msg.sender);
        nonces[msg.sender]++;

        Vault storage v = vaults[id];
        v.owner = msg.sender;
        v.heir = heir;
        v.guardians = guardians;
        v.threshold = threshold;
        v.period = period;
        v.lastCheckIn = uint64(block.timestamp);
        v.sealedHash = keccak256(abi.encode(encryptedSecret, heirEnvelope, guardianEnvelopes));

        involvement[msg.sender].push(id);
        involvement[heir].push(id);
        for (uint256 i = 0; i < n; i++) involvement[guardians[i]].push(id);

        emit VaultCreated(id, msg.sender, heir, guardians, threshold, period);
        emit VaultSealed(id, encryptedSecret, heirEnvelope, guardianEnvelopes);
        emit CheckedIn(id, uint64(block.timestamp), uint64(block.timestamp) + period);
    }

    /// @notice "I'm still here." Pushes the release time out by one period.
    function checkIn(uint256 id) external {
        Vault storage v = _vault(id);
        if (msg.sender != v.owner) revert NotOwner();
        if (v.cancelled) revert VaultCancelled();
        if (_released(v)) revert VaultReleased();
        v.lastCheckIn = uint64(block.timestamp);
        emit CheckedIn(id, uint64(block.timestamp), uint64(block.timestamp) + v.period);
    }

    /// @notice Close a vault before release, e.g. to change heir or guardians.
    ///         The encrypted pieces stay in the chain's history, so after cancelling
    ///         the owner should move funds to a new wallet before sealing a new vault.
    function cancel(uint256 id) external {
        Vault storage v = _vault(id);
        if (msg.sender != v.owner) revert NotOwner();
        if (v.cancelled) revert VaultCancelled();
        if (_released(v)) revert VaultReleased();
        v.cancelled = true;
        emit Cancelled(id);
    }

    /// @notice A guardian passes their share to the heir, sealed to the heir's ML-KEM key.
    ///         Accepted only after release, once per guardian.
    function submitHandoff(uint256 id, bytes calldata envelope) external {
        Vault storage v = _vault(id);
        if (v.cancelled) revert VaultCancelled();
        if (!_released(v)) revert NotReleased();
        if (!_isGuardian(v, msg.sender)) revert NotGuardian();
        if (handedOff[id][msg.sender]) revert AlreadyHandedOff();
        _checkEnvelope(envelope);
        handedOff[id][msg.sender] = true;
        v.handoffCount++;
        emit Handoff(id, msg.sender, envelope, v.handoffCount);
    }

    // ---- views ----

    function getVault(uint256 id) external view returns (Vault memory) {
        return _vault(id);
    }

    function isReleased(uint256 id) external view returns (bool) {
        return _released(_vault(id));
    }

    function releaseAt(uint256 id) external view returns (uint64) {
        Vault storage v = _vault(id);
        return v.lastCheckIn + v.period;
    }

    /// @notice True once enough guardians have handed off for the heir to open the vault.
    function isOpenable(uint256 id) external view returns (bool) {
        Vault storage v = _vault(id);
        return _released(v) && v.handoffCount >= v.threshold;
    }

    function vaultsOf(address who) external view returns (uint256[] memory) {
        return involvement[who];
    }

    // ---- internal ----

    function _vault(uint256 id) private view returns (Vault storage v) {
        v = vaults[id];
        if (v.owner == address(0)) revert UnknownVault();
    }

    function _released(Vault storage v) private view returns (bool) {
        return !v.cancelled && block.timestamp > uint256(v.lastCheckIn) + v.period;
    }

    function _isGuardian(Vault storage v, address who) private view returns (bool) {
        for (uint256 i = 0; i < v.guardians.length; i++) if (v.guardians[i] == who) return true;
        return false;
    }

    function _checkEnvelope(bytes calldata e) private pure {
        if (e.length < MIN_ENVELOPE_SIZE || e.length > MAX_ENVELOPE_SIZE || e[0] != 0x01) revert BadCiphertext();
    }
}
