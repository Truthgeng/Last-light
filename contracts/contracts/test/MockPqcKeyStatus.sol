// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @dev Test stand-in for QoreChain's PQC key status precompile. Its runtime code is
///      placed at 0x...0A02 in tests, so storage set through that address is its own.
contract MockPqcKeyStatus {
    mapping(address => bool) public registered;

    function set(address account, bool value) external {
        registered[account] = value;
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory) {
        if (registered[account]) return (true, 3, hex"01");
        return (false, 0, new bytes(0));
    }
}
