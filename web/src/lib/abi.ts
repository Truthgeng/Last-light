// Generated from contracts/artifacts (LastLight.sol). Rebuild with: pnpm --dir ../contracts build
export const lastLightAbi = [
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "requirePqcKey_",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyHandedOff",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadCiphertext",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadNativeAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadParty",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadPeriod",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadThreshold",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoPqcKey",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotGuardian",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotReleased",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnknownVault",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VaultCancelled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VaultReleased",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "Cancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "at",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "releaseAt",
        "type": "uint64"
      }
    ],
    "name": "CheckedIn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "guardian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "envelope",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "handoffCount",
        "type": "uint8"
      }
    ],
    "name": "Handoff",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "nativeAddress",
        "type": "string"
      }
    ],
    "name": "NativeLinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "registered",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "algorithmId",
        "type": "uint8"
      }
    ],
    "name": "PqcKeyChecked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "heir",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "guardians",
        "type": "address[]"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "threshold",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "period",
        "type": "uint64"
      }
    ],
    "name": "VaultCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "encryptedSecret",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "heirEnvelope",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "bytes[]",
        "name": "guardianEnvelopes",
        "type": "bytes[]"
      }
    ],
    "name": "VaultSealed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "ENCRYPTED_SECRET_SIZE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_ENVELOPE_SIZE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_GUARDIANS",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_PERIOD",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_ENVELOPE_SIZE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_PERIOD",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "PQC_KEY_STATUS",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "cancel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "checkIn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "heir",
        "type": "address"
      },
      {
        "internalType": "address[]",
        "name": "guardians",
        "type": "address[]"
      },
      {
        "internalType": "uint8",
        "name": "threshold",
        "type": "uint8"
      },
      {
        "internalType": "uint64",
        "name": "period",
        "type": "uint64"
      },
      {
        "internalType": "bytes",
        "name": "encryptedSecret",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "heirEnvelope",
        "type": "bytes"
      },
      {
        "internalType": "bytes[]",
        "name": "guardianEnvelopes",
        "type": "bytes[]"
      }
    ],
    "name": "createVault",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getVault",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "period",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "lastCheckIn",
            "type": "uint64"
          },
          {
            "internalType": "uint8",
            "name": "threshold",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "handoffCount",
            "type": "uint8"
          },
          {
            "internalType": "bool",
            "name": "cancelled",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "heir",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "sealedHash",
            "type": "bytes32"
          },
          {
            "internalType": "address[]",
            "name": "guardians",
            "type": "address[]"
          }
        ],
        "internalType": "struct LastLight.Vault",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "handedOff",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "isOpenable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "isReleased",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "nativeAddress",
        "type": "string"
      }
    ],
    "name": "linkNative",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "nativeAddressOf",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "nextVaultId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "nonces",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "pqcKeyOf",
    "outputs": [
      {
        "internalType": "bool",
        "name": "registered",
        "type": "bool"
      },
      {
        "internalType": "uint8",
        "name": "algorithmId",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "releaseAt",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "requirePqcKey",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "envelope",
        "type": "bytes"
      }
    ],
    "name": "submitHandoff",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "who",
        "type": "address"
      }
    ],
    "name": "vaultsOf",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
