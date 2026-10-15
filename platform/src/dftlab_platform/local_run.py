"""Opt-in local Si/SLURM runtime assembled from installed public adapters.

The default API never imports this module. Registration is explicit at process
start and remains limited to the exploratory Si single/derived recipe.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import stat
import sys
import time
from zoneinfo import ZoneInfo
from zipfile import BadZipFile, ZipFile

from .authoring import AuthoringHandlers
from .authority import LocalAuthorityManager
from .authority_storage import SQLiteAuthorityStore
from .budgets import SQLiteBudgetHolds
from .contracts import BASE, canonical, digest, loads
from .domain import Principal, Problem, Processor, envelope, identifier, now, reseal
from .draft_storage import SQLiteDraftRepository
from .engines import PinnedEngines
from .local_effects import LocalEffect
from .local_runtime import private_directory
from .native_worker import NativeWorker, RegisteredNativeRun
from .projection_storage import SQLiteReadModels
from .qraft_authoring import AuthoringProfile, AuthoringRecipe, QraftArtifactAuthoring
from .runtime_probe import Binary, ProbeFailure, ProbeSettings, SlurmRuntimeProbe
from .slurm import ManagedSlurmPackage, SlurmSchedulerPort, SlurmSite
from .submission_storage import SQLiteSubmissionLedger
from .submissions import DurableSubmissions
from .terminal_evidence import LocalTerminalSigner, SlurmTerminalCollector
from .wsl_sacct import HISTORY_ENVIRONMENT, SACCT_PATH, SACCT_SHA256, WslSacctBridge


PROFILE_ID = "wsl-slurm-openmpi-installed-qualification"
PROTOCOL = {"protocol_id": "dftlab.siesta.single-derived", "version": "0.1.0"}
PSEUDO_SHA256 = "84c9316efac1959ee8c04b8d5a06eec2e069fa19302cb66254f2e4dc455b2044"
SCIENTIFIC_ASSESSMENT = "NOT_ESTABLISHED"
_MAX_PACKAGE_FILES = 4096
_MAX_PACKAGE_BYTES = 128 * 1024**2


def _file_sha256(path: Path) -> str:
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _write_new(path: Path, data: bytes, *, mode=0o600) -> None:
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise Problem("PRECONDITION_FAILED")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _safe_json_file(path: Path, limit=1024**2) -> tuple[dict, bytes]:
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise Problem("ENGINE_UNAVAILABLE")
    raw = path.read_bytes()
    value = loads(raw)
    if not isinstance(value, dict):
        raise Problem("ENGINE_UNAVAILABLE")
    return value, raw


def _walltime_seconds(value: str) -> int:
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{2,}:[0-5][0-9]:[0-5][0-9]", value) is None:
        raise Problem("ENGINE_UNAVAILABLE")
    hours, minutes, seconds = map(int, value.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def _normalized_profile_matches(source: dict, packaged: dict) -> bool:
    """Match the pinned QRAFT serialization, including its documented default."""
    if not isinstance(source, dict) or not isinstance(packaged, dict):
        return False
    allocation = source.get("allocation")
    if not isinstance(allocation, dict):
        return False
    expected = dict(source)
    expected_allocation = dict(allocation)
    expected_allocation.setdefault("cpus_per_task", 1)
    expected["allocation"] = expected_allocation
    return packaged == expected


def _archive_entries(data: bytes):
    try:
        archive = ZipFile(BytesIO(data))
        entries = archive.infolist()
    except (OSError, ValueError, BadZipFile):
        raise Problem("PRECONDITION_FAILED") from None
    if not entries or len(entries) > _MAX_PACKAGE_FILES:
        archive.close()
        raise Problem("PAYLOAD_TOO_LARGE")
    names, roots, total = set(), set(), 0
    try:
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name)
            mode = entry.external_attr >> 16
            file_kind = stat.S_IFMT(mode)
            minimum_parts = 1 if entry.is_dir() else 2
            if (not name or "\\" in name or "\x00" in name or path.is_absolute()
                    or any(part in {"", ".", ".."} for part in name.rstrip("/").split("/"))
                    or len(path.parts) < minimum_parts or name in names
                    or file_kind not in {0, stat.S_IFREG, stat.S_IFDIR}
                    or stat.S_ISLNK(mode)):
                raise Problem("PRECONDITION_FAILED")
            names.add(name)
            roots.add(path.parts[0])
            if not entry.is_dir():
                total += entry.file_size
                if total > _MAX_PACKAGE_BYTES:
                    raise Problem("PAYLOAD_TOO_LARGE")
        if len(roots) != 1:
            raise Problem("PRECONDITION_FAILED")
        return archive, entries, next(iter(roots))
    except BaseException:
        archive.close()
        raise


def _extract_archive(data: bytes, destination: Path, expected_root: str | None = None):
    archive, entries, run_id = _archive_entries(data)
    try:
        if expected_root is not None and run_id != expected_root:
            raise Problem("PRECONDITION_FAILED")
        destination = Path(destination).absolute()
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        root = destination/run_id
        root.mkdir(mode=0o700)
        for entry in entries:
            relative = PurePosixPath(entry.filename).parts[1:]
            target = root.joinpath(*relative)
            if not target.resolve().is_relative_to(root.resolve()):
                raise Problem("PRECONDITION_FAILED")
            if entry.is_dir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            data_bytes = archive.read(entry)
            if len(data_bytes) != entry.file_size:
                raise Problem("PRECONDITION_FAILED")
            descriptor = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data_bytes)
                stream.flush()
                os.fsync(stream.fileno())
        return root
    finally:
        archive.close()


def _extract_package_for_operation(state: Path, operation_id: str, data: bytes):
    """Extract each accepted package under a fresh, operation-owned directory."""
    runs = Path(state)/"runs"
    if runs.is_symlink():
        raise Problem("PRECONDITION_FAILED")
    runs.mkdir(mode=0o700, parents=True, exist_ok=True)
    if runs.is_symlink():
        raise Problem("PRECONDITION_FAILED")
    destination = runs/operation_id
    if destination.is_symlink() or destination.exists():
        raise Problem("PRECONDITION_FAILED")
    return _extract_archive(data, destination)


@dataclass(frozen=True)
class LocalRunSettings:
    site_config_path: Path
    profile_path: Path
    pseudo_path: Path
    wheelhouse: Path
    site: dict
    profile: dict
    profile_bytes: bytes
    profile_digest: str
    profile_id: str
    pseudo_bytes: bytes
    pseudo_digest: str
    sacct: Binary

    @classmethod
    def load(cls, options: dict):
        if os.name == "nt" or "microsoft" not in __import__("platform").release().lower():
            raise Problem("ENGINE_UNAVAILABLE")
        required = {"site_config", "profile", "pseudo", "wheelhouse"}
        if not isinstance(options, dict) or set(options) != required:
            raise Problem("ENGINE_UNAVAILABLE")
        paths = {key: Path(options[key]).expanduser().absolute() for key in required}
        for key, path in paths.items():
            if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
                raise Problem("ENGINE_UNAVAILABLE")
            if key == "wheelhouse":
                if not path.is_dir():
                    raise Problem("ENGINE_UNAVAILABLE")
            elif not path.is_file():
                raise Problem("ENGINE_UNAVAILABLE")
        site, _ = _safe_json_file(paths["site_config"])
        profile, profile_bytes = _safe_json_file(paths["profile"])
        pseudo_bytes = paths["pseudo"].read_bytes()
        pseudo_digest = hashlib.sha256(pseudo_bytes).hexdigest()
        if (profile.get("profile_id") != PROFILE_ID or profile.get("schema_version") != "1.0"
                or profile.get("target") != "slurm" or pseudo_digest != PSEUDO_SHA256):
            raise Problem("ENGINE_UNAVAILABLE")
        expected_site = {"cluster", "remote_user", "uid", "partition", "node", "account", "qos",
                         "sbatch", "scontrol", "squeue", "sinfo", "mpi", "siesta"}
        if set(site) != expected_site:
            raise Problem("ENGINE_UNAVAILABLE")
        for name in ("sbatch", "scontrol", "squeue", "sinfo", "mpi", "siesta"):
            entry = site[name]
            if (not isinstance(entry, dict) or set(entry) != {"path", "sha256"}
                    or not isinstance(entry["path"], str) or not Path(entry["path"]).is_absolute()
                    or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None):
                raise Problem("ENGINE_UNAVAILABLE")
        if (site["partition"] != profile["slurm"]["partition"]
                or site["account"] != profile["slurm"]["account"]
                or site["qos"] != profile["slurm"]["qos"]
                or type(site["uid"]) is not int or site["uid"] < 0):
            raise Problem("ENGINE_UNAVAILABLE")
        runtime = profile.get("runtime", {})
        environment = runtime.get("environment", {})
        if (runtime.get("module_commands") != [] or runtime.get("launcher", {}).get("kind") != "openmpi"
                or runtime.get("launcher", {}).get("processes_per_node") != 4
                or profile.get("allocation", {}).get("nodes") != 1
                or profile.get("allocation", {}).get("total_cpus") != 4
                or environment.get("OMP_NUM_THREADS") != "1"
                or environment.get("OPENBLAS_NUM_THREADS") != "1"
                or environment.get("MKL_NUM_THREADS") != "1"
                or Path(environment.get("QRAFT_PYTHON", "")).resolve() != Path(sys.executable).resolve()):
            raise Problem("ENGINE_UNAVAILABLE")
        try:
            for name in ("sbatch", "scontrol", "squeue", "sinfo", "mpi", "siesta"):
                Binary(Path(site[name]["path"]), site[name]["sha256"]).verified()
        except (OSError, ProbeFailure):
            raise Problem("ENGINE_UNAVAILABLE") from None
        # sacct is a readonly system observation binary, never a submission
        # path. Pin its exact bytes for the lifetime of this local instance.
        sacct_path = SACCT_PATH
        try:
            sacct = Binary(sacct_path, SACCT_SHA256)
            sacct.verified()
        except (OSError, ProbeFailure):
            raise Problem("ENGINE_UNAVAILABLE") from None
        return cls(paths["site_config"], paths["profile"], paths["pseudo"], paths["wheelhouse"],
                   site, profile, profile_bytes, hashlib.sha256(profile_bytes).hexdigest(),
                   PROFILE_ID, pseudo_bytes, pseudo_digest, sacct)


class LocalRunAssets:
    """Per-project immutable profile/source assets for QRAFT's scope checks."""
    def __init__(self, repository, artifacts):
        self.repository, self.artifacts = repository, artifacts
        with repository.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS local_run_assets(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,asset_key TEXT NOT NULL,sha256 TEXT NOT NULL,artifact_id TEXT NOT NULL,media_type TEXT NOT NULL,PRIMARY KEY(owner_id,project_id,asset_key))")

    def ensure(self, owner, project_id, asset_key, data, kind, media_type):
        expected = hashlib.sha256(data).hexdigest()
        with self.repository._connection() as db:
            row = db.execute("SELECT sha256,artifact_id,media_type FROM local_run_assets WHERE owner_id=? AND project_id=? AND asset_key=?",
                             (owner.principal_id, project_id, asset_key)).fetchone()
        if row is not None:
            if row[0] != expected or row[2] != media_type:
                raise Problem("PRECONDITION_FAILED")
            record = self.artifacts.metadata(owner, row[1])
            if (record["project_id"] != project_id or record["payload"]["sha256"] != expected
                    or record["payload"]["media_type"] != media_type
                    or record["payload"]["kind"] != kind or not self.artifacts.verify(owner, row[1])):
                raise Problem("PRECONDITION_FAILED")
            return {"artifact_id": row[1], "sha256": expected, "media_type": media_type}
        request = {"project_id": project_id, "kind": kind, "media_type": media_type,
                   "size_bytes": len(data), "sha256": expected,
                   "idempotency_key": "localrun-"+identifier()}
        upload = self.artifacts.stage(owner, request)
        for start in range(0, len(data), 65536):
            end = min(len(data), start+65536)
            self.artifacts.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
        record = self.artifacts.commit(owner, upload["upload_id"])
        reference = {"artifact_id": record["payload"]["artifact_id"], "sha256": expected, "media_type": media_type}
        with self.repository.transaction() as db:
            db.execute("INSERT OR IGNORE INTO local_run_assets VALUES(?,?,?,?,?,?)",
                       (owner.principal_id, project_id, asset_key, expected, reference["artifact_id"], media_type))
            stored = db.execute("SELECT sha256,artifact_id,media_type FROM local_run_assets WHERE owner_id=? AND project_id=? AND asset_key=?",
                                (owner.principal_id, project_id, asset_key)).fetchone()
        if stored != (expected, reference["artifact_id"], media_type):
            if stored is None or stored[0] != expected or stored[2] != media_type:
                raise Problem("PRECONDITION_FAILED")
            reference = {"artifact_id": stored[1], "sha256": stored[0], "media_type": stored[2]}
        return reference


