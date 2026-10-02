// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {Test} from "forge-std/Test.sol";

import {DeployCore} from "script/DeployCore.s.sol";

/// @dev DeployCore with the environment hooks replaced, so the record logic can be tested without a node or files.
contract DeployCoreHarness is DeployCore {
    bool public anvil;
    bool public broadcasting;
    bool public mainnetRecordExists;
    string public runKind;
    bool public overwriteMainnet;

    uint256 public writes;
    string public writtenPath;
    string public writtenJson;

    function setAnvil(bool _v) external {
        anvil = _v;
    }

    function setBroadcasting(bool _v) external {
        broadcasting = _v;
    }

    function setMainnetRecordExists(bool _v) external {
        mainnetRecordExists = _v;
    }

    function setRunKind(string memory _v) external {
        runKind = _v;
    }

    function setOverwriteMainnet(bool _v) external {
        overwriteMainnet = _v;
    }

    function _runKind() internal view override returns (string memory) {
        return runKind;
    }

    function _overwriteMainnetRecord() internal view override returns (bool) {
        return overwriteMainnet;
    }

    function _isAnvil() internal view override returns (bool) {
        return anvil;
    }

    function _isBroadcasting() internal view override returns (bool) {
        return broadcasting;
    }

    function _chainBlockNumber() internal pure override returns (uint256) {
        return 4242;
    }

    function _recordIsMainnet(string memory) internal view override returns (bool) {
        return mainnetRecordExists;
    }

    function _writeRecord(string memory _path, string memory _json) internal override {
        writes++;
        writtenPath = _path;
        writtenJson = _json;
    }

    // exposed internals

    function decide(string memory _runKind, bool _anvil, bool _broadcasting) external pure returns (uint8) {
        return uint8(decideRecordAction(_runKind, _anvil, _broadcasting));
    }

    function preflightExt(string memory _chain) external {
        preflight(_chain);
    }

    function write(string memory _chain) external {
        Cfg memory c;
        c.chain = _chain;
        c.denominationSymbol = "USDC";
        c.denominationAsset = address(0xdead);
        c.staleRateThreshold = 172800;
        Persistent memory p;
        p.dispatcher = address(0x1111);
        Release memory r;
        r.integrationManager = address(0x2222);
        writeDeployment(c, p, r);
    }

    function knownMainnet(uint256 _chainId) external returns (bool) {
        return isKnownMainnet(_chainId);
    }
}

/// @dev Unmodified file hooks, to prove foundry.toml's narrowed fs_permissions still cover what the script needs
contract DeployCoreFs is DeployCore {
    function recordIsMainnet(string memory _path) external returns (bool) {
        return _recordIsMainnet(_path);
    }
}

