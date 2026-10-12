"""HF1 transport/process adversaries; no installed engine, SIESTA or Slurm."""
import copy
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
import unittest.mock
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

from dftlab_platform.domain import Problem
from dftlab_platform.hf1_bundle import CONTROLLER_TARGETS, inspect_bundle, materialize_bundle, profile_findings
from dftlab_platform import hf1_controller_entry
from dftlab_platform.hf1_capability import CAPABILITY, CONTROLLER_RESERVATION, HubbardFlowCampaignCapability, controller_profile_findings
from dftlab_platform.hf1_children import OwnedLinuxChildren


class HF1(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.profile = {"target": "slurm", "allocation": {"nodes": 1, "total_cpus": 8, "max_parallel_steps": 1}, "runtime": {"launcher": {"kind": "openmpi", "processes_per_node": 4}}}
        self.files = {"profile.json": json.dumps(self.profile).encode(), "lr.json": b'{"scientific_policy":"opaque-original","alpha_grid":[-0.04,0.04]}', "reference.fdf": b"# original native input\n", "contract.json": b'{}'}
        self.manifest = {"schema": "siestaflow.campaign.v2", "campaign_id": "synthetic-inner", "execution_profile_file": "profile.json", "lr_config_file": "lr.json", "reference_fdf": "reference.fdf", "contract_file": "contract.json"}
        self.archive = self.root/"inputs.zip"
        self.write()
        self.hf = SimpleNamespace(ApiOperation=SimpleNamespace(WORKER_STATUS="worker_status"))
        class Receipt:
            def __init__(self, value):
                self.value = copy.deepcopy(value)
                self.operation, self.native_status = value["operation"], value["native_status"]
            def to_mapping(self):
                return copy.deepcopy(self.value)
            @classmethod
            def from_mapping(cls, value):
                if value["schema"] != "hubbardflow.api_result.v1" or value["assessment"] != "NOT_ESTABLISHED":
                    raise ValueError("synthetic native receipt refused")
                return cls(value)
        self.hf.ApiResult = Receipt
        self.engines = SimpleNamespace(hubbardflow=self.hf)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, extra=None):
        manifest = copy.deepcopy(self.manifest)
        manifest["input_files"] = [{"path": name, "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in self.files.items()]
        with ZipFile(self.archive, "w") as archive:
            for name, raw in self.files.items():
                archive.writestr(name, raw)
            archive.writestr("campaign.v2.json", json.dumps(manifest))
            if extra:
                archive.writestr(*extra)
        self.sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.profile_sha = hashlib.sha256(self.files["profile.json"]).hexdigest()

    def inspect(self, reserved_cpus=8):
        return inspect_bundle(self.archive, expected_sha256=self.sha, expected_profile_sha256=self.profile_sha, reserved_cpus=reserved_cpus)

    def staged(self, attempt):
        # QRAFT copies every declared input into the attempt directory first.
        target = attempt/"campaign.bundle.zip"
        target.write_bytes(self.archive.read_bytes())
        return target

    def capability(self):
        return HubbardFlowCampaignCapability(self.engines, self.root, run_id="synthetic-outer", bundle_sha256=self.sha, profile_sha256=self.profile_sha, reserved_cpus=8, max_seconds=60)

    def controller_capability(self):
        self.profile["allocation"]["total_cpus"] = 4
        self.files["profile.json"] = json.dumps(self.profile).encode()
        self.write()
        return HubbardFlowCampaignCapability(self.engines, self.root, run_id="synthetic-controller", bundle_sha256=self.sha, profile_sha256=self.profile_sha, reserved_cpus=4, max_seconds=3600)

    def prepared_capability(self):
        capability = self.capability()
        workspace = self.root/"attempt-0001"
        workspace.mkdir()
        capability.prepare_task(self.inspect(), workspace, task_id="hubbard", attempt_id="attempt-0001", inputs={"input": self.archive})
        return capability

    def marker(self):
        return {"schema_version": 1, "kind": "dftlab.hf1.worker-result", "outer_run_id": "synthetic-outer", "bundle_sha256": self.sha, "campaign_id": "synthetic-inner", "task_id": "hubbard", "attempt_id": "attempt-0001", "scientific_assessment": "NOT_ESTABLISHED", "quantity_kind": "U_scalar_charge", "exit_code": 0, "cancel_requested": False, "local_children_closed": True, "orphan_observed": False,
                "native_worker_receipt": {"schema": "hubbardflow.api_result.v1", "operation": "worker_status", "native_status": "COMPLETED", "assessment": "NOT_ESTABLISHED", "payload": {"campaign_id": "synthetic-inner"}}}

    def test_original_bytes_materialize_in_new_namespace_without_mutating_archive(self):
        original = self.archive.read_bytes()
        inspected = self.inspect()
        destination = self.root/"native"
        materialize_bundle(inspected, destination)
        for name, raw in inspected.files:
            self.assertEqual((destination/name).read_bytes(), raw)
        self.assertEqual(self.archive.read_bytes(), original)
        with self.assertRaises(FileExistsError):
            materialize_bundle(inspected, destination)

    def test_traversal_reserved_names_symlink_duplicates_and_undeclared_seed_rejected(self):
        link = ZipInfo("bad-link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for extra in (("../escape", b"no"), ("NUL", b"no"), ("trailing.", b"no"), ("a\\b", b"no"), ("reference.fdf", b"duplicate"), ("old.DM", b"undeclared"), (link, b"/tmp/elsewhere")):
            with self.subTest(extra=extra):
                self.write(extra)
                with self.assertRaises(Problem):
                    self.inspect()
        self.assertFalse((self.root.parent/"escape").exists())

    def test_operator_profile_binding_cpu_capacity_and_direct_manifest_required(self):
        for profile in ({**self.profile, "target": "local_wsl"}, {**self.profile, "allocation": {"nodes": 2, "total_cpus": 8, "max_parallel_steps": 1}}, {**self.profile, "allocation": {"nodes": 1, "total_cpus": 4, "max_parallel_steps": 1}}, {**self.profile, "runtime": {"launcher": {"kind": "openmpi", "processes_per_node": 9}}}):
            self.files["profile.json"] = json.dumps(profile).encode()
            self.write()
            with self.assertRaises(Problem):
                self.inspect()
        self.files["profile.json"] = json.dumps(self.profile).encode()
        self.write()
        with self.assertRaises(Problem):
            inspect_bundle(self.archive, expected_sha256=self.sha, expected_profile_sha256="0"*64, reserved_cpus=8)
        self.manifest["schema"] = "hubbardflow.wsl.pointer"
        self.write()
        with self.assertRaises(Problem):
            self.inspect()

    def test_bounds_and_original_hashes_reject_before_extraction(self):
        with patch("dftlab_platform.hf1_bundle.MAX_ARCHIVE", 1), self.assertRaises(Problem):
            self.inspect()
        with patch("dftlab_platform.hf1_bundle.MAX_BYTES", 1), self.assertRaises(Problem):
            self.inspect()
        with patch("dftlab_platform.hf1_bundle.MAX_FILES", 1), self.assertRaises(Problem):
            self.inspect()
        self.archive.write_bytes(self.archive.read_bytes()+b"changed")
        with self.assertRaises(Problem):
            self.inspect()

    def test_invalid_native_paths_and_file_ancestor_collision_rejected(self):
        for field in ("execution_profile_file", "lr_config_file", "reference_fdf", "contract_file"):
            original = self.manifest[field]
            self.manifest[field] = ["unexpected"]
            self.write()
            with self.assertRaises(Problem):
                self.inspect()
            self.manifest[field] = original
        self.files["reference.fdf/child"] = b"invalid ancestor"
        self.write()
        with self.assertRaises(Problem):
            self.inspect()

    @unittest.skipUnless(sys.platform.startswith("linux"), "Dedicated bridge containment is Linux/WSL only")
    def test_installed_bridge_records_completed_fixture_and_closes_local_namespace(self):
        self.bridge_fixture(cancel=False)

    @unittest.skipUnless(sys.platform.startswith("linux"), "Dedicated bridge containment is Linux/WSL only")
    def test_installed_bridge_cancel_closes_detached_grandchild_preserving_unknown_science(self):
        self.bridge_fixture(cancel=True)

    def bridge_fixture(self, *, cancel):
        # Inject only a synthetic Python CLI transport inside the dedicated
        # installed host. Never import/run a native engine in tests or CI.
        root = self.root/"fixture-attempt"
        root.mkdir()
        materialize_bundle(self.inspect(), root/"hf1")
        request = {"schema_version": 1, "outer_run_id": "synthetic-outer", "task_id": "hubbard", "attempt_id": "attempt-0001", "bundle": str(self.archive), "bundle_sha256": self.sha,
                   "profile_sha256": self.profile_sha, "reserved_cpus": 8, "wheelhouse": str(self.root), "max_seconds": 10, "grace_seconds": 1, "campaign_id": "synthetic-inner"}
        request_path = root/"request.json"
        request_path.write_text(json.dumps(request))
        # Fake run deliberately leaves a detached grandchild on cancel. The
        # subreaper must contain it; process-group killing alone is insufficient.
        completed = "from pathlib import Path;import json;Path('.siestaflow').mkdir();Path('.siestaflow/worker-state.json').write_text(json.dumps({'campaign_id':'synthetic-inner','status':'COMPLETED'}))"
        running = "from pathlib import Path;import json,subprocess,sys,time;Path('.siestaflow').mkdir();Path('.siestaflow/worker-state.json').write_text(json.dumps({'campaign_id':'synthetic-inner','status':'RUNNING'}));p=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(60)'],start_new_session=True);Path('detached.pid').write_text(str(p.pid));time.sleep(60)"
        code = """
import os,subprocess,sys
from types import SimpleNamespace
from dftlab_platform import hf1_worker as module
saved=subprocess.Popen
def fake(argv,**kwargs):
    command=%r if argv[4]=='run' else "print('synthetic stop request only')"
    return saved([sys.executable,'-I','-c',command],**kwargs)
api=SimpleNamespace(worker_status=lambda request:SimpleNamespace(to_mapping=lambda:{'schema':'hubbardflow.api_result.v1','operation':'worker_status','native_status':request['snapshot']['status'],'assessment':'NOT_ESTABLISHED','payload':request['snapshot']}))
module.PinnedEngines=lambda path:SimpleNamespace(evidence={'synthetic':'not a motor'},hubbardflow=api)
module.subprocess.Popen=fake
os.environ['SLURM_JOB_ID']='synthetic'.replace('synthetic','1234')
raise SystemExit(module.run(sys.argv[1]))
""" % (running if cancel else completed)
        process = subprocess.Popen([sys.executable, "-I", "-c", code, str(request_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            if cancel:
                import signal
                import time
                deadline = time.monotonic()+10
                while not (root/"hf1/detached.pid").exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue((root/"hf1/detached.pid").exists())
                detached = int((root/"hf1/detached.pid").read_text())
                process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 130 if cancel else 0, stderr)
            marker = json.loads(stdout)
            self.assertTrue(marker["local_children_closed"])
            self.assertEqual(marker["scientific_assessment"], "NOT_ESTABLISHED")
            self.assertEqual(marker["quantity_kind"], "U_scalar_charge")
            self.assertEqual(marker["native_worker_receipt"]["native_status"], "RUNNING" if cancel else "COMPLETED")
            self.assertEqual(marker["cancel_requested"], cancel)
            self.assertEqual(marker["bundle_sha256"], self.sha)
            if cancel:
                self.assertFalse(Path('/proc', str(detached)).exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)

    def test_one_controller_process_reserves_inner_capacity_without_mpi_or_shell(self):
        capability = self.capability()
        workspace = self.root/"attempt-0001"
        workspace.mkdir()
        request = capability.prepare_task(self.inspect(), workspace, task_id="hubbard", attempt_id="attempt-0001", inputs={"input": self.archive})
        spec = SimpleNamespace(launcher="direct", mpi_ranks=1, allocated_cpus=8)
        command = capability.build_command(request, execution_spec=spec)
        self.assertEqual(command, (sys.executable, "-I", "-m", "dftlab_platform.hf1_worker", str(request)))
        self.assertEqual(json.loads(request.read_bytes())["campaign_id"], "synthetic-inner")
        for bad in (SimpleNamespace(launcher="openmpi", mpi_ranks=1, allocated_cpus=8), SimpleNamespace(launcher="direct", mpi_ranks=4, allocated_cpus=8), SimpleNamespace(launcher="direct", mpi_ranks=1, allocated_cpus=4)):
            with self.assertRaises(Problem):
                capability.build_command(request, execution_spec=bad)

    def test_native_success_preserves_nonestablishment_and_scalar_semantics(self):
        capability = self.prepared_capability()
        original = self.marker()
        parsed = capability.parse_output([json.dumps(original)])
        classified = capability.classify_result(parsed)
        self.assertEqual(classified.status, "PASS")
        self.assertEqual(classified.native_worker_receipt, original["native_worker_receipt"])
        self.assertEqual(classified.scientific_assessment, "NOT_ESTABLISHED")
        self.assertEqual(classified.quantity_kind, "U_scalar_charge")

    def test_exit_zero_unknown_status_cancel_or_orphan_never_become_success(self):
        capability = self.prepared_capability()
        for change in ({"native_worker_receipt": None}, {"local_children_closed": False}, {"orphan_observed": True}, {"cancel_requested": True}, {"exit_code": True}):
            marker = self.marker()
            marker.update(change)
            self.assertNotEqual(capability.classify_result(marker).status, "PASS")
        for status in ("FUTURE_SUCCESS", "RUNNING", "STOPPED", "FAILED"):
            marker = self.marker()
            marker["native_worker_receipt"]["native_status"] = status
            self.assertNotEqual(capability.classify_result(marker).status, "PASS")
        self.assertEqual(capability.classify_result(None).status, "REVIEW")

    def test_wrong_run_receipt_and_effective_parameter_cannot_be_projected(self):
        capability = self.prepared_capability()
        for update in ({"task_id": "foreign"}, {"attempt_id": "foreign"}, {"campaign_id": "foreign"}, {"outer_run_id": "wrong"}, {"quantity_kind": "U_eff"}, {"scientific_assessment": "PASS"}, {"bundle_sha256": "0"*64}):
            marker = self.marker()
            marker.update(update)
            with self.assertRaises(Problem):
                capability.parse_output([json.dumps(marker)])
        marker = self.marker()
        marker["native_worker_receipt"]["payload"]["campaign_id"] = "foreign"
        with self.assertRaises(Problem):
            capability.classify_result(marker)

    def test_unprepared_or_second_attempt_cannot_classify_or_materialize(self):
        capability = self.capability()
        with self.assertRaises(Problem):
            capability.parse_output([json.dumps(self.marker())])
        capability = self.prepared_capability()
        workspace = self.root/"attempt-0002"
        workspace.mkdir()
        with self.assertRaises(Problem):
            capability.prepare_task(self.inspect(), workspace, task_id="hubbard", attempt_id="attempt-0002", inputs={"input": self.archive})
        self.assertEqual(list(workspace.iterdir()), [])

    def test_nonisolated_process_cannot_enable_subreaper(self):
        with patch("dftlab_platform.hf1_children.sys.flags", SimpleNamespace(isolated=0)), self.assertRaises(Problem):
            OwnedLinuxChildren()

    def test_native_preparer_emits_the_exact_ad17_controller_task(self):
        capability = self.controller_capability()
        before = self.archive.read_bytes()
        binding = SimpleNamespace(name="campaign", external_artifact_id="bundle-artifact", source_task_id=None, destination="campaign.bundle.zip")
        artifact = SimpleNamespace(artifact_id="bundle-artifact", relative_path="hf1-campaign.zip", sha256=self.sha)
        resources = {"nodes": 1, "mpi_processes": 1, "processes_per_node": 1, "cpus_per_process": 1, "walltime_seconds": 3600}
        task = SimpleNamespace(task_id="hf1-lru", kind=SimpleNamespace(value="calculation"), capability_id=CAPABILITY, settings={}, resources=resources,
                               inputs=(binding,), outputs=(), dependencies=())
        profile = SimpleNamespace(nodes=1, total_cpus=4, ntasks=4, processes_per_node=4,
                                  launcher_kind="openmpi", max_attempts=3)
        protected = {}
        result = capability.prepare_controller_task(
            task, by_task={task.task_id: task}, artifacts={artifact.artifact_id: artifact},
            resolved_sources={artifact.artifact_id: self.archive}, profile=profile, protected=protected,
        )
        self.assertEqual(result["task_id"], "hf1-lru")
        self.assertEqual(result["capability_id"], CAPABILITY)
        self.assertEqual(result["kind"], "controller")
        self.assertEqual((result["nodes"], result["mpi_processes"], result["cpus_per_process"]), (0, 1, 1))
        self.assertEqual(result["reservation"], CONTROLLER_RESERVATION)
        self.assertEqual(result["max_attempts"], 3)
        self.assertEqual(result["input_hashes"], {result["input"]: self.sha})
        self.assertEqual(protected, {result["input"]: self.archive})
        self.assertEqual(self.archive.read_bytes(), before)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["inputs.zip"])
        task.task_id = "../outside"
        with self.assertRaises(Problem):
            capability.prepare_controller_task(
                task, by_task={task.task_id: task}, artifacts={artifact.artifact_id: artifact},
                resolved_sources={artifact.artifact_id: self.archive}, profile=profile, protected={},
            )

    RESERVATION = "work/hf1-lru/attempt-0001/.qraft/controller-reservation.json"
    CAMPAIGN = "controller-state/hf1-lru/campaign.v2.json"

    def claimed(self, state_dir):
        # What QRAFT's supervisor does before it launches the entry: owner.json only.
        (state_dir/"owner.json").write_text("{}")

    def test_fresh_state_is_left_empty_so_qraft_does_not_read_it_as_tampered(self):
        # ADR-017 Adenda 9 / C0 FAIL: QRAFT's previous_controller_owner raises
        # "state without an owner" for a directory with files but no owner.json.
        capability = self.controller_capability()
        state_dir = self.root/"run"/"controller-state"/"hf1-lru"
        attempt = self.root/"run"/"work"/"hf1-lru"/"attempt-0001"
        attempt.mkdir(parents=True)
        campaign = capability.prepare_task(
            self.inspect(4), attempt, task_id="hf1-lru", attempt_id="attempt-0001",
            inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
        self.assertEqual(campaign, state_dir/"campaign.v2.json")
        self.assertTrue(state_dir.is_dir())
        self.assertEqual(list(state_dir.iterdir()), [])
        self.assertFalse((attempt/"hf1-request.json").exists())
        plan = json.loads((attempt/hf1_controller_entry.STAGE_PLAN).read_text())
        self.assertEqual(plan["bundle"], "campaign.bundle.zip")
        self.assertEqual((plan["bundle_sha256"], plan["profile_sha256"], plan["reserved_cpus"]), (self.sha, self.profile_sha, 4))

    def test_entry_stages_after_the_claim_and_resume_never_rewrites_state(self):
        capability = self.controller_capability()
        run = self.root/"run"
        state_dir = run/"controller-state"/"hf1-lru"
        argv = ["--qraft-reservation", self.RESERVATION, "--campaign", self.CAMPAIGN]
        first = run/"work"/"hf1-lru"/"attempt-0001"
        first.mkdir(parents=True)
        capability.prepare_task(self.inspect(4), first, task_id="hf1-lru", attempt_id="attempt-0001",
                                inputs={"campaign": self.staged(first)}, controller_state_dir=state_dir)
        with self.assertRaises(Problem):
            hf1_controller_entry.stage(run, argv)  # not claimed by QRAFT yet
        self.assertEqual(list(state_dir.iterdir()), [])
        self.claimed(state_dir)
        campaign = hf1_controller_entry.stage(run, argv)
        self.assertEqual(campaign, state_dir/"campaign.v2.json")
        self.assertTrue(campaign.is_file())
        before = {path.relative_to(state_dir): path.read_bytes() for path in state_dir.rglob("*") if path.is_file()}
        self.assertEqual(sorted(str(name) for name in before), sorted(["owner.json", *self.files, "campaign.v2.json"]))
        second = run/"work"/"hf1-lru"/"attempt-0002"
        second.mkdir()
        resumed = capability.prepare_task(self.inspect(4), second, task_id="hf1-lru", attempt_id="attempt-0002",
                                          inputs={"campaign": self.staged(second)}, controller_state_dir=state_dir)
        self.assertEqual(resumed, campaign)
        resume_argv = ["--qraft-reservation", "work/hf1-lru/attempt-0002/.qraft/controller-reservation.json", "--campaign", self.CAMPAIGN]
        self.assertEqual(hf1_controller_entry.stage(run, resume_argv), campaign)
        after = {path.relative_to(state_dir): path.read_bytes() for path in state_dir.rglob("*") if path.is_file()}
        self.assertEqual(after, before)
        (state_dir/"lr.json").write_bytes(b"{}")
        with self.assertRaises(Problem):
            hf1_controller_entry.stage(run, resume_argv)

    def test_entry_refuses_paths_and_plans_that_do_not_match_the_qraft_layout(self):
        capability = self.controller_capability()
        run = self.root/"run"
        state_dir = run/"controller-state"/"hf1-lru"
        attempt = run/"work"/"hf1-lru"/"attempt-0001"
        attempt.mkdir(parents=True)
        capability.prepare_task(self.inspect(4), attempt, task_id="hf1-lru", attempt_id="attempt-0001",
                                inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
        self.claimed(state_dir)
        good = ["--qraft-reservation", self.RESERVATION, "--campaign", self.CAMPAIGN]
        for bad in (["--qraft-reservation", "/abs/controller-reservation.json", "--campaign", self.CAMPAIGN],
                    ["--qraft-reservation", "work/hf1-lru/attempt-0001/.qraft/other.json", "--campaign", self.CAMPAIGN],
                    ["--qraft-reservation", self.RESERVATION, "--campaign", "controller-state/other/campaign.v2.json"],
                    ["--qraft-reservation", self.RESERVATION], [*good, *good]):
            with self.subTest(argv=bad), self.assertRaises(Problem):
                hf1_controller_entry.stage(run, bad)
        plan_path = attempt/hf1_controller_entry.STAGE_PLAN
        plan = json.loads(plan_path.read_text())
        for change in ({"bundle_sha256": "0"*64}, {"bundle": "../inputs.zip"}, {"extra": 1}):
            with self.subTest(change=change):
                plan_path.write_text(json.dumps({**plan, **change}))
                with self.assertRaises(Problem):
                    hf1_controller_entry.stage(run, good)
                self.assertEqual({item.name for item in state_dir.iterdir()}, {"owner.json"})

    def test_entry_hands_the_same_arguments_to_hubbardflow_only_after_staging(self):
        capability = self.controller_capability()
        run = self.root/"run"
        state_dir = run/"controller-state"/"hf1-lru"
        attempt = run/"work"/"hf1-lru"/"attempt-0001"
        attempt.mkdir(parents=True)
        capability.prepare_task(self.inspect(4), attempt, task_id="hf1-lru", attempt_id="attempt-0001",
                                inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
        argv = ["--qraft-reservation", self.RESERVATION, "--campaign", self.CAMPAIGN]
        calls = []
        fake = SimpleNamespace(main=lambda arguments: calls.append((list(arguments), (state_dir/"campaign.v2.json").is_file())) or 7)
        loader = unittest.mock.Mock(return_value=fake)
        with patch.object(hf1_controller_entry, "importlib", SimpleNamespace(import_module=loader)), \
                patch.object(Path, "cwd", return_value=run):
            self.assertEqual(hf1_controller_entry.main(argv), 2)  # unclaimed: refused, nothing handed over
            self.assertEqual(calls, [])
            self.claimed(state_dir)
            self.assertEqual(hf1_controller_entry.main(argv), 7)
        loader.assert_called_once_with("hubbardflow.api.controller")
        self.assertEqual(calls, [(argv, True)])

    def test_capability_names_the_platform_console_script_and_the_wheel_declares_it(self):
        descriptors = []
        core = SimpleNamespace(
            __all__=("CapabilityDescriptor", "CapabilityKind", "PluginDescriptor", "ContractVersion", "EXECUTION_REQUEST", "EXECUTION_EVIDENCE"),
            CapabilityDescriptor=lambda *args, metadata: descriptors.append(metadata) or SimpleNamespace(),
            CapabilityKind=SimpleNamespace(ENGINE="engine"), PluginDescriptor=lambda *args: SimpleNamespace(),
            ContractVersion=lambda *args: None, EXECUTION_REQUEST="request", EXECUTION_EVIDENCE="evidence")
        capability = self.controller_capability()
        capability.engines = SimpleNamespace(qraft_contracts=lambda: core)
        capability.register(SimpleNamespace(register=lambda *args: None))
        extension = descriptors[0]["qraft.controller"]
        self.assertEqual((extension["distribution"], extension["entrypoint"]), ("dftlab-platform", "dftlab-hf1-controller"))
        try:  # installed wheel (tests run outside the source tree) or source tree
            declared = any(point.group == "console_scripts" and point.name == "dftlab-hf1-controller"
                           and point.value == "dftlab_platform.hf1_controller_entry:main"
                           for point in importlib.metadata.distribution("dftlab-platform").entry_points)
        except importlib.metadata.PackageNotFoundError:
            pyproject = Path(__file__).resolve().parents[1]/"pyproject.toml"
            declared = 'dftlab-hf1-controller = "dftlab_platform.hf1_controller_entry:main"' in pyproject.read_text()
        self.assertTrue(declared)

    def test_controller_mode_ignores_legacy_worker_limits(self):
        # ADR-017 Adenda 5: max_seconds/grace_seconds bound only hf1_worker.
        results = []
        for index, (max_seconds, grace_seconds) in enumerate(((1800, 10), (1, 1))):
            self.controller_capability()
            capability = HubbardFlowCampaignCapability(
                self.engines, self.root, run_id="synthetic-controller", bundle_sha256=self.sha,
                profile_sha256=self.profile_sha, reserved_cpus=4,
                max_seconds=max_seconds, grace_seconds=grace_seconds)
            state_dir = self.root/f"run-{index}"/"controller-state"/"hf1-lru"
            attempt = self.root/f"run-{index}"/"attempt-0001"
            attempt.mkdir(parents=True)
            campaign = capability.prepare_task(
                self.inspect(4), attempt, task_id="hf1-lru", attempt_id="attempt-0001",
                inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
            self.assertFalse((attempt/"hf1-request.json").exists())
            command = capability.build_command(
                campaign, execution_spec=SimpleNamespace(launcher="controller", mpi_ranks=1, allocated_cpus=1),
                controller_entrypoint="/installed/hubbardflow-controller",
                controller_reservation_path="work/hf1-lru/attempt-0001/.qraft/controller-reservation.json",
                controller_state_dir=state_dir, controller_prior_ledgers=())
            files = {path.relative_to(state_dir): path.read_bytes() for path in state_dir.rglob("*") if path.is_file()}
            results.append((command, files))
        self.assertEqual(results[0], results[1])

    def test_local_wsl_campaign_profile_is_controller_only_and_never_slurm_by_default(self):
        # ADR-017 Adenda 6: the campaign profile keeps its own target; the outer
        # SLURM allocation is a different profile. Only the controller path may
        # take a local_wsl campaign profile; the legacy worker still needs slurm.
        self.profile["target"] = "local_wsl"
        capability = self.controller_capability()
        with self.assertRaises(Problem):
            self.inspect(4)
        with self.assertRaises(Problem):
            inspect_bundle(self.archive, expected_sha256=self.sha, expected_profile_sha256=self.profile_sha, reserved_cpus=4, allowed_targets=("slurm",))
        inspected = capability.inspect_input(self.archive)
        self.assertEqual(inspected.profile_target, "local_wsl")
        legacy = self.root/"attempt-legacy"
        legacy.mkdir()
        with self.assertRaises(Problem):
            capability.prepare_task(inspected, legacy, task_id="hf1-lru", attempt_id="attempt-0001", inputs={"campaign": self.archive})
        self.assertEqual(list(legacy.iterdir()), [])
        state_dir = self.root/"controller-state"/"hf1-lru"
        attempt = self.root/"attempt-0001"
        attempt.mkdir()
        campaign = capability.prepare_task(inspected, attempt, task_id="hf1-lru", attempt_id="attempt-0001",
                                           inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
        self.assertEqual(campaign, state_dir/"campaign.v2.json")
        self.assertFalse((attempt/"hf1-request.json").exists())
        for target in ("ssh", "local", "", None):
            with self.subTest(target=target):
                self.profile["target"] = target
                self.files["profile.json"] = json.dumps(self.profile).encode()
                self.write()
                with self.assertRaises(Problem):
                    inspect_bundle(self.archive, expected_sha256=self.sha, expected_profile_sha256=self.profile_sha, reserved_cpus=4, allowed_targets=CONTROLLER_TARGETS)

    def test_profile_findings_name_every_failure_at_once(self):
        good = {"target": "local_wsl", "allocation": {"nodes": 1, "total_cpus": 4, "max_parallel_steps": 1},
                "runtime": {"launcher": {"kind": "openmpi", "processes_per_node": 4}}}
        self.assertEqual(profile_findings(good, 4, CONTROLLER_TARGETS), ())
        self.assertEqual(profile_findings(good, 4), ("PROFILE_TARGET",))
        bad = {"target": "pbs", "allocation": {"nodes": 2, "total_cpus": 8, "max_parallel_steps": 2},
               "runtime": {"launcher": {"kind": "hydra", "processes_per_node": 9}}}
        self.assertEqual(profile_findings(bad, 4, CONTROLLER_TARGETS), (
            "PROFILE_TARGET", "PROFILE_NODES", "PROFILE_MAX_PARALLEL_STEPS", "PROFILE_TOTAL_CPUS",
            "PROFILE_LAUNCHER_KIND", "PROFILE_PROCESSES_PER_NODE"))
        self.assertEqual(profile_findings([], 4), ("PROFILE_NOT_OBJECT",))
        self.assertEqual(profile_findings({"allocation": [], "runtime": {}}, 4), ("PROFILE_SECTION_NOT_OBJECT",))

    def test_outer_allocation_findings_name_every_failure_at_once(self):
        resources = {"nodes": 1, "mpi_processes": 1, "processes_per_node": 1, "cpus_per_process": 1, "walltime_seconds": 3600}
        outer = SimpleNamespace(nodes=1, total_cpus=4, ntasks=4, processes_per_node=4, launcher_kind="openmpi", max_attempts=3)
        self.assertEqual(controller_profile_findings(resources, outer, 4), ())
        wrong = SimpleNamespace(nodes=2, total_cpus=8, ntasks=8, processes_per_node=8, launcher_kind="srun", max_attempts=1)
        self.assertEqual(controller_profile_findings({**resources, "walltime_seconds": 0}, wrong, 4), (
            "TASK_WALLTIME_SECONDS", "OUTER_NODES", "OUTER_TOTAL_CPUS", "OUTER_NTASKS",
            "OUTER_PROCESSES_PER_NODE", "OUTER_LAUNCHER_KIND", "OUTER_MAX_ATTEMPTS"))
        self.assertEqual(controller_profile_findings({"nodes": 1}, outer, 4), ("TASK_RESOURCE_FIELDS",))
        self.assertIn("RESERVATION_INNER_PROCESSES", controller_profile_findings(resources, SimpleNamespace(
            nodes=1, total_cpus=2, ntasks=2, processes_per_node=2, launcher_kind="openmpi", max_attempts=3), 2))

    def test_controller_command_uses_only_qraft_bound_paths_and_installed_entrypoint(self):
        capability = self.controller_capability()
        state_dir = self.root/"controller-state"/"hf1-lru"
        attempt = self.root/"attempt-0001"
        attempt.mkdir()
        capability.prepare_task(self.inspect(4), attempt, task_id="hf1-lru", attempt_id="attempt-0001",
                                inputs={"campaign": self.staged(attempt)}, controller_state_dir=state_dir)
        spec = SimpleNamespace(launcher="controller", mpi_ranks=1, allocated_cpus=1)
        command = capability.build_command(
            state_dir/"campaign.v2.json", execution_spec=spec,
            controller_entrypoint="/installed/hubbardflow-controller",
            controller_reservation_path="work/hf1-lru/attempt-0001/.qraft/controller-reservation.json",
            controller_state_dir=state_dir, controller_prior_ledgers=(),
        )
        self.assertEqual(command, (
            "/installed/hubbardflow-controller", "--qraft-reservation",
            "work/hf1-lru/attempt-0001/.qraft/controller-reservation.json",
            "--campaign", "controller-state/hf1-lru/campaign.v2.json",
        ))
        output = capability.parse_output([], outcome=SimpleNamespace(exit_code=0, terminated_by_controller=False))
        classified = capability.classify_result(output, outcome=SimpleNamespace(exit_code=0, terminated_by_controller=False))
        self.assertEqual(classified.status, "PASS")
        self.assertEqual(classified.scientific_assessment, "NOT_ESTABLISHED")
        self.assertEqual(classified.quantity_kind, "U_scalar_charge")
        for bad in (
            {"controller_reservation_path": "/absolute/controller-reservation.json"},
            {"controller_reservation_path": "work/hf1-lru/attempt-0001/.qraft/other.json"},
        ):
            with self.assertRaises(Problem):
                capability.build_command(
                    state_dir/"campaign.v2.json", execution_spec=spec,
                    controller_entrypoint="/installed/hubbardflow-controller",
                    controller_reservation_path=bad["controller_reservation_path"],
                    controller_state_dir=state_dir, controller_prior_ledgers=(),
                )

    @unittest.skipUnless(sys.platform.startswith("linux"), "Real descendant containment is Linux/WSL only")
    def test_owned_descendants_close_without_signalling_foreign_process(self):
        # The subreaper is enabled in a dedicated child, not the suite process.
        # Two synthetic Python sleepers model owned/unrelated processes only.
        code = """
from pathlib import Path
import json,os,subprocess,sys,time
from dftlab_platform.hf1_children import OwnedLinuxChildren
owned=OwnedLinuxChildren()
parent=subprocess.Popen([sys.executable,'-I','-c',"import subprocess,sys,time;p=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(60)']);print(p.pid,flush=True);time.sleep(.3)"],stdout=subprocess.PIPE,text=True)
pid=int(parent.stdout.readline());owned.descendants();parent.wait(timeout=10);parent.stdout.close()
owned.close(grace_seconds=.1)
assert not Path('/proc',str(pid)).exists()
print(json.dumps({'closed':True,'observed':len(owned.observed)}))
"""
        foreign = subprocess.Popen([sys.executable, "-I", "-c", "import time;time.sleep(60)"])
        try:
            result = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, timeout=15, check=True)
            self.assertTrue(json.loads(result.stdout)["closed"])
            self.assertIsNone(foreign.poll())
        finally:
            foreign.terminate()
            foreign.wait(timeout=10)