def _siesta_recipe(engines, assets, settings):
    api = engines.qraft
    profile = AuthoringProfile(settings.profile_id, 1, None)
    fdf = """SystemName Explicit DFT Lab Si small
SystemLabel si
XC.functional LDA
XC.authors CA
NumberOfSpecies 1
NumberOfAtoms 2
%block ChemicalSpeciesLabel
1 14 Si
%endblock ChemicalSpeciesLabel
PAO.BasisSize DZP
PAO.EnergyShift 0.02 Ry
LatticeConstant 1.0 Ang
%block LatticeVectors
0.0 2.7155 2.7155
2.7155 0.0 2.7155
2.7155 2.7155 0.0
%endblock LatticeVectors
AtomicCoordinatesFormat Fractional
%block AtomicCoordinatesAndAtomicSpecies
0.0 0.0 0.0 1
0.25 0.25 0.25 1
%endblock AtomicCoordinatesAndAtomicSpecies
MeshCutoff 200 Ry
%block kgrid_Monkhorst_Pack
2 0 0 0.0
0 2 0 0.0
0 0 2 0.0
%endblock kgrid_Monkhorst_Pack
Spin non-polarized
NetCharge 0
SolutionMethod diagon
SCF.DM.Tolerance 1.e-5
MD.TypeOfRun CG
MD.NumCGsteps 0
"""

    def resolve(owner, bundle):
        records = bundle.get("intent")
        run_intent = records.get("run_intent") if isinstance(records, dict) else None
        if not isinstance(run_intent, dict) or run_intent["payload"]["protocol"] != PROTOCOL:
            return None
        structure = bundle["structure"]["payload"]
        actual = {key: value for key, value in structure.items() if key not in {"structure_id", "revision", "parent_revision"}}
        expected_structure = {
            "convention": "cell-vectors-as-rows",
            "cell": {"vectors": [[0, 2.7155, 2.7155], [2.7155, 0, 2.7155], [2.7155, 2.7155, 0]], "unit": "angstrom"},
            "periodicity": [True, True, True], "coordinates": {"kind": "fractional"},
            "sites": [{"atom_id": "si-1", "species_label": "Si", "position": [0, 0, 0]},
                      {"atom_id": "si-2", "species_label": "Si", "position": [0.25, 0.25, 0.25]}],
            "transformations": [], "physical_intent": "BULK",
        }
        expected_model = {"xc": {"functional": "CA", "family": "LDA"}, "total_charge": {"value": 0, "unit": "e"},
                          "spin": "NONE", "relativistic": "SCALAR", "hubbard": None, "assumptions": []}
        parameters = {"basis": {"size": "DZP", "energy_shift": {"value": 0.02, "unit": "Ry"}},
                      "mesh_cutoff": {"value": 200, "unit": "Ry"},
                      "kgrid": {"kind": "MONKHORST_PACK", "divisions": [2, 2, 2], "shift": [0, 0, 0], "k_includes_2pi": False},
                      "smearing": None, "solver": "diagon", "tolerances": {"dm_tolerance": {"value": "1e-5", "unit": "1"}},
                      "convergence_target": "total_energy", "justification": "Explicit local authoring case; fixed parameters, no universal convergence/science claim."}
        numerical = {"policy": {"policy_id": "dftlab.qualification-scf", "version": "0.1.0", "digest": hashlib.sha256(canonical(parameters)).hexdigest()}, **parameters}
        if (actual != expected_structure or records["physical_model"]["payload"] != expected_model
                or records["numerical_policy"]["payload"] != numerical):
            raise Problem("PRECONDITION_FAILED")
        project_id = bundle["draft"]["project_id"]
        sources = {
            "Si.psml": assets.ensure(owner, project_id, "si.psml", settings.pseudo_bytes,
                                     "siesta.pseudopotential", "application/xml"),
            "single.fdf": assets.ensure(owner, project_id, "single.fdf", fdf.encode(),
                                         "siesta.input", "text/x-siesta-fdf"),
            "derived.fdf": assets.ensure(owner, project_id, "derived.fdf", (fdf+"DM.UseSaveDM true\n").encode(),
                                          "siesta.input", "text/x-siesta-fdf"),
        }
        fragments = []
        for step in ("single", "derived"):
            inputs = [{"name": "fdf", "source": step+".fdf", "destination": "main.fdf", "media_type": "text/x-siesta-fdf"},
                      {"name": "pseudo", "source": "Si.psml", "destination": "Si.psml", "media_type": "application/xml"}]
            ports = {"fdf": api.ArtifactPortContract("siesta.fdf", "text/x-siesta-fdf"),
                     "pseudo": api.ArtifactPortContract("siesta.pseudopotential", "application/xml")}
            if step == "derived":
                inputs.append({"name": "parent_dm", "from": {"task": "single", "output": "density"},
                               "destination": "si.DM", "media_type": "application/x-siesta-dm"})
                ports["parent_dm"] = api.ArtifactPortContract("siesta.density-matrix", "application/x-siesta-dm")
            fragments.append(api.WorkflowFragment.single(
                step, {"task_id": step, "kind": "calculation", "capability": "siestaflow.engine.siesta",
                       "inputs": inputs,
                       "outputs": [{"name": "density", "path": "si.DM", "artifact_type": "siesta.density-matrix",
                                    "media_type": "application/x-siesta-dm"}],
                       "resources": {"nodes": 1, "mpi_processes": 4, "processes_per_node": 4,
                                     "cpus_per_process": 1, "walltime_seconds": 60}}, input_contracts=ports))
        policy = api.RecipePolicy(PROTOCOL["protocol_id"], PROTOCOL["version"],
                                  "Explicit Si single/DM derivation", "Registered exact authoring case, no universal defaults")
        return AuthoringRecipe(policy, tuple(fragments), sources, settings.profile_id)

    def profile_resolver(owner, project, profile_id):
        if profile_id != settings.profile_id:
            raise Problem("ENGINE_UNAVAILABLE")
        return assets.ensure(owner, project, "execution-profile", settings.profile_bytes,
                             "qraft.execution-profile", "application/json")

    return profile, resolve, profile_resolver


