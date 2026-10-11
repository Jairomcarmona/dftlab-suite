"""HF1 transport/process adversaries; no installed engine, SIESTA or Slurm."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

from dftlab_platform.domain import Problem
from dftlab_platform.hf1_bundle import inspect_bundle, materialize_bundle
from dftlab_platform.hf1_capability import HubbardFlowCampaignCapability
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

    def inspect(self):
        return inspect_bundle(self.archive, expected_sha256=self.sha, expected_profile_sha256=self.profile_sha, reserved_cpus=8)

    def capability(self):
        return HubbardFlowCampaignCapability(self.engines, self.root, run_id="synthetic-outer", bundle_sha256=self.sha, profile_sha256=self.profile_sha, reserved_cpus=8, max_seconds=60)

    def marker(self):
        return {"schema_version": 1, "kind": "dftlab.hf1.worker-result", "outer_run_id": "synthetic-outer", "bundle_sha256": self.sha, "campaign_id": "synthetic-inner", "scientific_assessment": "NOT_ESTABLISHED", "quantity_kind": "U_scalar_charge", "exit_code": 0, "cancel_requested": False, "local_children_closed": True, "orphan_observed": False,
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
        capability = self.capability()
        original = self.marker()
        parsed = capability.parse_output([json.dumps(original)])
        classified = capability.classify_result(parsed)
        self.assertEqual(classified.status, "PASS")
        self.assertEqual(classified.native_worker_receipt, original["native_worker_receipt"])
        self.assertEqual(classified.scientific_assessment, "NOT_ESTABLISHED")
        self.assertEqual(classified.quantity_kind, "U_scalar_charge")

    def test_exit_zero_unknown_status_cancel_or_orphan_never_become_success(self):
        capability = self.capability()
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
        capability = self.capability()
        for update in ({"outer_run_id": "wrong"}, {"quantity_kind": "U_eff"}, {"scientific_assessment": "PASS"}, {"bundle_sha256": "0"*64}):
            marker = self.marker()
            marker.update(update)
            with self.assertRaises(Problem):
                capability.parse_output([json.dumps(marker)])
        marker = self.marker()
        marker["native_worker_receipt"]["payload"]["campaign_id"] = "foreign"
        with self.assertRaises(Problem):
            capability.classify_result(marker)

    def test_nonisolated_process_cannot_enable_subreaper(self):
        with patch("dftlab_platform.hf1_children.sys.flags", SimpleNamespace(isolated=0)), self.assertRaises(Problem):
            OwnedLinuxChildren()

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
