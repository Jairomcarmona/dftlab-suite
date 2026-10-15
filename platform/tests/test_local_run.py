import io
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from pathlib import PurePosixPath
import sqlite3
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zipfile import ZipFile, ZipInfo

from dftlab_platform.contracts import Contracts, canonical
from dftlab_platform.domain import envelope
from dftlab_platform.local_run import (LocalRunApplication, PROFILE_ID, PROTOCOL, _archive_entries,
                                       _extract_archive, _extract_package_for_operation,
                                       _normalized_profile_matches, _siesta_recipe)
from dftlab_platform.domain import Problem
from dftlab_platform.runtime_probe import Binary, Observation, ProbeFailure
from dftlab_platform.slurm import SlurmJobObservation
from dftlab_platform.terminal_evidence import SlurmTerminalCollector
from dftlab_platform.wsl_sacct import SACCT_PATH, SACCT_SHA256


def archive(entries):
    output = io.BytesIO()
    with ZipFile(output, "w") as zipped:
        for name, data in entries:
            zipped.writestr(name, data)
    return output.getvalue()


class Budget:
    def __init__(self, project_id, capacity):
        self.project_id, self.capacity = project_id, capacity
        self.expires_at = (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat().replace("+00:00", "Z")


class BudgetPort:
    def __init__(self, account=None, held=0):
        self.account, self.held, self.admit_calls = account, held, []

    def admitted(self, owner, operation_id):
        return None

    def get(self, owner, budget_id):
        return self.account, self.held

    def admit(self, owner, budget_id, operation_id, quantity, payload):
        self.admit_calls.append((budget_id, operation_id, quantity, payload))
        payload = {**payload, "reservation": {"reservation_id": "res-0001", "budget_ref": budget_id,
                                                  "amount": {"value": quantity, "unit": "allocated_cpu_second"}}}
        return envelope("admission-receipt", "project-001", payload, contracts=Contracts())


class LocalRunTests(unittest.TestCase):
    def test_capability_discovery_stays_empty(self):
        runtime = object.__new__(LocalRunApplication)
        self.assertEqual(runtime.capabilities(), [])

    def test_profile_match_accounts_for_pinned_qraft_default(self):
        source = {"profile_id": PROFILE_ID, "allocation": {"nodes": 1, "total_cpus": 4}}
        packaged = {"profile_id": PROFILE_ID, "allocation": {"nodes": 1, "total_cpus": 4, "cpus_per_task": 1}}
        self.assertTrue(_normalized_profile_matches(source, packaged))
        packaged["allocation"]["cpus_per_task"] = 2
        self.assertFalse(_normalized_profile_matches(source, packaged))

    def test_siesta_recipe_reads_physical_and_numerical_records_from_bundle(self):
        parameters = {
            "basis": {"size": "DZP", "energy_shift": {"value": 0.02, "unit": "Ry"}},
            "mesh_cutoff": {"value": 200, "unit": "Ry"},
            "kgrid": {"kind": "MONKHORST_PACK", "divisions": [2, 2, 2], "shift": [0, 0, 0], "k_includes_2pi": False},
            "smearing": None,
            "solver": "diagon",
            "tolerances": {"dm_tolerance": {"value": "1e-5", "unit": "1"}},
            "convergence_target": "total_energy",
            "justification": "Explicit local authoring case; fixed parameters, no universal convergence/science claim.",
        }
        model = {"xc": {"functional": "CA", "family": "LDA"}, "total_charge": {"value": 0, "unit": "e"},
                 "spin": "NONE", "relativistic": "SCALAR", "hubbard": None, "assumptions": []}
        bundle = {
            "draft": {"project_id": "project-001"},
            "structure": {"payload": {
                "convention": "cell-vectors-as-rows",
                "cell": {"vectors": [[0, 2.7155, 2.7155], [2.7155, 0, 2.7155], [2.7155, 2.7155, 0]], "unit": "angstrom"},
                "periodicity": [True, True, True], "coordinates": {"kind": "fractional"},
                "sites": [{"atom_id": "si-1", "species_label": "Si", "position": [0, 0, 0]},
                          {"atom_id": "si-2", "species_label": "Si", "position": [0.25, 0.25, 0.25]}],
                "transformations": [], "physical_intent": "BULK",
            }},
            "intent": {
                "run_intent": {"payload": {"protocol": PROTOCOL}},
                "physical_model": {"payload": model},
                "numerical_policy": {"payload": {
                    "policy": {"policy_id": "dftlab.qualification-scf", "version": "0.1.0",
                               "digest": hashlib.sha256(canonical(parameters)).hexdigest()}, **parameters}},
            },
        }
        engine = SimpleNamespace(
            ArtifactPortContract=lambda *args: args,
            WorkflowFragment=SimpleNamespace(single=lambda *args, **kwargs: (args, kwargs)),
            RecipePolicy=lambda *args: args,
        )
        assets = SimpleNamespace(ensure=Mock(side_effect=lambda _owner, _project, key, _data, _kind, _media_type:
                                              {"artifact_id": key, "sha256": "a" * 64, "media_type": "application/json"}))
        settings = SimpleNamespace(profile_id=PROFILE_ID, pseudo_bytes=b"pseudo", profile_bytes=b"profile")

        _profile, resolve, _profile_resolver = _siesta_recipe(SimpleNamespace(qraft=engine), assets, settings)
        recipe = resolve("owner-001", bundle)

        self.assertIsNotNone(recipe)
        self.assertEqual(recipe.profile_id, PROFILE_ID)
        self.assertEqual(len(recipe.fragments), 2)
        self.assertEqual(assets.ensure.call_count, 3)

    def test_package_extraction_preserves_exact_files_and_rejects_second_write(self):
        original = b"native-lock-bytes\x00\xff"
        packed = archive([("run-001/run.lock.json", original), ("run-001/submit.slurm", b"#!/bin/bash\n")])
        with tempfile.TemporaryDirectory() as temporary:
            root = _extract_archive(packed, Path(temporary)/"extract", "run-001")
            self.assertEqual((root/"run.lock.json").read_bytes(), original)
            with self.assertRaises(FileExistsError):
                _extract_archive(packed, Path(temporary)/"extract", "run-001")

    def test_packages_for_distinct_operations_use_distinct_extraction_roots(self):
        first = archive([("run-001/run.lock.json", b"first")])
        second = archive([("run-002/run.lock.json", b"second")])
        with tempfile.TemporaryDirectory() as temporary:
            first_root = _extract_package_for_operation(Path(temporary), "operation-001", first)
            second_root = _extract_package_for_operation(Path(temporary), "operation-002", second)
            self.assertNotEqual(first_root, second_root)
            self.assertEqual((first_root/"run.lock.json").read_bytes(), b"first")
            self.assertEqual((second_root/"run.lock.json").read_bytes(), b"second")
            with self.assertRaises(Problem):
                _extract_package_for_operation(Path(temporary), "operation-001", first)

    def test_package_path_escape_and_symlink_are_rejected(self):
        with self.assertRaises(Problem):
            _archive_entries(archive([("run-001/../outside", b"escape")]))
        output = io.BytesIO()
        info = ZipInfo("run-001/link")
        info.external_attr = (0o120777 << 16)
        with ZipFile(output, "w") as zipped:
            zipped.writestr(info, "../../outside")
        with self.assertRaises(Problem):
            _archive_entries(output.getvalue())

    @staticmethod
    def _admission_case(*, budget=True):
        runtime = object.__new__(LocalRunApplication)
        runtime.repository = SimpleNamespace(contracts=Contracts())
        runtime.budgets = BudgetPort(Budget("project-001", 2400) if budget else None)
        runtime.settings = SimpleNamespace(
            profile_id="wsl-slurm-openmpi-installed-qualification",
            profile={"allocation": {"nodes": 1, "total_cpus": 4, "walltime": "00:10:00"}},
        )
        runtime._terminal_history_route_available = Mock(return_value=True)
        runtime._plan_package = lambda *_args: (
            {"project_id": "project-001"}, {"digest": {"value": "a"*64}},
            {"payload": {"sha256": "b"*64}},
        )
        operation = {"project_id": "project-001", "payload": {
            "operation_id": "operation-001", "owner_principal_id": "owner-001",
            "target_refs": [{"revision": 1}],
        }}
        request = {"project_id": "project-001", "target": {"expected_revision": 1},
                   "payload": {"admission_purpose": "EXPLORATORY"},
                   "profile_ref": runtime.settings.profile_id,
                   "budget_ref": "budget-001" if budget else None}
        return runtime, operation, request

    def test_missing_budget_returns_a_rejection_without_probe_or_reservation(self):
        runtime, operation, request = self._admission_case(budget=False)
        probe = SimpleNamespace(observe=Mock(side_effect=AssertionError("probe must not run")))
        with patch("dftlab_platform.local_run.SlurmRuntimeProbe", return_value=probe):
            receipt = runtime.admission_preflight(operation, request)
        payload = receipt["payload"]
        self.assertEqual(payload["decision"], "REJECTED")
        self.assertEqual(payload["reasons"], ["BUDGET_UNAVAILABLE"])
        self.assertIsNone(payload["runtime_probe_ref"])
        self.assertIsNone(payload["reservation"])
        self.assertEqual(runtime.budgets.admit_calls, [])

    def test_unavailable_terminal_history_rejects_before_probe_or_reservation(self):
        runtime, operation, request = self._admission_case()
        runtime._terminal_history_route_available.return_value = False
        probe = SimpleNamespace(observe=Mock(side_effect=AssertionError("probe must not run")))
        with patch("dftlab_platform.local_run.SlurmRuntimeProbe", return_value=probe):
            receipt = runtime.admission_preflight(operation, request)
        payload = receipt["payload"]
        self.assertEqual(payload["decision"], "REJECTED")
        self.assertEqual(payload["purpose"], "EXPLORATORY")
        self.assertEqual(payload["reasons"], ["ruta de evidencia terminal no disponible"])
        self.assertIsNone(payload["runtime_probe_ref"])
        self.assertIsNone(payload["reservation"])
        runtime._terminal_history_route_available.assert_called_once_with()
        self.assertEqual(runtime.budgets.admit_calls, [])

    def test_terminal_history_preflight_checks_only_the_known_440_row(self):
        runtime = object.__new__(LocalRunApplication)
        runtime.state = Path("/tmp/local-run-state")
        runtime.settings = SimpleNamespace(
            sacct=SimpleNamespace(verified=Mock(return_value=PurePosixPath("/usr/bin/sacct"))),
            site={"cluster": "qualified-cluster", "remote_user": "jmc", "uid": 1000},
        )
        history = SimpleNamespace(run=Mock(return_value=Observation(
            "440|jmc(1000)|unknown|COMPLETED|2026-10-11T09:00:14|2026-10-11T09:00:21\n", 0)))
        runtime.history_commands = history
        self.assertTrue(runtime._terminal_history_route_available())
        history.run.assert_called_once_with(
            ("/usr/bin/sacct", "--completion", "--jobs=440", "--noheader", "--parsable2",
             "--format=JobID,User,Cluster,State,Start,End"),
            cwd=runtime.state,
            environment={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC"},
        )

    def test_terminal_history_preflight_rejects_missing_or_wrong_440_row(self):
        runtime = object.__new__(LocalRunApplication)
        runtime.state = Path("/tmp/local-run-state")
        runtime.settings = SimpleNamespace(
            sacct=SimpleNamespace(verified=Mock(return_value=PurePosixPath("/usr/bin/sacct"))),
            site={"cluster": "qualified-cluster", "remote_user": "jmc", "uid": 1000},
        )
        for observation in (
            Observation("", 1),
            Observation("", 0),
            Observation("441|jmc(1000)|unknown|COMPLETED|2026-10-11T09:00:14|2026-10-11T09:00:21\n", 0),
            Observation("440|other(1000)|unknown|COMPLETED|2026-10-11T09:00:14|2026-10-11T09:00:21\n", 0),
        ):
            with self.subTest(output=observation.output, returncode=observation.returncode):
                runtime.history_commands = SimpleNamespace(run=Mock(return_value=observation))
                self.assertFalse(runtime._terminal_history_route_available())

    def test_unreachable_probe_returns_a_rejection_without_reservation(self):
        runtime, operation, request = self._admission_case()
        runtime._probe_settings = lambda _project_id: object()
        probe = SimpleNamespace(observe=Mock(side_effect=ProbeFailure("offline")))
        with patch("dftlab_platform.local_run.SlurmRuntimeProbe", return_value=probe):
            receipt = runtime.admission_preflight(operation, request)
        payload = receipt["payload"]
        self.assertEqual(payload["decision"], "REJECTED")
        self.assertEqual(payload["purpose"], "EXPLORATORY")
        self.assertEqual(payload["reasons"], ["RUNTIME_PROBE_FAILED"])
        self.assertIsNone(payload["runtime_probe_ref"])
        self.assertIsNone(payload["reservation"])
        self.assertEqual(runtime.budgets.admit_calls, [])

    @staticmethod
    def _output_runtime(root):
        runtime = object.__new__(LocalRunApplication)
        native_contracts = SimpleNamespace(canonical_json=lambda value: json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
        runtime.engines = SimpleNamespace(qraft_contracts=lambda: native_contracts)
        runtime._declared_outputs = Mock(return_value=[{
            "task_id": "derived", "name": "density", "path": "si.DM",
            "artifact_type": "siesta.density-matrix", "media_type": "application/x-siesta-dm",
        }])
        runtime._artifact = Mock(return_value=(None, {"artifact_id": "output-001", "sha256": "a"*64,
                                                    "media_type": "application/x-siesta-dm"}))
        context = {"root": str(root), "project_id": "project-001", "native_refs": [{"artifact_id": "native-001"}]}
        return runtime, context

    def test_copied_parent_density_matrix_is_not_a_derived_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            copied_input = root/"protected"/"derived"/"parent_dm"/"si.DM"
            copied_input.parent.mkdir(parents=True)
            copied_input.write_bytes(b"parent density matrix")
            runtime, context = self._output_runtime(root)

            found, unproduced = runtime._output_artifacts("owner-001", context)

        self.assertEqual(found, [])
        self.assertEqual(unproduced, [{"port": "derived.density", "reason": "NEVER_PRODUCED",
                                       "native_ref": {"artifact_id": "native-001"}}])
        runtime._artifact.assert_not_called()

    def test_declared_outputs_accept_qraft_relative_path_field(self):
        runtime = object.__new__(LocalRunApplication)
        workflow = SimpleNamespace(tasks=[
            SimpleNamespace(task_id="single", outputs=[SimpleNamespace(
                name="density", relative_path="si.DM", artifact_type="siesta.density-matrix",
                media_type="application/x-siesta-dm")]),
            SimpleNamespace(task_id="derived", outputs=[SimpleNamespace(
                name="density", relative_path="si.DM", artifact_type="siesta.density-matrix",
                media_type="application/x-siesta-dm")]),
        ])
        runtime.engines = SimpleNamespace(qraft=SimpleNamespace(
            load_workflow_lock=Mock(return_value=({}, workflow))))

        outputs = runtime._declared_outputs({"root": "/tmp/run-001"})

        self.assertEqual([item["path"] for item in outputs], ["si.DM", "si.DM"])

    def test_output_requires_task_attempt_evidence_with_matching_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            attempt = root/"work"/"derived"/"attempt-0001"
            attempt.mkdir(parents=True)
            output = attempt/"si.DM"
            output.write_bytes(b"derived output")
            output_hash = hashlib.sha256(output.read_bytes()).hexdigest()
            payload = {"attempt": {"node_id": "derived", "attempt_id": "attempt-0001", "exit_code": 0,
                                    "artifacts": {"si.DM": output_hash}}, "native_numeric_probe": 1.0}
            native_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                        ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.assertNotEqual(native_payload, canonical(payload))
            manifest = {
                "schema_version": "1.0", "payload": payload,
                "sha256": hashlib.sha256(native_payload).hexdigest(),
            }
            (attempt/"attempt.json").write_bytes(json.dumps(
                manifest, sort_keys=True, separators=(",", ":"),
                ensure_ascii=False, allow_nan=False).encode("utf-8"))
            runtime, context = self._output_runtime(root)

            found, unproduced = runtime._output_artifacts("owner-001", context)

        self.assertEqual(len(found), 1)
        self.assertEqual(unproduced, [])
        runtime._artifact.assert_called_once_with("owner-001", "project-001", b"derived output",
                                                  "siesta.density-matrix", "application/x-siesta-dm")

    def test_poll_replays_terminal_projection_after_receipt_was_saved(self):
        run_id = "run-001"
        context = {"run_id": run_id, "operation_id": "operation-001", "owner_id": "owner-001"}
        worker_result = {"summary": {"native_status": "COMPLETED"}}
        worker_raw = canonical(worker_result).decode()
        @dataclass(frozen=True)
        class Terminal:
            state: str
            observed_at: str

        terminal = Terminal("COMPLETED", "2026-10-14T00:00:00Z")
        terminal_raw = canonical({"native": asdict(terminal), "artifact_ref": None}).decode()
        final_raw = canonical({"saved": True}).decode()
        row = (run_id, "operation-001", canonical(context).decode(), worker_raw, terminal_raw, final_raw,
               0, "COMPLETED", "2026-10-14T00:00:00", 300)

        class Cursor:
            def fetchall(self):
                return [row]

            def fetchone(self):
                return worker_raw, terminal_raw, final_raw

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, statement, _params=()):
                self.statement = statement
                return Cursor()

        runtime = object.__new__(LocalRunApplication)
        runtime._last_poll = 0
        runtime.repository = SimpleNamespace(_connection=Connection)
        runtime.signer = SimpleNamespace(verify=Mock(return_value=False))
        runtime._terminal_from_document = Mock(return_value=terminal)
        previous = {"payload": {"source_revision": 3, "dimensions": {}}}
        updated = {"payload": {"source_revision": 4, "dimensions": {}}}
        runtime.readmodels = SimpleNamespace(get=Mock(return_value=previous))
        runtime._update_dimensions = Mock(return_value=updated)

        changed = runtime.poll()

        self.assertTrue(changed)
        runtime.signer.verify.assert_not_called()
        runtime.readmodels.get.assert_called_once()
        runtime._update_dimensions.assert_called_once()

    @staticmethod
    def _poll_runtime(observation, *, worker_result=None, terminal_state=None, terminal_end_at=None,
                      min_job_age=None, last_check=0):
        run_id, operation_id = "run-001", "operation-001"
        intent = {"effect_intent_id": "effect-001", "project_id": "project-001",
                  "integrity": {"status": "VERIFIED"}, "payload": {"run_id": run_id}}
        context = {"run_id": run_id, "operation_id": operation_id, "owner_id": "owner-001",
                   "project_id": "project-001", "intent": intent}
        raw_worker = canonical(worker_result).decode() if worker_result is not None else None
        row = (run_id, operation_id, canonical(context).decode(), raw_worker, None, None, last_check,
               terminal_state, terminal_end_at, min_job_age)

        class Cursor:
            def fetchall(self):
                return [row]

        class Database:
            def __init__(self):
                self.writes = []

            def execute(self, statement, params=()):
                self.writes.append((statement, params))
                return Cursor()

        class Context:
            def __init__(self, database):
                self.database = database

            def __enter__(self):
                return self.database

            def __exit__(self, *_args):
                return False

        runtime = object.__new__(LocalRunApplication)
        database = Database()
        scheduler = SimpleNamespace(observe_job_state=Mock(side_effect=observation)
                                    if isinstance(observation, BaseException)
                                    else Mock(return_value=observation))
        runtime._last_poll = 0
        runtime.repository = SimpleNamespace(
            _connection=lambda: Context(database), transaction=lambda: Context(database),
            operation=Mock(return_value={"payload": {"state": "SUCCEEDED"}}),
        )
        runtime.ledger = SimpleNamespace(snapshot=Mock(return_value=(
            intent, "ACKNOWLEDGED", {"payload": {"job": {"job_id": "457"}}},
        )))
        runtime._scheduler = lambda _context: scheduler
        runtime.settings = SimpleNamespace(sacct=object())
        runtime.history_commands = SimpleNamespace(name="history-bridge")
        runtime.engines = SimpleNamespace()
        runtime.signer = SimpleNamespace(verify=Mock(return_value=True))
        runtime.completion_timezone = timezone.utc
        previous = {"payload": {"source_revision": 3, "dimensions": {
            "scheduler": {"value": "RUNNING", "source": "SLURM_JOB_CONTEXT", "observed_at": "2026-10-14T00:00:00Z"},
        }}}
        runtime.readmodels = SimpleNamespace(get=Mock(return_value=previous))
        runtime._update_dimensions = Mock(return_value={"payload": {"source_revision": 4}})
        runtime._finalize = Mock()
        return runtime, scheduler, database, intent

    def test_poll_calls_terminal_collector_immediately_when_scontrol_reports_terminal(self):
        end_at = (datetime.now(timezone.utc)-timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")
        observation = SlurmJobObservation("457", "COMPLETED", end_at, 300)
        runtime, scheduler, database, intent = self._poll_runtime(
            observation, worker_result={"summary": {"native_status": "COMPLETED"}}, last_check=time.time(),
        )
        @dataclass(frozen=True)
        class Native:
            state: str
            observed_at: str

        native = Native("COMPLETED", "2026-10-14T00:00:00Z")
        collected = SimpleNamespace(native=native)
        with patch.object(SlurmTerminalCollector, "__init__", return_value=None) as collector_init, \
             patch.object(SlurmTerminalCollector, "observe", return_value=collected) as collect:
            runtime.poll()

        scheduler.observe_job_state.assert_called_once_with(intent, "457")
        self.assertIs(collector_init.call_args.kwargs["history_commands"], runtime.history_commands)
        collect.assert_called_once_with(intent, "457")
        runtime._finalize.assert_called_once()
        self.assertEqual(runtime._finalize.call_args.args[0]["run_id"], "run-001")
        self.assertIs(runtime._finalize.call_args.args[1], native)
        self.assertTrue(any("terminal_state=COALESCE" in sql for sql, _ in database.writes))

    def test_worker_completed_is_not_scheduler_terminal_evidence_when_collector_fails(self):
        end_at = (datetime.now(timezone.utc)-timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")
        observation = SlurmJobObservation("457", "COMPLETED", end_at, 300)
        runtime, _scheduler, _database, intent = self._poll_runtime(
            observation, worker_result={"summary": {"native_status": "COMPLETED"}},
        )
        with patch.object(SlurmTerminalCollector, "__init__", return_value=None), \
             patch.object(SlurmTerminalCollector, "observe", side_effect=ProbeFailure("Trusted completion history unavailable")) as collect:
            runtime.poll()

        collect.assert_called_once_with(intent, "457")
        runtime._finalize.assert_not_called()
        replacement = runtime._update_dimensions.call_args.args[1]["scheduler"]
        self.assertEqual(replacement["value"], "UNKNOWN")
        self.assertEqual(replacement["source"], "SLURM_TERMINAL_SEEN_AWAITING_SIGNED_EVIDENCE")

    def test_terminal_collection_retries_are_throttled_after_the_immediate_attempt(self):
        end_at = (datetime.now(timezone.utc)-timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S")
        observation = SlurmJobObservation("457", "COMPLETED", end_at, 300)
        runtime, _scheduler, _database, _intent = self._poll_runtime(
            observation, terminal_state="COMPLETED", terminal_end_at=end_at,
            min_job_age=300, last_check=time.time(),
        )
        with patch.object(SlurmTerminalCollector, "__init__", return_value=None) as collector_init:
            runtime.poll()

        collector_init.assert_not_called()
        runtime._finalize.assert_not_called()
        replacement = runtime._update_dimensions.call_args.args[1]["scheduler"]
        self.assertEqual(replacement["value"], "UNKNOWN")
        self.assertEqual(replacement["source"], "SLURM_TERMINAL_SEEN_AWAITING_SIGNED_EVIDENCE")

    def test_lost_terminal_window_sets_aged_unknown_without_finalizing(self):
        end = datetime.now(timezone.utc)-timedelta(seconds=400)
        end_at = end.strftime("%Y-%m-%dT%H:%M:%S")
        runtime, _scheduler, _database, _intent = self._poll_runtime(
            ProbeFailure("Invalid job id specified"),
            worker_result={"summary": {"native_status": "COMPLETED"}},
            terminal_state="COMPLETED", terminal_end_at=end_at, min_job_age=300,
        )
        with patch.object(SlurmTerminalCollector, "__init__", return_value=None) as collector_init:
            runtime.poll()

        collector_init.assert_not_called()
        runtime._finalize.assert_not_called()
        replacement = runtime._update_dimensions.call_args.args[1]["scheduler"]
        self.assertEqual(replacement["value"], "UNKNOWN")
        self.assertEqual(replacement["source"], "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED")
        expected_expiry = runtime._epoch_timestamp(end.timestamp()+300)
        self.assertEqual(replacement["observed_at"], expected_expiry)

    def test_scheduler_unknown_can_replace_running_and_preserve_first_observation_age(self):
        runtime = object.__new__(LocalRunApplication)
        context = {"run_id": "run-001", "operation_id": "operation-001", "owner_id": "owner-001"}
        previous = {"payload": {"source_revision": 3, "dimensions": {
            "scheduler": {"value": "RUNNING", "source": "SLURM_JOB_CONTEXT", "observed_at": "2026-10-14T00:00:00Z"},
        }}}
        updated = {"payload": {"source_revision": 4}}
        runtime.readmodels = SimpleNamespace(get=Mock(return_value=previous))
        runtime._update_dimensions = LocalRunApplication._update_dimensions.__get__(runtime)
        runtime.readmodels.update_run = Mock(return_value=updated)
        runtime.repository = SimpleNamespace()
        with patch("dftlab_platform.local_run.reseal", side_effect=lambda value: value):
            changed = runtime._scheduler_unknown(context, "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED", "2026-10-14T00:05:00Z")

        self.assertTrue(changed)
        self.assertEqual(runtime.readmodels.update_run.call_args.args[1]["payload"]["dimensions"]["scheduler"], {
            "value": "UNKNOWN", "source": "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED", "observed_at": "2026-10-14T00:05:00Z",
        })

    def test_local_run_migration_preserves_rows_and_adds_terminal_window_state_once(self):
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE local_run_migrations(version INTEGER PRIMARY KEY)")
            db.execute("INSERT INTO local_run_migrations VALUES(1)")
            db.execute("CREATE TABLE local_runs(run_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,context TEXT NOT NULL,worker_result TEXT,terminal_evidence TEXT,finalization_receipt TEXT,last_terminal_check REAL NOT NULL DEFAULT 0)")
            db.execute("INSERT INTO local_runs(run_id,operation_id,owner_id,project_id,context) VALUES('run-1','op-1','owner-1','project-1','{}')")

            LocalRunApplication._migrate_local_runs(db)
            first = db.execute("SELECT run_id,operation_id,context,terminal_state,terminal_end_at,terminal_min_job_age_seconds FROM local_runs").fetchone()
            LocalRunApplication._migrate_local_runs(db)
            versions = [row[0] for row in db.execute("SELECT version FROM local_run_migrations ORDER BY version")]

        self.assertEqual(first, ("run-1", "op-1", "{}", None, None, None))
        self.assertEqual(versions, [1, 2])


if __name__ == "__main__":
    unittest.main()