class LocalRunApplication:
    """Trusted local execution composition used by API and processor processes."""
    @staticmethod
    def _migrate_local_runs(db):
        db.execute("CREATE TABLE IF NOT EXISTS local_run_migrations(version INTEGER PRIMARY KEY)")
        versions = [row[0] for row in db.execute("SELECT version FROM local_run_migrations ORDER BY version")]
        if not versions:
            db.execute("CREATE TABLE IF NOT EXISTS local_runs(run_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id),owner_id TEXT NOT NULL REFERENCES principals(principal_id),project_id TEXT NOT NULL REFERENCES projects(project_id),context TEXT NOT NULL,worker_result TEXT,terminal_evidence TEXT,finalization_receipt TEXT,last_terminal_check REAL NOT NULL DEFAULT 0)")
            db.execute("INSERT INTO local_run_migrations VALUES(1)")
            versions = [1]
        if versions == [1]:
            db.execute("ALTER TABLE local_runs ADD COLUMN terminal_state TEXT")
            db.execute("ALTER TABLE local_runs ADD COLUMN terminal_end_at TEXT")
            db.execute("ALTER TABLE local_runs ADD COLUMN terminal_min_job_age_seconds INTEGER")
            db.execute("INSERT INTO local_run_migrations VALUES(2)")
            versions = [1, 2]
        if versions != [1, 2]:
            raise ValueError("Explicit local-run migration required")

    def __init__(self, state, repository, artifacts, readmodels, drafts, options):
        self.state = private_directory(state)
        self.repository, self.artifacts, self.readmodels, self.drafts = repository, artifacts, readmodels, drafts
        self.settings = LocalRunSettings.load(options)
        self.history_commands = WslSacctBridge(self.settings.sacct)
        self.options = {key: str(value) for key, value in options.items()}
        self.engines = PinnedEngines(self.settings.wheelhouse)
        self.owner = repository.ensure_principal("local")
        self.assets = LocalRunAssets(repository, artifacts)
        profile, resolve, profile_resolver = _siesta_recipe(self.engines, self.assets, self.settings)
        authoring = QraftArtifactAuthoring(
            self.engines, artifacts, {(PROTOCOL["protocol_id"], PROTOCOL["version"]): resolve},
            {self.settings.profile_id: profile}, self.state/"authoring", profile_resolver=profile_resolver)
        self.authoring_handlers = AuthoringHandlers(repository, drafts, artifacts, authoring)
        self.budgets = SQLiteBudgetHolds(repository)
        self.ledger = SQLiteSubmissionLedger(repository)
        self.authority_store = SQLiteAuthorityStore(repository)
        self.authority_manager = LocalAuthorityManager(
            self.authority_store, self.state/"authority-locks", scope="qualified-local-WSL-SLURM")
        self.signer = LocalTerminalSigner(self.engines.qraft, "dftlab-local-terminal-v1", self._signing_key())
        try:
            zone_name = Path("/etc/timezone").read_text(encoding="utf-8").strip()
            self.completion_timezone = ZoneInfo(zone_name)
        except (OSError, ValueError):
            raise Problem("ENGINE_UNAVAILABLE") from None
        with repository.transaction() as db:
            self._migrate_local_runs(db)
        self.processor = Processor(repository,
            {**self.authoring_handlers.handlers(), "SUBMIT_RUN": self.submit_run},
            preflights={"SUBMIT_RUN": self.admission_preflight})
        self._last_poll = 0.0

    def capabilities(self):
        # The recipe is admitted privately; this flow does not publish a capability.
        return []

    def _signing_key(self):
        path = self.state/"terminal-signer.key"
        if path.is_symlink():
            raise Problem("ENGINE_UNAVAILABLE")
        try:
            value = path.read_bytes()
        except FileNotFoundError:
            value = secrets.token_bytes(32)
            try:
                _write_new(path, value)
            except FileExistsError:
                value = path.read_bytes()
        if len(value) != 32 or path.stat().st_mode & 0o077:
            raise Problem("ENGINE_UNAVAILABLE")
        return value

    def process(self, owner, operation_id):
        if owner.principal_id != self.owner.principal_id:
            raise Problem("FORBIDDEN")
        return self.processor.once(operation_id)

    @staticmethod
    def _timestamp(value):
        return value.isoformat(timespec="microseconds").replace("+00:00", "Z")

    def _artifact(self, owner, project_id, data, kind, media_type):
        request = {"project_id": project_id, "kind": kind, "media_type": media_type,
                   "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                   "idempotency_key": "localrun-"+identifier()}
        upload = self.artifacts.stage(owner, request)
        for start in range(0, len(data), 65536):
            end = min(len(data), start+65536)
            self.artifacts.write(owner, upload["upload_id"], start, end-1, len(data), data[start:end])
        record = self.artifacts.commit(owner, upload["upload_id"])
        return record, {key: record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}

    def _plan_package(self, owner, request):
        target = request["target"]
        plan_product = self.repository.local_product(owner, "PLAN", target["id"])
        plan = plan_product.document
        if plan["project_id"] != request["project_id"] or plan["payload"]["plan_id"] != request["payload"]["plan_id"]:
            raise Problem("NOT_FOUND")
        native_plan = plan["native_contract_refs"][0]
        package_record = self.artifacts.metadata(owner, request["payload"]["package_id"])
        package_payload = package_record["payload"]
        if (package_record["project_id"] != request["project_id"]
                or package_payload["kind"] != "qraft.run-package"
                or package_payload["media_type"] != "application/zip"
                or package_payload["integrity_state"] != "VERIFIED"
                or package_record["integrity"]["status"] != "VERIFIED"
                or not self.artifacts.verify(owner, package_payload["artifact_id"])):
            raise Problem("PRECONDITION_FAILED")
        pin = self.engines.lock["engines"]["qraft"]
        if (native_plan["engine"] != "qraft" or native_plan["distribution"] != pin["distribution"]
                or native_plan["commit"] != pin["commit"] or native_plan["verification"]["status"] != "VERIFIED"):
            raise Problem("ENGINE_UNAVAILABLE")
        return plan, native_plan, package_record

    def _probe_settings(self, project_id):
        profile = self.settings.profile
        allocation = profile["allocation"]
        memory = re.fullmatch(r"([1-9][0-9]*)M", allocation["memory"])
        if memory is None or allocation["nodes"] != 1 or allocation["total_cpus"] != 4:
            raise Problem("ENGINE_UNAVAILABLE")
        site = self.settings.site
        return ProbeSettings(
            self.settings.profile_id, 1, self.settings.profile_digest,
            Binary(Path(site["siesta"]["path"]), site["siesta"]["sha256"]),
            Binary(Path(site["mpi"]["path"]), site["mpi"]["sha256"]),
            Binary(Path(site["sinfo"]["path"]), site["sinfo"]["sha256"]),
            Binary(Path(site["scontrol"]["path"]), site["scontrol"]["sha256"]),
            Binary(Path(site["sbatch"]["path"]), site["sbatch"]["sha256"]),
            site["partition"], site["node"], 4, 1, int(memory[1]), self.state/"probe-workspace")

    def _admission_payload(self, operation, request, plan, native_plan, package, reason,
                           *, probe_ref=None, reservation=None, decision="REJECTED"):
        revision = operation["payload"]["target_refs"][0]["revision"] if operation["payload"].get("target_refs") else request["target"]["expected_revision"]
        expiry = datetime.now(timezone.utc)+timedelta(minutes=10)
        return {
            "principal_id": operation["payload"]["owner_principal_id"], "action": "SUBMIT_RUN",
            "purpose": request["payload"].get("admission_purpose", "EXPLORATORY"),
            "plan_digest": native_plan["digest"]["value"],
            "package_digest": package["payload"]["sha256"],
            "profile": {"profile_id": request.get("profile_ref") or self.settings.profile_id, "revision": 1},
            "qualification_refs": [], "runtime_probe_ref": probe_ref, "reservation": reservation,
            "decision": decision, "reasons": [reason], "expires_at": self._timestamp(expiry),
            "preconditions": [{"kind": "PLAN_REVISION", "expected": str(revision)}],
        }

    def _rejected(self, operation, request, plan, native_plan, package, reason):
        payload = self._admission_payload(operation, request, plan, native_plan, package, reason)
        return envelope("admission-receipt", request["project_id"], payload, contracts=self.repository.contracts)

    def admission_preflight(self, operation, request):
        owner = Principal(operation["payload"]["owner_principal_id"])
        previous = self.budgets.admitted(owner, operation["payload"]["operation_id"])
        if previous is not None:
            return previous
        plan, native_plan, package = self._plan_package(owner, request)
        purpose = request["payload"]["admission_purpose"]
        if purpose != "EXPLORATORY":
            return self._rejected(operation, request, plan, native_plan, package, "PURPOSE_NOT_ADMITTED")
        if request.get("profile_ref") != self.settings.profile_id:
            return self._rejected(operation, request, plan, native_plan, package, "PROFILE_NOT_ADMITTED")
        budget_id = request.get("budget_ref")
        if not budget_id:
            return self._rejected(operation, request, plan, native_plan, package, "BUDGET_UNAVAILABLE")
        try:
            account, held = self.budgets.get(owner, budget_id)
        except Problem:
            return self._rejected(operation, request, plan, native_plan, package, "BUDGET_UNAVAILABLE")
        allocation = self.settings.profile["allocation"]
        quantity = allocation["nodes"]*allocation["total_cpus"]*_walltime_seconds(allocation["walltime"])
        if (account.project_id != request["project_id"]
                or datetime.now(timezone.utc) >= datetime.fromisoformat(account.expires_at.replace("Z", "+00:00"))
                or held+quantity > account.capacity):
            return self._rejected(operation, request, plan, native_plan, package, "BUDGET_EXHAUSTED")
        if not self._terminal_history_route_available():
            return self._rejected(operation, request, plan, native_plan, package,
                                  "ruta de evidencia terminal no disponible")
        try:
            probe = SlurmRuntimeProbe().observe(request["project_id"], self._probe_settings(request["project_id"]))
        except (ProbeFailure, Problem, OSError, ValueError):
            return self._rejected(operation, request, plan, native_plan, package, "RUNTIME_PROBE_FAILED")
        probe_bytes = canonical(probe.receipt)
        _probe_record, probe_ref = self._artifact(owner, request["project_id"], probe_bytes,
                                                  "dftlab.runtime-probe-receipt", "application/json")
        base = self._admission_payload(operation, request, plan, native_plan, package,
                                       "EXPLORATORY_SCIENCE_NOT_ESTABLISHED", probe_ref=probe_ref["artifact_id"],
                                       decision="ADMITTED")
        base["expires_at"] = probe.receipt["payload"]["valid_until"]
        try:
            return self.budgets.admit(owner, budget_id, operation["payload"]["operation_id"], quantity, base)
        except Problem:
            # A concurrent reservation may consume the last capacity after the
            # readonly estimate. Reject without exposing a stale probe/reserve.
            return self._rejected(operation, request, plan, native_plan, package, "BUDGET_EXHAUSTED")

    def _terminal_history_route_available(self):
        """Fail closed before budget admission if trusted completion history is unreachable."""
        try:
            executable = self.settings.sacct.verified()
            argv = (str(executable), "--completion", "--jobs=440", "--noheader", "--parsable2",
                    "--format=JobID,User,Cluster,State,Start,End")
            observation = self.history_commands.run(
                argv, cwd=self.state, environment=dict(HISTORY_ENVIRONMENT))
            if observation.returncode != 0:
                return False
            rows = [line.strip().split("|") for line in observation.output.splitlines() if line.strip()]
            if len(rows) != 1 or len(rows[0]) != 6:
                return False
            row = rows[0]
            site = self.settings.site
            expected_user = f"{site['remote_user']}({site['uid']})"
            return (row[0] == "440" and row[1] == expected_user
                    and row[2] in {site["cluster"], "unknown"}
                    and row[3] in SlurmTerminalCollector.TERMINAL
                    and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", row[4]) is not None
                    and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", row[5]) is not None)
        except (ProbeFailure, Problem, OSError, ValueError):
            return False

    def _artifact_bytes(self, owner, project_id, reference, *, limit=_MAX_PACKAGE_BYTES):
        self.repository.contracts.validate("artifact-ref", reference)
        record = self.artifacts.metadata(owner, reference["artifact_id"])
        payload = record["payload"]
        if (record["project_id"] != project_id or payload["integrity_state"] != "VERIFIED"
                or record["integrity"]["status"] != "VERIFIED" or payload["sha256"] != reference["sha256"]
                or payload["media_type"] != reference["media_type"] or payload["size_bytes"] > limit
                or not self.artifacts.verify(owner, reference["artifact_id"])):
            raise Problem("PRECONDITION_FAILED")
        data = bytearray()
        for part in self.artifacts.stream(owner, reference["artifact_id"]):
            data.extend(part)
            if len(data) > limit:
                raise Problem("PAYLOAD_TOO_LARGE")
        result = bytes(data)
        if len(result) != payload["size_bytes"] or hashlib.sha256(result).hexdigest() != reference["sha256"]:
            raise Problem("PRECONDITION_FAILED")
        return result

    def _native_ref(self, owner, project_id, data, native_envelope, contract_name, native_digest):
        _record, artifact = self._artifact(owner, project_id, data, "qraft.run-lock", "application/json")
        pin = self.engines.lock["engines"]["qraft"]
        reference = {
            "engine": "qraft", "distribution": pin["distribution"], "version": pin["declared_version"],
            "commit": pin["commit"], "contract": str(contract_name),
            "digest": {"algorithm": "qraft.content-sha256-v1", "value": native_digest},
            "artifact": artifact, "verification": {"status": "VERIFIED", "verified_at": now()},
        }
        self.repository.contracts.validate("native-contract-ref", reference)
        return reference

    def _verify_package(self, context):
        owner = Principal(context["owner_id"])
        root = Path(context["root"])
        script = Path(context["script"])
        raw = self._artifact_bytes(owner, context["project_id"], context["package_ref"])
        if hashlib.sha256(raw).hexdigest() != context["package_ref"]["sha256"]:
            raise Problem("PRECONDITION_FAILED")
        archive, entries, run_id = _archive_entries(raw)
        try:
            if run_id != context["run_id"] or root != root.resolve() or not root.is_dir():
                raise Problem("PRECONDITION_FAILED")
            for entry in entries:
                if entry.is_dir():
                    continue
                relative = PurePosixPath(entry.filename).parts[1:]
                path = root.joinpath(*relative)
                if (path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root)
                        or path.read_bytes() != archive.read(entry)):
                    raise Problem("PRECONDITION_FAILED")
        finally:
            archive.close()
        if (script.is_symlink() or not script.is_file() or script.stat().st_size > 1024**2
                or _file_sha256(script) != context["script_sha256"]):
            raise Problem("PRECONDITION_FAILED")
        if self.engines.qraft.RunInspector().inspect(root).status != "PREPARED_RUN_VERIFIED":
            raise Problem("PRECONDITION_FAILED")

    def _script(self, root, run_id):
        original = (root/"submit.slurm").read_text(encoding="utf-8")
        lines = original.splitlines()
        try:
            marker = next(index for index, line in enumerate(lines) if line.strip() == "set -euo pipefail")
        except StopIteration:
            raise Problem("PRECONDITION_FAILED") from None
        header = lines[:marker]
        if (not header or not header[0].startswith("#!")
                or any(line.strip() and not line.lstrip().startswith("#") for line in header[1:])):
            raise Problem("PRECONDITION_FAILED")
        environment = self.settings.profile.get("runtime", {}).get("environment", {})
        if set(environment) != {"QRAFT_PYTHON", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "PATH"}:
            raise Problem("PRECONDITION_FAILED")
        command = [
            environment["QRAFT_PYTHON"], "-I", "-m", "dftlab_platform.local_run_worker",
            "--state-dir", str(self.state), "--run-id", run_id,
            "--site-config", self.options["site_config"], "--profile", self.options["profile"],
            "--pseudo", self.options["pseudo"], "--wheelhouse", self.options["wheelhouse"],
        ]
        body = "\n".join(header) + "\nset -euo pipefail\nunset PYTHONPATH\n"
        body += "".join("export " + key + "=" + shlex.quote(value) + "\n" for key, value in environment.items())
        body += "exec " + shlex.join(command) + "\n"
        script = root.parent/("dftlab-"+run_id+".slurm")
        _write_new(script, body.encode("utf-8"))
        return script, hashlib.sha256(body.encode("utf-8")).hexdigest()

    def _scheduler(self, context):
        owner = Principal(context["owner_id"])
        site = self.settings.site
        slurm_site = SlurmSite(
            Binary(Path(site["sbatch"]["path"]), site["sbatch"]["sha256"]),
            Binary(Path(site["scontrol"]["path"]), site["scontrol"]["sha256"]),
            Binary(Path(site["squeue"]["path"]), site["squeue"]["sha256"]),
            site["cluster"], site["remote_user"], site["uid"],
        )
        managed = ManagedSlurmPackage(
            Path(context["root"]), Path(context["script"]), context["script_sha256"],
            context["package_ref"], context["profile"], context["run_id"], 1,
            lambda: self._verify_package(context),
        )
        def evidence_writer(intent, document):
            _record, reference = self._artifact(owner, context["project_id"], canonical(document),
                                                "dftlab.scheduler-observation", "application/json")
            self.readmodels.publish_run_artifact(owner, context["run_id"], context["operation_id"],
                                                 context["attempt_id"], reference)
            return reference
        return SlurmSchedulerPort(
            slurm_site, {context["run_id"]: managed}, evidence_writer,
            lambda intent: self.ledger.enter_rpc(intent, context["processor_id"]),
        )

    def _projection(self, context, native_refs, admission_ref):
        timestamp = now()
        record = envelope("run-projection", context["project_id"], {
            "run_id": context["run_id"], "current_attempt_id": context["attempt_id"],
            "native_refs": native_refs,
            "dimensions": {
                "scheduler": {"value": "UNKNOWN", "source": "NO_SCHEDULER_OBSERVATION", "observed_at": None},
                "execution": {"value": "PREPARED", "source": "VERIFIED_NATIVE_PACKAGE", "observed_at": timestamp},
                "integrity": {"value": "VERIFIED", "source": "QRAFT_RUN_INSPECTOR_AND_PACKAGE_SHA256", "observed_at": timestamp},
                "science": {"value": "NOT_ESTABLISHED", "source": "EXPLORATORY_RUN_WITHOUT_SCIENTIFIC_ASSESSMENT", "observed_at": timestamp},
            },
            "source_revision": 1, "snapshot_cursor": context["run_id"]+":0",
        }, contracts=self.repository.contracts)
        self.readmodels.create_run(Principal(context["owner_id"]), record,
                                   context["operation_id"], context["attempt_id"])
        self.readmodels.publish_run_artifact(Principal(context["owner_id"]), context["run_id"],
                                             context["operation_id"], context["attempt_id"], admission_ref)
        return record

    def submit_run(self, operation, request):
        owner = Principal(operation["payload"]["owner_principal_id"])
        admission = self.budgets.admitted(owner, operation["payload"]["operation_id"])
        if admission is None or admission["payload"]["decision"] != "ADMITTED":
            raise Problem("PRECONDITION_FAILED")
        plan, native_plan, package_record = self._plan_package(owner, request)
        package = package_record["payload"]
        package_ref = {key: package[key] for key in ("artifact_id", "sha256", "media_type")}
        package_data = self._artifact_bytes(owner, request["project_id"], package_ref)
        run_root = _extract_package_for_operation(
            self.state, operation["payload"]["operation_id"], package_data)
        run_id = run_root.name
        self.repository.contracts.validate_ref(BASE+"schemas/defs.schema.json#/$defs/id", run_id)
        inspector = self.engines.qraft.RunInspector().inspect(run_root)
        if inspector.status != "PREPARED_RUN_VERIFIED":
            raise Problem("PRECONDITION_FAILED")
        run_lock_path, workflow_lock_path = run_root/"run.lock.json", run_root/"workflow.lock.json"
        run_envelope, native_run = self.engines.qraft.load_run_lock(run_lock_path)
        workflow_envelope, workflow = self.engines.qraft.load_workflow_lock(workflow_lock_path)
        profile_path = run_root/"execution-profile.json"
        if (not profile_path.is_file() or profile_path.is_symlink()):
            raise Problem("PRECONDITION_FAILED")
        try:
            packaged_profile = loads(profile_path.read_bytes())
        except (OSError, ValueError, UnicodeError):
            raise Problem("PRECONDITION_FAILED") from None
        if (not _normalized_profile_matches(self.settings.profile, packaged_profile)
                or native_run.run_id != run_id or native_run.project_id != request["project_id"]
                or native_run.workflow_id != workflow.workflow_id or workflow.project_id != request["project_id"]
                or native_run.workflow_lock_sha256 != workflow_envelope.content_sha256
                or native_run.execution_profile_id != self.settings.profile_id):
            raise Problem("PRECONDITION_FAILED")
        workflow_ref = plan["native_contract_refs"][0]
        if workflow_ref["digest"]["value"] != workflow_envelope.content_sha256:
            raise Problem("PRECONDITION_FAILED")
        run_ref = self._native_ref(owner, request["project_id"], run_lock_path.read_bytes(),
                                   run_envelope, run_envelope.contract, run_envelope.content_sha256)
        native_refs = [workflow_ref, run_ref]
        attempt_id, attempt_token = identifier(), identifier()
        script, script_sha256 = self._script(run_root, run_id)
        profile_ref = {"profile_id": self.settings.profile_id, "revision": 1}
        processor_id = self.processor.processor_id
        context = {
            "run_id": run_id, "operation_id": operation["payload"]["operation_id"],
            "owner_id": owner.principal_id, "project_id": request["project_id"],
            "root": str(run_root), "script": str(script), "script_sha256": script_sha256,
            "package_ref": package_ref, "profile": profile_ref, "attempt_id": attempt_id,
            "attempt_token": attempt_token, "processor_id": processor_id,
            "workflow_id": workflow.workflow_id, "workflow_digest": workflow_envelope.content_sha256,
            "run_digest": run_envelope.content_sha256,
            "profile_digest": native_run.execution_profile_sha256,
            "native_refs": native_refs,
        }
        probe_ref = admission["payload"]["runtime_probe_ref"]
        probe_record = self.artifacts.metadata(owner, probe_ref)
        probe_artifact = {key: probe_record["payload"][key] for key in ("artifact_id", "sha256", "media_type")}
        probe_receipt = loads(self._artifact_bytes(owner, request["project_id"], probe_artifact))
        self.repository.contracts.validate("runtime-probe-receipt", probe_receipt)
        context["probe_receipt"] = probe_receipt
        context["admission_receipt"] = admission
        _admission_record, admission_artifact = self._artifact(
            owner, request["project_id"], canonical(admission), "dftlab.admission-receipt", "application/json")
        intent = envelope("effect-intent", request["project_id"], {
            "effect_intent_id": identifier(), "operation_id": operation["payload"]["operation_id"],
            "action": "SUBMIT_RUN", "run_id": run_id, "attempt_id": attempt_id,
            "attempt_token": attempt_token, "package_ref": package_ref, "profile": profile_ref,
            "scheduler": "SLURM", "authority_generation": 1, "recorded_at": now(),
        }, contracts=self.repository.contracts)
        intent["native_contract_refs"] = native_refs
        reseal(intent)
        self.repository.contracts.validate("effect-intent", intent)
        context["intent"] = intent
        with self.repository.transaction() as db:
            db.execute("INSERT INTO local_runs(run_id,operation_id,owner_id,project_id,context) VALUES(?,?,?,?,?)",
                       (run_id, context["operation_id"], owner.principal_id, request["project_id"], canonical(context).decode()))
        self._projection(context, native_refs, admission_artifact)
        scheduler = self._scheduler(context)
        result = DurableSubmissions(self.repository, self.ledger, scheduler).perform(
            operation, processor_id, intent)
        self._update_dimensions(context, {
            "scheduler": {"value": "PENDING", "source": "SLURM_ACCEPTED_SUBMISSION_RECEIPT", "observed_at": now()},
            "execution": {"value": "SUBMITTED", "source": "SLURM_ACCEPTED_SUBMISSION_RECEIPT", "observed_at": now()},
        })
        return result

    def _update_dimensions(self, context, replacements):
        owner = Principal(context["owner_id"])
        dimension_order = {
            "scheduler": {"UNKNOWN": 0, "NOT_SUBMITTED": 0, "SUBMISSION_UNKNOWN": 1, "PENDING": 1,
                          "RUNNING": 2, "COMPLETED": 3, "FAILED": 3, "CANCELLED": 3,
                          "TIMEOUT": 3, "PREEMPTED": 3, "NODE_FAIL": 3, "OUT_OF_MEMORY": 3},
            "execution": {"UNKNOWN": -1, "PREPARED": 0, "SUBMITTED": 1, "RUNNING": 2,
                          "COLLECTING": 2, "COMPLETED": 3, "INTERRUPTED": 3, "FAILED": 3, "CANCELLED": 3},
        }
        for _attempt in range(5):
            record = self.readmodels.get(owner, "RUN", context["run_id"])
            previous = record["payload"]["dimensions"]
            payload = dict(record["payload"])
            dimensions = {key: dict(value) for key, value in previous.items()}
            changed = []
            for key, value in replacements.items():
                old = dimensions[key]
                order = dimension_order.get(key, {})
                may_degrade_to_unknown = key == "scheduler" and value["value"] == "UNKNOWN" and value.get("source") in {
                    "SLURM_JOB_CONTEXT_UNAVAILABLE",
                    "SLURM_JOB_STATE_UNMAPPED",
                    "SLURM_TERMINAL_SEEN_AWAITING_SIGNED_EVIDENCE",
                    "SLURM_TERMINAL_CONTEXT_UNAVAILABLE",
                    "SLURM_TERMINAL_OBSERVATION_CHANGED",
                    "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED",
                }
                if (not may_degrade_to_unknown and old["value"] in order and value["value"] in order
                        and order[old["value"]] > order[value["value"]]):
                    continue
                if old == value:
                    continue
                dimensions[key] = dict(value)
                changed.append(key)
            if not changed:
                return record
            payload["dimensions"] = dimensions
            payload["source_revision"] += 1
            updated = {**record, "payload": payload}
            reseal(updated)
            try:
                return self.readmodels.update_run(owner, updated, record["payload"]["source_revision"],
                                                  context["operation_id"], changed)
            except Problem as error:
                if error.code != "REVISION_CONFLICT":
                    raise
        raise Problem("REVISION_CONFLICT")

    def _worker(self, run_id):
        with self.repository._connection() as db:
            row = db.execute("SELECT context,worker_result FROM local_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise Problem("NOT_FOUND")
        context = loads(row[0])
        owner = Principal(context["owner_id"])
        root = Path(context["root"])
        if ("PYTHONPATH" in os.environ or not re.fullmatch(r"[1-9][0-9]*", os.environ.get("SLURM_JOB_ID", ""))
                or Path(os.environ.get("SLURM_SUBMIT_DIR", "")).resolve() != root.resolve()):
            raise Problem("PRECONDITION_FAILED")
        intent = self.repository.contracts.validate("effect-intent", context["intent"])
        scheduler = self._scheduler(context)
        def authorize_allocation():
            receipt = scheduler.find(intent)
            if receipt is None or receipt["payload"]["job"]["job_id"] != os.environ["SLURM_JOB_ID"]:
                raise Problem("PRECONDITION_FAILED")
            with self.repository._connection() as db:
                entry = db.execute("SELECT intent_hash FROM scheduler_rpc_entries WHERE operation_id=?",
                                   (context["operation_id"],)).fetchone()
            if entry != (hashlib.sha256(canonical(intent)).hexdigest(),):
                raise Problem("PRECONDITION_FAILED")
            self._update_dimensions(context, {
                "scheduler": {"value": "RUNNING", "source": "SLURM_JOB_CONTEXT_AND_DURABLE_RPC", "observed_at": now()},
                "execution": {"value": "RUNNING", "source": "QRAFT_NATIVE_WORKER_STARTED", "observed_at": now()},
            })
        registered = RegisteredNativeRun(
            root, context["project_id"], context["run_id"], context["workflow_id"],
            context["attempt_id"], context["profile"], context["workflow_digest"],
            context["run_digest"], context["profile_digest"], context["probe_receipt"],
            lambda: self._verify_package(context), authorize_allocation, generation=1,
        )
        def publication(summary, original):
            _raw_record, raw_ref = self._artifact(owner, context["project_id"], original,
                                                  "qraft.runtime-result-observation", "application/json")
            summary_bytes = canonical(summary)
            _summary_record, summary_ref = self._artifact(owner, context["project_id"], summary_bytes,
                                                          "dftlab.native-worker-summary", "application/json")
            result = {"summary": summary, "raw_result": raw_ref, "summary_artifact": summary_ref}
            def writer(db):
                db.execute("UPDATE local_runs SET worker_result=? WHERE run_id=? AND worker_result IS NULL",
                           (canonical(result).decode(), context["run_id"]))
                self.readmodels.publish_run_artifact_in(
                    db, owner, context["run_id"], context["operation_id"], context["attempt_id"], raw_ref)
                self.readmodels.publish_run_artifact_in(
                    db, owner, context["run_id"], context["operation_id"], context["attempt_id"], summary_ref)
            return writer
        return NativeWorker(self.engines, self.repository, self.authority_manager).run(
            owner, registered, environment=dict(os.environ), publication=publication)

    @staticmethod
    def _field(value, name, default=None):
        return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)

    def _declared_outputs(self, context):
        workflow_path = Path(context["root"])/"workflow.lock.json"
        _envelope, workflow = self.engines.qraft.load_workflow_lock(workflow_path)
        result = []
        for task in workflow.tasks:
            task_id = self._field(task, "task_id")
            for output in self._field(task, "outputs", ()) or ():
                name = self._field(output, "name")
                path = self._field(output, "path")
                if path is None:
                    path = self._field(output, "relative_path")
                artifact_type = self._field(output, "artifact_type")
                media_type = self._field(output, "media_type")
                if any(not isinstance(item, str) or not item for item in (task_id, name, path, artifact_type, media_type)):
                    raise Problem("PRECONDITION_FAILED")
                safe = PurePosixPath(path)
                if safe.is_absolute() or "\\" in path or any(part in {".", ".."} for part in path.split("/")):
                    raise Problem("PRECONDITION_FAILED")
                result.append({"task_id": task_id, "name": name, "path": path,
                               "artifact_type": artifact_type, "media_type": media_type})
        if {(item["task_id"], item["name"], item["path"]) for item in result} != {
                ("single", "density", "si.DM"), ("derived", "density", "si.DM")}:
            raise Problem("PRECONDITION_FAILED")
        return result

    def _output_artifacts(self, owner, context):
        root = Path(context["root"])
        outputs = self._declared_outputs(context)
        if len(outputs) > 256:
            raise Problem("PAYLOAD_TOO_LARGE")
        files = []
        for path in root.rglob("*"):
            if path.is_symlink():
                raise Problem("PRECONDITION_FAILED")
            if path.is_file():
                if len(files) >= _MAX_PACKAGE_FILES or path.stat().st_size > _MAX_PACKAGE_BYTES:
                    raise Problem("PAYLOAD_TOO_LARGE")
                files.append(path)
        found, unproduced = [], []
        for output in outputs:
            output_parts = PurePosixPath(output["path"]).parts
            candidates = []
            for path in files:
                relative = path.relative_to(root)
                parts = relative.parts
                if (len(parts) != 3 + len(output_parts) or parts[:2] != ("work", output["task_id"])
                        or re.fullmatch(r"attempt-[0-9]+", parts[2]) is None
                        or parts[3:] != output_parts):
                    continue
                evidence_path = path.parent / "attempt.json"
                if not evidence_path.is_file() or evidence_path.is_symlink():
                    continue
                try:
                    evidence = loads(evidence_path.read_bytes())
                except (OSError, ValueError, TypeError):
                    continue
                if not isinstance(evidence, dict) or not isinstance(evidence.get("payload"), dict):
                    continue
                payload = evidence["payload"]
                attempt = payload.get("attempt") if isinstance(payload, dict) else None
                native_json = self.engines.qraft_contracts().canonical_json(payload).encode("utf-8")
                if (not isinstance(attempt, dict) or not isinstance(attempt.get("artifacts"), dict)
                        or evidence.get("sha256") != hashlib.sha256(native_json).hexdigest()
                        or attempt.get("node_id") != output["task_id"]
                        or attempt.get("attempt_id") != parts[2]
                        or attempt.get("exit_code") != 0
                        or attempt["artifacts"].get(output["path"]) != _file_sha256(path)):
                    continue
                candidates.append(path)
            port = output["task_id"]+"."+output["name"]
            if not candidates:
                unproduced.append({"port": port, "reason": "NEVER_PRODUCED",
                                   "native_ref": context["native_refs"][0]})
                continue
            for path in candidates:
                data = path.read_bytes()
                _record, reference = self._artifact(owner, context["project_id"], data,
                                                    output["artifact_type"], output["media_type"])
                found.append(reference)
        return found, unproduced

    def _finalize(self, context, terminal):
        owner = Principal(context["owner_id"])
        with self.repository._connection() as db:
            row = db.execute("SELECT worker_result,terminal_evidence,finalization_receipt FROM local_runs WHERE run_id=?",
                             (context["run_id"],)).fetchone()
        if row is None:
            return
        worker_result = loads(row[0]) if row[0] is not None else None
        terminal_record = loads(row[1]) if row[1] is not None else None
        terminal_document = asdict(terminal)
        if terminal_record is None:
            if not self.signer.verify(terminal):
                raise Problem("PRECONDITION_FAILED")
        elif (not isinstance(terminal_record, dict)
              or not isinstance(terminal_record.get("native"), dict)
              or canonical(terminal_record["native"]) != canonical(terminal_document)):
            # A durable terminal record is written only after its fresh
            # signature was verified. Replays compare the exact native object
            # without asking the expired short-lived signer window to verify it
            # again.
            raise Problem("PRECONDITION_FAILED")
        if row[2] is not None:
            return self._project_terminal_dimensions(context, terminal, worker_result)
        output_refs, unproduced = self._output_artifacts(owner, context)
        receipt_refs = []
        if worker_result is not None:
            receipt_refs.extend((worker_result["raw_result"], worker_result["summary_artifact"]))
        expected = [*receipt_refs, *output_refs]
        verified = [reference for reference in expected
                    if self.artifacts.verify(owner, reference["artifact_id"])]
        if len(verified) != len(expected):
            raise Problem("PRECONDITION_FAILED")
        native_document = asdict(terminal)
        terminal_bytes = canonical(native_document)
        _terminal_record, terminal_ref = self._artifact(
            owner, context["project_id"], terminal_bytes,
            "qraft.terminal-scheduler-evidence", "application/json")
        self.readmodels.publish_run_artifact(owner, context["run_id"], context["operation_id"],
                                             context["attempt_id"], terminal_ref)
        state = "PUBLISHED" if not unproduced and worker_result is not None and terminal.state == "COMPLETED" and worker_result["summary"].get("native_status") == "COMPLETED" else "FAILED_VERIFICATION"
        with self.repository._connection() as db:
            sequence = db.execute("SELECT COALESCE(MAX(sequence),0) FROM run_events WHERE run_id=?",
                                  (context["run_id"],)).fetchone()[0]
        payload = {
            "run_id": context["run_id"], "attempt_id": context["attempt_id"],
            "native_refs": context["native_refs"], "journal_cursor": f"{context['run_id']}:{sequence}",
            "expected_artifacts": expected, "verified_artifacts": verified, "missing": [],
            "unproduced_outputs": unproduced, "validation_refs": [], "assessment_refs": [],
            "authority_generation": 1, "state": state,
        }
        receipt = envelope("finalization-receipt", context["project_id"], payload,
                           contracts=self.repository.contracts)
        _record, final_ref = self._artifact(owner, context["project_id"], canonical(receipt),
                                            "dftlab.finalization-receipt", "application/json")
        with self.repository.transaction() as db:
            db.execute("UPDATE local_runs SET terminal_evidence=?,finalization_receipt=? WHERE run_id=? AND finalization_receipt IS NULL",
                       (canonical({"native": native_document, "artifact_ref": terminal_ref}).decode(),
                        canonical(receipt).decode(), context["run_id"]))
            self.readmodels.publish_run_artifact_in(
                db, owner, context["run_id"], context["operation_id"], context["attempt_id"], final_ref)
        return self._project_terminal_dimensions(context, terminal, worker_result)

    def _project_terminal_dimensions(self, context, terminal, worker_result):
        scheduler_value = terminal.state if terminal.state in {"COMPLETED", "FAILED", "CANCELLED", "TIMEOUT", "PREEMPTED", "NODE_FAIL", "OUT_OF_MEMORY"} else "UNKNOWN"
        if terminal.state == "COMPLETED" and worker_result is not None and worker_result["summary"].get("native_status") == "COMPLETED":
            execution_value = "COMPLETED"
        elif terminal.state == "CANCELLED":
            execution_value = "CANCELLED"
        elif terminal.state == "COMPLETED" and worker_result is None:
            execution_value = "INTERRUPTED"
        else:
            execution_value = "FAILED"
        previous = self.readmodels.get(Principal(context["owner_id"]), "RUN", context["run_id"])
        updated = self._update_dimensions(context, {
            "scheduler": {"value": scheduler_value, "source": "SIGNED_QRAFT_TERMINAL_SCHEDULER_EVIDENCE", "observed_at": terminal.observed_at},
            "execution": {"value": execution_value, "source": "QRAFT_NATIVE_RESULT_AND_TERMINAL_EVIDENCE", "observed_at": terminal.observed_at},
            "integrity": {"value": "VERIFIED", "source": "PACKAGE_RESULT_AND_TERMINAL_ARTIFACT_SHA256", "observed_at": terminal.observed_at},
            "science": {"value": "NOT_ESTABLISHED", "source": "NO_SCIENTIFIC_ASSESSMENT_PERFORMED", "observed_at": terminal.observed_at},
        })
        return updated["payload"]["source_revision"] != previous["payload"]["source_revision"]

    def _terminal_from_document(self, document):
        value = document["native"]
        job = value["job"]
        return self.engines.qraft.TerminalSchedulerEvidence(
            **{**value, "job": self.engines.qraft.SchedulerJobIdentity(**job)})

    @staticmethod
    def _epoch_timestamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    @staticmethod
    def _terminal_expiry(end_at, min_job_age_seconds):
        if not isinstance(end_at, str) or type(min_job_age_seconds) is not int or min_job_age_seconds < 0:
            return None
        try:
            return datetime.fromisoformat(end_at).replace(tzinfo=timezone.utc).timestamp() + min_job_age_seconds
        except ValueError:
            return None

    def _scheduler_unknown(self, context, source, observed_at):
        previous = self.readmodels.get(Principal(context["owner_id"]), "RUN", context["run_id"])
        current = previous["payload"]["dimensions"]["scheduler"]
        if current["value"] == "UNKNOWN" and current["source"] == source:
            return False
        updated = self._update_dimensions(context, {
            "scheduler": {"value": "UNKNOWN", "source": source, "observed_at": observed_at},
        })
        return updated["payload"]["source_revision"] != previous["payload"]["source_revision"]

    def poll(self):
        if time.monotonic()-self._last_poll < 1.0:
            return False
        self._last_poll = time.monotonic()
        with self.repository._connection() as db:
            rows = db.execute("SELECT run_id,operation_id,context,worker_result,terminal_evidence,finalization_receipt,last_terminal_check,terminal_state,terminal_end_at,terminal_min_job_age_seconds FROM local_runs ORDER BY rowid").fetchall()
        changed = False
        for (run_id, operation_id, raw_context, worker_result, terminal_raw, final_raw, last_check,
             recorded_terminal_state, recorded_terminal_end_at, recorded_min_job_age) in rows:
            context = loads(raw_context)
            if final_raw is not None:
                if terminal_raw is not None:
                    try:
                        changed = self._finalize(context, self._terminal_from_document(loads(terminal_raw))) or changed
                    except (Problem, OSError, ValueError):
                        continue
                continue
            owner = Principal(context["owner_id"])
            operation = self.repository.operation(owner, operation_id)
            if terminal_raw is not None:
                try:
                    changed = self._finalize(context, self._terminal_from_document(loads(terminal_raw))) or changed
                except (Problem, OSError, ValueError):
                    continue
                continue
            try:
                intent, phase, saved = self.ledger.snapshot(owner, operation_id)
            except Problem:
                if operation["payload"]["state"] == "OUTCOME_UNKNOWN":
                    self._update_dimensions(context, {
                        "scheduler": {"value": "SUBMISSION_UNKNOWN", "source": "DISPATCH_OUTCOME_UNKNOWN_NO_RESUBMISSION", "observed_at": now()},
                        "execution": {"value": "UNKNOWN", "source": "DISPATCH_OUTCOME_UNKNOWN_NO_RESUBMISSION", "observed_at": now()},
                    })
                continue
            scheduler = self._scheduler(context)
            if operation["payload"]["state"] == "OUTCOME_UNKNOWN":
                DurableSubmissions(self.repository, self.ledger, scheduler).reconcile(owner, operation_id)
                operation = self.repository.operation(owner, operation_id)
                _intent, phase, saved = self.ledger.snapshot(owner, operation_id)
                if operation["payload"]["state"] == "OUTCOME_UNKNOWN":
                    self._update_dimensions(context, {
                        "scheduler": {"value": "SUBMISSION_UNKNOWN", "source": "DISPATCH_OUTCOME_UNKNOWN_NO_RESUBMISSION", "observed_at": now()},
                        "execution": {"value": "UNKNOWN", "source": "DISPATCH_OUTCOME_UNKNOWN_NO_RESUBMISSION", "observed_at": now()},
                    })
                    continue
            if saved is None:
                continue
            job_id = saved["payload"].get("job", {}).get("job_id")
            if not job_id:
                continue
            try:
                job_observation = scheduler.observe_job_state(intent, job_id)
            except (ProbeFailure, Problem, OSError, ValueError):
                current_time = time.time()
                expiry = self._terminal_expiry(recorded_terminal_end_at, recorded_min_job_age)
                if expiry is not None and current_time >= expiry:
                    changed = self._scheduler_unknown(
                        context, "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED", self._epoch_timestamp(expiry)) or changed
                elif recorded_terminal_state is not None:
                    changed = self._scheduler_unknown(
                        context, "SLURM_TERMINAL_CONTEXT_UNAVAILABLE",
                        self._epoch_timestamp(current_time)) or changed
                else:
                    changed = self._scheduler_unknown(
                        context, "SLURM_JOB_CONTEXT_UNAVAILABLE",
                        self._epoch_timestamp(current_time)) or changed
                continue

            observed_at = now()
            if job_observation.state in SlurmTerminalCollector.TERMINAL:
                first_terminal_observation = recorded_terminal_state is None
                if job_observation.end_time is None:
                    changed = self._scheduler_unknown(
                        context, "SLURM_TERMINAL_CONTEXT_UNAVAILABLE", observed_at) or changed
                    continue
                if (recorded_terminal_state is not None
                        and (recorded_terminal_state != job_observation.state
                             or recorded_terminal_end_at != job_observation.end_time
                             or recorded_min_job_age != job_observation.min_job_age_seconds)):
                    changed = self._scheduler_unknown(
                        context, "SLURM_TERMINAL_OBSERVATION_CHANGED", observed_at) or changed
                    continue
                recorded_terminal_state = job_observation.state
                recorded_terminal_end_at = job_observation.end_time
                recorded_min_job_age = job_observation.min_job_age_seconds
                with self.repository.transaction() as db:
                    db.execute(
                        "UPDATE local_runs SET terminal_state=COALESCE(terminal_state,?), terminal_end_at=COALESCE(terminal_end_at,?), terminal_min_job_age_seconds=COALESCE(terminal_min_job_age_seconds,?) WHERE run_id=?",
                        (recorded_terminal_state, recorded_terminal_end_at, recorded_min_job_age, run_id),
                    )
                changed = self._scheduler_unknown(
                    context, "SLURM_TERMINAL_SEEN_AWAITING_SIGNED_EVIDENCE", observed_at) or changed
                expiry = self._terminal_expiry(recorded_terminal_end_at, recorded_min_job_age)
                if expiry is None or time.time() >= expiry:
                    changed = self._scheduler_unknown(
                        context, "SLURM_TERMINAL_EVIDENCE_WINDOW_EXPIRED",
                        self._epoch_timestamp(expiry if expiry is not None else time.time())) or changed
                    continue
                # The first terminal observation always collects immediately,
                # even if a pre-upgrade poll left a recent timestamp. Only
                # bounded retries after a failed collection are throttled.
                if (not first_terminal_observation and time.time()-last_check < 10.0):
                    continue
                with self.repository.transaction() as db:
                    db.execute("UPDATE local_runs SET last_terminal_check=? WHERE run_id=?", (time.time(), run_id))
                try:
                    collected = SlurmTerminalCollector(
                        self.engines, scheduler, self.settings.sacct, self.signer,
                        history_commands=self.history_commands,
                        completion_timezone=self.completion_timezone, allow_unknown_cluster=True,
                    ).observe(intent, job_id)
                except (ProbeFailure, Problem, OSError, ValueError):
                    continue
                try:
                    if not self.signer.verify(collected.native):
                        continue
                    document = {"native": asdict(collected.native), "artifact_ref": None}
                    with self.repository.transaction() as db:
                        db.execute("UPDATE local_runs SET terminal_evidence=? WHERE run_id=? AND terminal_evidence IS NULL",
                                   (canonical(document).decode(), run_id))
                    self._finalize(context, collected.native)
                    changed = True
                except (Problem, OSError, ValueError):
                    continue
                continue

            if recorded_terminal_state is not None:
                changed = self._scheduler_unknown(
                    context, "SLURM_TERMINAL_OBSERVATION_CHANGED", observed_at) or changed
                continue
            if job_observation.state == "PENDING":
                scheduler_value = "PENDING"
            elif job_observation.state == "RUNNING":
                scheduler_value = "RUNNING"
            else:
                changed = self._scheduler_unknown(context, "SLURM_JOB_STATE_UNMAPPED", observed_at) or changed
                continue
            self._update_dimensions(context, {
                "scheduler": {"value": scheduler_value, "source": "SLURM_JOB_CONTEXT", "observed_at": observed_at},
            })
        return changed
