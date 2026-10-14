#!/usr/bin/env python3
"""Run the fixed local Si recipe through the installed platform HTTP API.

This is a one-shot qualifier: it never repeats a mutation after a timeout or
ambiguous response. It saves each durable step as it progresses so the operator
can inspect and reconcile an incomplete run without creating another one.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener
import uuid

ROOT = Path(__file__).resolve().parents[2]
API_PREFIX = "/api/v1/"
PROFILE_ID = "wsl-slurm-openmpi-installed-qualification"
PROTOCOL = {"protocol_id": "dftlab.siesta.single-derived", "version": "0.1.0"}
POLICY_DIGEST = "5a3d78065c65bdbeba32d00f1e2bcc31050575718ec2c9f731aa1109428c69ff"
TERMINAL = {"COMPLETED", "CANCELLED", "INTERRUPTED", "FAILED"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


class API:
    def __init__(self, origin: str):
        parsed = urlsplit(origin)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.port or parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("Access origin must be a local HTTP origin")
        self.origin = f"http://{parsed.netloc}"
        self.opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.csrf = None

    def request(self, method: str, route: str, body=None, *, raw=False):
        if route.startswith("/") or ".." in route.split("/"):
            raise ValueError("Invalid API route")
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json_bytes(body)
        if method not in {"GET", "HEAD", "OPTIONS"}:
            headers["Origin"] = self.origin
        if method not in {"GET", "HEAD"} and route != "session":
            if not self.csrf:
                raise RuntimeError("No authenticated CSRF session")
            headers["X-CSRF-Token"] = self.csrf
        request = Request(self.origin + API_PREFIX + route, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                result = response.read()
                if response.status == 204:
                    value = None
                else:
                    value = json.loads(result)
        except HTTPError as error:
            document = error.read()
            try:
                problem = json.loads(document)
                code = problem.get("code", "HTTP_ERROR")
            except (ValueError, AttributeError):
                code = "HTTP_ERROR"
            raise RuntimeError(f"{method} {route}: HTTP {error.code} {code}") from None
        except (URLError, TimeoutError) as error:
            raise RuntimeError(f"{method} {route}: transport error ({type(error).__name__}); request was not retried") from None
        return (value, result) if raw else value

    def login(self, token: str):
        session = self.request("POST", "session", {"bootstrap_token": token})
        self.csrf = session["csrf_token"]
        return {"principal_id": session["principal_id"], "expires_at": session["expires_at"]}

    def binary(self, route: str) -> bytes:
        if route.startswith("/") or ".." in route.split("/"):
            raise ValueError("Invalid API route")
        request = Request(self.origin + API_PREFIX + route,
                          headers={"Accept": "application/octet-stream"}, method="GET")
        try:
            with self.opener.open(request, timeout=60) as response:
                return response.read()
        except HTTPError as error:
            document = error.read()
            try:
                code = json.loads(document).get("code", "HTTP_ERROR")
            except (ValueError, AttributeError):
                code = "HTTP_ERROR"
            raise RuntimeError(f"GET {route}: HTTP {error.code} {code}") from None
        except (URLError, TimeoutError) as error:
            raise RuntimeError(f"GET {route}: transport error ({type(error).__name__})") from None


def si_intent() -> dict:
    return {
        "operation": "dftlab.scf",
        "protocol": PROTOCOL,
        "physical_model": {
            "xc": {"functional": "CA", "family": "LDA"},
            "total_charge": {"value": 0, "unit": "e"},
            "spin": "NONE",
            "relativistic": "SCALAR",
            "hubbard": None,
            "assumptions": [],
        },
        "numerical_policy": {
            "policy": {"policy_id": "dftlab.qualification-scf", "version": "0.1.0", "digest": POLICY_DIGEST},
            "basis": {"size": "DZP", "energy_shift": {"value": 0.02, "unit": "Ry"}},
            "mesh_cutoff": {"value": 200, "unit": "Ry"},
            "kgrid": {"kind": "MONKHORST_PACK", "divisions": [2, 2, 2], "shift": [0, 0, 0], "k_includes_2pi": False},
            "smearing": None,
            "solver": "diagon",
            "tolerances": {"dm_tolerance": {"value": "1e-5", "unit": "1"}},
            "convergence_target": "total_energy",
            "justification": "Explicit local authoring case; fixed parameters, no universal convergence/science claim.",
        },
    }


def product_id(operation: dict, kind: str) -> str | None:
    result = operation.get("payload", {}).get("result") or {}
    refs = result.get("product_refs") or (result.get("receipt") or {}).get("payload", {}).get("product_refs") or []
    return next((item.get("id") for item in refs if item.get("kind") == kind), None)


def atomic_json(path: Path, value: dict) -> bytes:
    data = json_bytes(value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)
    return data


def run(args) -> int:
    started = time.monotonic()
    output_dir = args.output_dir.resolve()
    evidence_root = (ROOT / "deployment" / "local" / "evidence").resolve()
    if not output_dir.is_relative_to(evidence_root) or output_dir == evidence_root or output_dir.exists():
        raise ValueError("Output must be a new child directory of deployment/local/evidence")
    output_dir.mkdir(parents=True, mode=0o700)
    artifact_dir = output_dir / "artifacts"
    artifact_dir.mkdir(mode=0o700)
    evidence_path = output_dir / "http-local-run.json"
    evidence = {
        "schema_version": 1,
        "status": "IN_PROGRESS",
        "route": "HTTP",
        "started_at": utc_now(),
        "timeout_seconds": args.timeout_seconds,
        "steps": {},
        "artifacts": [],
        "claims": {
            "purpose": "EXPLORATORY",
            "scientific_assessment": "NOT_ESTABLISHED",
            "capabilities_published_for_execution": False,
        },
    }

    def persist():
        evidence["elapsed_seconds"] = round(time.monotonic() - started, 3)
        evidence["updated_at"] = utc_now()
        atomic_json(evidence_path, evidence)

    def record_step(name: str, value):
        previous = evidence["steps"].get(name)
        evidence["steps"][name] = value
        persist()
        payload = value.get("payload", {}) if isinstance(value, dict) else {}
        dimensions = payload.get("dimensions", {})
        marker = (payload.get("state"), payload.get("decision"),
                  tuple((key, dimensions.get(key, {}).get("value"))
                        for key in ("scheduler", "execution", "integrity", "science")))
        old_payload = previous.get("payload", {}) if isinstance(previous, dict) else {}
        old_dimensions = old_payload.get("dimensions", {})
        old_marker = (old_payload.get("state"), old_payload.get("decision"),
                      tuple((key, old_dimensions.get(key, {}).get("value"))
                            for key in ("scheduler", "execution", "integrity", "science")))
        if previous is None or marker != old_marker:
            print(f"{name}: {payload.get('state') or payload.get('decision') or 'saved'}", flush=True)

    def wait_operation(api: API, operation: dict, label: str) -> dict:
        operation_id = operation["payload"]["operation_id"]
        evidence.setdefault("operation_ids", {})[label] = operation_id
        record_step(label, operation)
        deadline = time.monotonic() + args.timeout_seconds
        value = operation
        while value["payload"]["state"] in {"PENDING", "RUNNING"}:
            if time.monotonic() >= deadline:
                evidence["status"] = "OPERATION_TIMEOUT_NO_RETRY"
                evidence["incomplete_operation_id"] = operation_id
                persist()
                raise TimeoutError(f"{label} timed out; operation {operation_id} saved; no mutation was retried")
            time.sleep(2)
            value = api.request("GET", "operations/" + quote(operation_id, safe=""))
            record_step(label, value)
        if value["payload"]["state"] == "OUTCOME_UNKNOWN":
            evidence["status"] = "OUTCOME_UNKNOWN_NO_RETRY"
            evidence["incomplete_operation_id"] = operation_id
            persist()
            raise RuntimeError(f"{label} is OUTCOME_UNKNOWN; inspect operation {operation_id}; no mutation was retried")
        return value

    def action(api: API, name: str, route: str, target: dict, payload: dict, *, profile_ref=None, budget_ref=None):
        request = {
            "action": re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper(),
            "project_id": evidence["project_id"],
            "target": {"kind": target["kind"], "id": target["id"], "expected_revision": target["revision"]},
            "payload": payload,
            "idempotency_key": uuid.uuid4().hex,
        }
        if profile_ref is not None:
            request["profile_ref"] = profile_ref
        if budget_ref is not None:
            request["budget_ref"] = budget_ref
        accepted = api.request("POST", route, request)
        return wait_operation(api, accepted, name)

    def save_artifacts(api: API, run_id: str, events: list[dict]):
        references = {}
        for event in events:
            reference = event.get("payload", {}).get("artifact")
            if isinstance(reference, dict) and reference.get("artifact_id"):
                references[reference["artifact_id"]] = reference
            for reference in event.get("evidence_refs", []):
                if isinstance(reference, dict) and reference.get("artifact_id"):
                    references[reference["artifact_id"]] = reference
        for artifact_id, reference in references.items():
            record = api.request("GET", "artifacts/" + quote(artifact_id, safe=""))
            content = api.binary("artifacts/" + quote(artifact_id, safe="") + "/content")
            metadata = record["payload"]
            digest = sha256(content)
            if (digest != reference["sha256"] or digest != metadata["sha256"]
                    or metadata["integrity_state"] != "VERIFIED" or len(content) != metadata["size_bytes"]):
                raise RuntimeError(f"Artifact {artifact_id} failed integrity verification")
            suffix = ".json" if metadata["media_type"] == "application/json" else ".bin"
            filename = re.sub(r"[^A-Za-z0-9._-]", "_", metadata["kind"]) + "-" + artifact_id + suffix
            path = artifact_dir / filename
            path.write_bytes(content)
            entry = {
                "artifact_id": artifact_id,
                "kind": metadata["kind"],
                "media_type": metadata["media_type"],
                "size_bytes": len(content),
                "sha256": digest,
                "path": str(path.relative_to(output_dir)).replace("\\", "/"),
            }
            if metadata["media_type"] == "application/json":
                try:
                    parsed = json.loads(content)
                    if metadata["kind"] == "dftlab.admission-receipt":
                        evidence["admission_receipt"] = parsed
                    elif metadata["kind"] == "dftlab.finalization-receipt":
                        evidence["finalization_receipt"] = parsed
                    elif metadata["kind"] == "qraft.runtime-result-observation":
                        evidence["qraft_result_original"] = parsed
                        evidence["qraft_result_sha256"] = digest
                except (UnicodeDecodeError, ValueError):
                    pass
            evidence["artifacts"].append(entry)
            persist()
        return references

    try:
        access = json.loads(args.access_file.read_text(encoding="utf-8"))
        api = API(access["origin"])
        session = api.login(access["bootstrap_token"])
        record_step("session", session)
        health = api.request("GET", "health")
        if health.get("status") != "OK" or health.get("api_version") != "0.1.0":
            raise RuntimeError("Unsupported local API health response")
        capabilities = api.request("GET", "capabilities")
        evidence["capabilities_response"] = capabilities
        if any("execution" in json.dumps(item, ensure_ascii=False).lower() for item in capabilities):
            raise RuntimeError("The local service published an execution capability")
        evidence["api_version"] = health["api_version"]
        evidence["principal_id"] = session["principal_id"]
        evidence["origin"] = api.origin
        record_step("health_and_capabilities", {"health": health, "capability_count": len(capabilities)})

        project = api.request("POST", "projects", {
            "name": "Si primer cálculo real · HTTP",
            "idempotency_key": uuid.uuid4().hex,
        })
        project_id = project["project_id"]
        evidence["project_id"] = project_id
        record_step("project", project)

        budget_command = [
            sys.executable, "-I", "-m", "dftlab_platform.launcher", "budget", "add",
            "--state-dir", str(args.state_dir), "--project", project_id,
            "--cpu-seconds", str(args.cpu_seconds), "--expires-hours", str(args.expires_hours),
        ]
        result = subprocess.run(budget_command, capture_output=True, text=True, encoding="utf-8", timeout=30, check=False)
        if result.returncode != 0:
            raise RuntimeError("Operator budget registration failed: " + result.stderr.strip()[-500:])
        budget = json.loads(result.stdout)
        evidence["budget_id"] = budget["budget_id"]
        record_step("budget", {key: value for key, value in budget.items() if key != "secret"})

        fixture = json.loads((ROOT / "contracts" / "fixtures" / "structure-revision" / "valid" / "si-diamond.json").read_text(encoding="utf-8"))
        structure = fixture["payload"]
        structure.pop("structure_id", None)
        structure.pop("revision", None)
        structure.pop("parent_revision", None)
        # The generic contract fixture rounds the Si lattice to 2.715 Å;
        # this registered local recipe is pinned to 2.7155 Å in its FDF.
        # Keep the real request aligned with that explicit recipe geometry.
        structure["cell"]["vectors"] = [[0, 2.7155, 2.7155], [2.7155, 0, 2.7155], [2.7155, 2.7155, 0]]
        structure["sites"][0]["atom_id"] = "si-1"
        structure["sites"][1]["atom_id"] = "si-2"
        draft_bundle = api.request("POST", "projects/" + quote(project_id, safe="") + "/drafts", {
            "idempotency_key": uuid.uuid4().hex,
            "title": "Si diamante · primer cálculo real por HTTP",
            "origin": {"kind": "LEARNING_PROMOTION", "learning_dataset_id": "ld-si", "exported_kind": "TEMPLATE", "source_artifact": None},
            "purpose": "EXPLORATORY",
            "structure": structure,
            "intent": si_intent(),
        })
        draft = draft_bundle["draft"]
        evidence["draft_id"] = draft["payload"]["draft_id"]
        record_step("draft", draft_bundle)

        operation = action(api, "validateInput", "projects/" + quote(project_id, safe="") + "/validations",
                           {"kind": "PROJECT", "id": project_id, "revision": project["revision"]},
                           {"draft": {"draft_id": draft["payload"]["draft_id"], "revision": draft["payload"]["revision"]}})
        if operation["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Input validation did not succeed: " + operation["payload"]["state"])
        validation_id = product_id(operation, "VALIDATION_RECEIPT")
        if not validation_id:
            result = operation["payload"].get("result") or {}
            validation_id = result.get("validation_receipt_id") or (result.get("receipt") or {}).get("record_id")
        if not validation_id:
            raise RuntimeError("Validation operation returned no receipt identity")
        record_step("validation_receipt", api.request("GET", "validation-receipts/" + quote(validation_id, safe="")))
        project = api.request("GET", "projects/" + quote(project_id, safe=""))
        if project["revision"] <= evidence["steps"]["project"]["revision"]:
            raise RuntimeError("Validation did not advance the project revision")
        record_step("project_after_validation", project)

        operation = action(api, "createCampaign", "projects/" + quote(project_id, safe="") + "/campaigns",
                           {"kind": "PROJECT", "id": project_id, "revision": project["revision"]},
                           {"name": "Si diamante · primer cálculo real por HTTP",
                            "drafts": [{"draft_id": draft["payload"]["draft_id"], "revision": draft["payload"]["revision"]}]})
        if operation["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Campaign operation did not succeed: " + operation["payload"]["state"])
        campaign_id = product_id(operation, "CAMPAIGN")
        if not campaign_id:
            raise RuntimeError("Campaign operation returned no product identity")
        campaign = api.request("GET", "campaigns/" + quote(campaign_id, safe=""))
        record_step("campaign", {"operation": operation, "campaign": campaign})

        operation = action(api, "createPlan", "campaigns/" + quote(campaign_id, safe="") + "/plans",
                           {"kind": "CAMPAIGN", "id": campaign_id, "revision": campaign["payload"]["revision"]},
                           {"draft": {"draft_id": draft["payload"]["draft_id"], "revision": draft["payload"]["revision"]},
                            "intent_id": draft["payload"]["intent_id"], "validation_receipt_id": validation_id})
        if operation["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Plan operation did not succeed: " + operation["payload"]["state"])
        plan_id = product_id(operation, "PLAN")
        if not plan_id:
            raise RuntimeError("Plan operation returned no product identity")
        plan = api.request("GET", "plans/" + quote(plan_id, safe=""))
        record_step("plan", {"operation": operation, "plan": plan})

        native_ref = next((reference for reference in plan.get("native_contract_refs", []) if reference.get("engine") == "qraft"), None)
        if not native_ref or not native_ref.get("digest", {}).get("value"):
            raise RuntimeError("Plan lacks the original verified QRAFT digest")
        operation = action(api, "preparePackage", "plans/" + quote(plan_id, safe="") + "/packages",
                           {"kind": "PLAN", "id": plan_id, "revision": plan["payload"]["revision"]},
                           {"expected_plan_digest": native_ref["digest"]},
                           profile_ref=PROFILE_ID)
        if operation["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Package operation did not succeed: " + operation["payload"]["state"])
        package_id = product_id(operation, "PACKAGE")
        if not package_id:
            raise RuntimeError("Package operation returned no product identity")
        package_record = api.request("GET", "artifacts/" + quote(package_id, safe=""))
        package_bytes = api.binary("artifacts/" + quote(package_id, safe="") + "/content")
        if sha256(package_bytes) != package_record["payload"]["sha256"]:
            raise RuntimeError("Prepared package content failed SHA-256 verification")
        package_path = artifact_dir / ("qraft-run-package-" + package_id + ".bin")
        package_path.write_bytes(package_bytes)
        evidence["input_hashes"] = {
            "qraft_package_sha256": sha256(package_bytes),
            "pseudo_sha256": sha256(args.pseudo.read_bytes()),
            "profile_sha256": sha256(args.profile.read_bytes()),
            "engine_lock_sha256": sha256((ROOT / "engine-versions.lock.json").read_bytes()),
            "qraft_wheel_sha256": sha256((args.wheelhouse / "qraft_hpc-0.2.0-py3-none-any.whl").read_bytes()),
            "hubbardflow_wheel_sha256": sha256((args.wheelhouse / "hubbardflow-0.1.3-py3-none-any.whl").read_bytes()),
        }
        record_step("package", {"operation": operation, "artifact": package_record, "content_path": str(package_path.relative_to(output_dir)).replace("\\", "/"),
                                "content_sha256": sha256(package_bytes), "size_bytes": len(package_bytes)})
        plan = api.request("GET", "plans/" + quote(plan_id, safe=""))
        if plan["payload"]["revision"] <= 1:
            raise RuntimeError("Package preparation did not advance the plan revision")
        record_step("plan_after_package", plan)

        request = {
            "action": "SUBMIT_RUN",
            "project_id": project_id,
            "target": {"kind": "PLAN", "id": plan_id, "expected_revision": plan["payload"]["revision"]},
            "payload": {"plan_id": plan_id, "package_id": package_id, "admission_purpose": "EXPLORATORY"},
            "idempotency_key": uuid.uuid4().hex,
            "profile_ref": PROFILE_ID,
            "budget_ref": evidence["budget_id"],
        }
        accepted = api.request("POST", "plans/" + quote(plan_id, safe="") + "/runs", request)
        operation = wait_operation(api, accepted, "submitRun")
        if operation["payload"]["state"] == "REJECTED":
            receipt = (operation["payload"].get("result") or {}).get("receipt")
            if receipt:
                evidence["admission_receipt"] = receipt
                atomic_json(output_dir / "admission-receipt.json", receipt)
            evidence["status"] = "ADMISSION_REJECTED"
            persist()
            raise RuntimeError("Admission rejected: " + ",".join((receipt or {}).get("payload", {}).get("reasons", [])))
        if operation["payload"]["state"] != "SUCCEEDED":
            raise RuntimeError("Submission operation did not succeed: " + operation["payload"]["state"])
        submission = ((operation["payload"].get("result") or {}).get("receipt")
                      or (operation["payload"].get("result") or {}).get("submission_receipt") or {})
        evidence["submission_receipt"] = submission
        atomic_json(output_dir / "submission-receipt.json", submission)
        runs = api.request("GET", "projects/" + quote(project_id, safe="") + "/runs?" + urlencode({"limit": "200"}))
        items = runs.get("items", [])
        if len(items) != 1:
            raise RuntimeError(f"Expected one RUN projection after submission, found {len(items)}")
        run_id = items[0]["payload"]["run_id"]
        evidence["run_id"] = run_id
        record_step("run_created", {"run_id": run_id, "submission_receipt": submission})

        deadline = time.monotonic() + args.timeout_seconds
        projection = items[0]
        while projection["payload"]["dimensions"]["execution"]["value"] not in TERMINAL:
            if time.monotonic() >= deadline:
                evidence["status"] = "RUN_TIMEOUT_NO_RESUBMIT"
                persist()
                raise TimeoutError(f"Run {run_id} did not reach a terminal state; preserved for inspection; do not resubmit")
            time.sleep(2)
            projection = api.request("GET", "runs/" + quote(run_id, safe=""))
            record_step("latest_projection", projection)

        projection, projection_raw = api.request("GET", "runs/" + quote(run_id, safe=""), raw=True)
        (output_dir / "get-run.json").write_bytes(projection_raw)
        evidence["get_run"] = {
            "path": "get-run.json",
            "sha256": sha256(projection_raw),
            "run_id": run_id,
            "dimensions": projection["payload"]["dimensions"],
        }
        record_step("get_run", evidence["get_run"])

        events = []
        cursor = None
        for _ in range(100):
            query = {"limit": "500"}
            if cursor:
                query["after"] = cursor
            page = api.request("GET", "runs/" + quote(run_id, safe="") + "/events?" + urlencode(query))
            events.extend(page.get("events", []))
            next_cursor = page.get("next_cursor")
            if not page.get("events") or not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
        events_path = output_dir / "run-events.json"
        events_raw = atomic_json(events_path, {"events": events})
        evidence["run_events"] = {"path": "run-events.json", "count": len(events), "sha256": sha256(events_raw)}
        save_artifacts(api, run_id, events)

        db_path = args.state_dir / "state.sqlite"
        db_uri = "file:" + quote(str(db_path.resolve()).replace("\\", "/"), safe="/:") + "?mode=ro"
        with sqlite3.connect(db_uri, uri=True) as db:
            db.execute("PRAGMA query_only=ON")
            rows = db.execute("SELECT resource_id,project_id,revision FROM resources WHERE kind='RUN' ORDER BY rowid").fetchall()
        evidence["database_readonly_run_query"] = {
            "query": "SELECT resource_id,project_id,revision FROM resources WHERE kind='RUN' ORDER BY rowid",
            "rows": [{"run_id": row[0], "project_id": row[1], "revision": row[2]} for row in rows],
            "this_run_present": any(row[0] == run_id for row in rows),
        }
        if not evidence["database_readonly_run_query"]["this_run_present"]:
            raise RuntimeError("Read-only resources.kind=RUN query did not find this run")

        evidence["job_id"] = (submission.get("payload", {}).get("job") or {}).get("job_id")
        evidence["final_execution_state"] = projection["payload"]["dimensions"]["execution"]["value"]
        evidence["status"] = "COMPLETED" if evidence["final_execution_state"] == "COMPLETED" else "RUN_TERMINAL"
        evidence["completed_at"] = utc_now()
        persist()
        print(json.dumps({
            "status": evidence["status"], "project_id": project_id, "run_id": run_id,
            "job_id": evidence["job_id"], "elapsed_seconds": evidence["elapsed_seconds"],
            "admission": (evidence.get("admission_receipt") or {}).get("payload", {}).get("decision"),
            "evidence_dir": str(output_dir),
            "get_run_sha256": evidence["get_run"]["sha256"],
            "run_row_present": evidence["database_readonly_run_query"]["this_run_present"],
        }, ensure_ascii=False, sort_keys=True))
        return 0 if evidence["status"] == "COMPLETED" else 1
    except Exception as error:
        if evidence["status"] == "IN_PROGRESS":
            evidence["status"] = "FAILED_BEFORE_COMPLETION"
        evidence["error"] = f"{type(error).__name__}: {error}"
        evidence["completed_at"] = utc_now()
        persist()
        print(json.dumps({"status": evidence["status"], "error": evidence["error"],
                          "run_id": evidence.get("run_id"), "evidence_dir": str(output_dir)},
                         ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--access-file", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--pseudo", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--cpu-seconds", type=int, default=2400)
    parser.add_argument("--expires-hours", type=int, default=24)
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "deployment" / "local" / "evidence" / ("si-http-" + datetime.now().strftime("%Y%m%d-%H%M%S")))
    args = parser.parse_args()
    if args.cpu_seconds < 1 or args.expires_hours < 1 or args.timeout_seconds < 60:
        parser.error("CPU seconds, expiry and timeout must be positive and timeout at least 60 seconds")
    try:
        return run(args)
    except Exception as error:
        print(json.dumps({"status": "FAILED_BEFORE_RUN", "error": f"{type(error).__name__}: {error}"},
                         ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