contract DeployCoreRecordsTest is Test {
    // keep in sync with DeployCore.RecordAction
    uint8 internal constant NONE = 0;
    uint8 internal constant FORK = 1;
    uint8 internal constant SIMULATION_ONLY = 2;
    uint8 internal constant PENDING_BROADCAST = 3;

    string internal constant ERR_BROADCAST_NEEDS_RUN_KIND =
        "DeployCore: --broadcast on a non-Anvil node requires RUN_KIND=broadcast";
    string internal constant ERR_ANVIL_MISMATCH =
        "DeployCore: RUN_KIND=fork needs an Anvil node; broadcast must not be one";
    string internal constant ERR_MAINNET_RECORD =
        "DeployCore: deployments/<chain>.json is a mainnet record and will not be overwritten";

    DeployCoreHarness internal h;

    function setUp() public {
        h = new DeployCoreHarness();
        h.setRunKind("");
        vm.setEnv("FORK_BLOCK", "123");
        vm.setEnv("GIT_SHA", "deadbeef");
    }

    // 3. RUN_KIND vs --broadcast vs node type

    function test_decide_noRunKind() public {
        assertEq(h.decide("", true, false), NONE);
        assertEq(h.decide("", true, true), NONE); // --broadcast to a local Anvil without a record is harmless
        assertEq(h.decide("", false, false), NONE); // plain simulation on a live node
    }

    function test_decide_broadcastOnLiveNodeWithoutRunKindReverts() public {
        vm.expectRevert(bytes(ERR_BROADCAST_NEEDS_RUN_KIND));
        h.decide("", false, true);
    }

    function test_decide_fork() public {
        assertEq(h.decide("fork", true, false), FORK);
        assertEq(h.decide("fork", true, true), FORK);

        vm.expectRevert(bytes(ERR_ANVIL_MISMATCH));
        h.decide("fork", false, false);
        vm.expectRevert(bytes(ERR_ANVIL_MISMATCH));
        h.decide("fork", false, true);
    }

    function test_decide_broadcast() public {
        assertEq(h.decide("broadcast", false, false), SIMULATION_ONLY);
        assertEq(h.decide("broadcast", false, true), PENDING_BROADCAST);

        vm.expectRevert(bytes(ERR_ANVIL_MISMATCH));
        h.decide("broadcast", true, false);
        vm.expectRevert(bytes(ERR_ANVIL_MISMATCH));
        h.decide("broadcast", true, true);
    }

    function test_decide_unknownRunKindReverts() public {
        vm.expectRevert("DeployCore: RUN_KIND must be fork|broadcast");
        h.decide("mainnet", false, true);
    }

    function test_preflight_revertsBeforeDeployingWhenInconsistent() public {
        h.setAnvil(false);
        h.setBroadcasting(true);
        vm.expectRevert(bytes(ERR_BROADCAST_NEEDS_RUN_KIND));
        h.preflightExt("base");

        h.setRunKind("fork");
        vm.expectRevert(bytes(ERR_ANVIL_MISMATCH));
        h.preflightExt("base");
    }

    // 1. A simulation never produces a mainnet record

    function test_write_broadcastSimulationOnLiveNodeWritesNothing() public {
        vm.chainId(8453);
        h.setRunKind("broadcast");
        h.setAnvil(false);
        h.setBroadcasting(false);

        h.write("base");

        assertEq(h.writes(), 0, "a simulation must not write a record");
    }

    function test_write_broadcastOnLiveNodeWritesOnlyAPendingNonMainnetRecord() public {
        vm.chainId(8453);
        h.setRunKind("broadcast");
        h.setAnvil(false);
        h.setBroadcasting(true);

        h.write("base");

        assertEq(h.writes(), 1);
        assertEq(h.writtenPath(), "deployments/base.pending.json");
        string memory json = h.writtenJson();
        assertFalse(vm.parseJsonBool(json, ".mainnet"), "pending record must never say mainnet: true");
        assertTrue(vm.parseJsonBool(json, ".simulated"));
        assertTrue(vm.parseJsonBool(json, ".pendingBroadcast"));
        assertEq(vm.parseJsonString(json, ".kind"), "mainnet broadcast (PENDING receipt confirmation)");
        assertEq(vm.parseJsonUint(json, ".chainId"), 8453);
    }

    // 2. Chain id allowlist

    function test_write_pendingOnUnknownNetworkIsNotLabelledMainnet() public {
        vm.chainId(11155111); // Sepolia
        h.setRunKind("broadcast");
        h.setAnvil(false);
        h.setBroadcasting(true);

        h.write("base");

        string memory json = h.writtenJson();
        assertFalse(vm.parseJsonBool(json, ".mainnet"));
        assertEq(vm.parseJsonString(json, ".kind"), "testnet or unknown network (PENDING receipt confirmation)");
    }

    function test_knownMainnetAllowlist() public {
        assertTrue(h.knownMainnet(1));
        assertTrue(h.knownMainnet(8453));
        assertTrue(h.knownMainnet(42161));
        assertTrue(h.knownMainnet(4663));
        assertFalse(h.knownMainnet(999), "HyperEVM is not added yet");
        assertFalse(h.knownMainnet(11155111));
        assertFalse(h.knownMainnet(31337));
        assertFalse(h.knownMainnet(84532));
    }

    // Fork records keep their schema (kind / mainnet / forkBlock / chainId / scriptCommit / denominationAsset)

    function test_write_forkRecordSchema() public {
        vm.chainId(8453);
        h.setRunKind("fork");
        h.setAnvil(true);
        h.setBroadcasting(false);

        h.write("base");

        assertEq(h.writtenPath(), "deployments/base.json");
        string memory json = h.writtenJson();
        assertEq(vm.parseJsonString(json, ".kind"), "fork, not mainnet");
        assertFalse(vm.parseJsonBool(json, ".mainnet"));
        assertTrue(vm.parseJsonBool(json, ".simulated"));
        assertEq(vm.parseJsonUint(json, ".forkBlock"), 123);
        assertEq(vm.parseJsonUint(json, ".chainId"), 8453);
        assertEq(vm.parseJsonUint(json, ".blockNumberAtDeploy"), 4242);
        assertEq(vm.parseJsonString(json, ".scriptCommit"), "deadbeef");
        assertEq(vm.parseJsonString(json, ".denominationAsset.symbol"), "USDC");
        assertEq(vm.parseJsonAddress(json, ".denominationAsset.address"), address(0xdead));
        assertEq(vm.parseJsonAddress(json, ".addresses.integrationManager"), address(0x2222));
        assertTrue(
            keccak256(bytes(vm.parseJsonString(json, ".label"))) != keccak256("REAL BROADCAST DEPLOYMENT"), "label"
        );
    }

    function test_write_forkBroadcastToAnvilIsNotSimulated() public {
        vm.chainId(8453);
        h.setRunKind("fork");
        h.setAnvil(true);
        h.setBroadcasting(true);

        h.write("base");

        string memory json = h.writtenJson();
        assertFalse(vm.parseJsonBool(json, ".simulated"));
        assertFalse(vm.parseJsonBool(json, ".mainnet"));
        assertEq(vm.parseJsonString(json, ".kind"), "fork, not mainnet");
    }

    // 3. Never overwrite a mainnet record (enforced in the script itself)

    function test_noOverwrite_forkRunRefuses() public {
        vm.chainId(8453);
        h.setRunKind("fork");
        h.setAnvil(true);
        h.setMainnetRecordExists(true);

        vm.expectRevert(bytes(ERR_MAINNET_RECORD));
        h.preflightExt("base");
        vm.expectRevert(bytes(ERR_MAINNET_RECORD));
        h.write("base");
        assertEq(h.writes(), 0);
    }

    function test_noOverwrite_pendingRefusesUnlessExplicitlyAllowed() public {
        vm.chainId(8453);
        h.setRunKind("broadcast");
        h.setAnvil(false);
        h.setBroadcasting(true);
        h.setMainnetRecordExists(true);

        vm.expectRevert(bytes(ERR_MAINNET_RECORD));
        h.preflightExt("base");
        vm.expectRevert(bytes(ERR_MAINNET_RECORD));
        h.write("base");

        h.setOverwriteMainnet(true);
        h.preflightExt("base");
        h.write("base");
        assertEq(h.writes(), 1);
        assertFalse(vm.parseJsonBool(h.writtenJson(), ".mainnet"));
    }

    // 4. The narrowed fs_permissions still allow the script's own file access

    function test_fsPermissions_scriptCanReadRecordsAndMissingFilesAreNotMainnet() public {
        DeployCoreFs fs = new DeployCoreFs();
        assertFalse(fs.recordIsMainnet("deployments/ethereum.json"), "committed fork record is not mainnet");
        assertFalse(fs.recordIsMainnet("deployments/base.pending.json"), "missing file is not mainnet");
    }
}
