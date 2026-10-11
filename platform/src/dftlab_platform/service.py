"""Versioned FastAPI transport; shared contracts are the sole wire authority."""
from __future__ import annotations
import base64
from importlib.resources import files
import re

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from .contracts import BASE, Contracts, ContractError, canonical, loads
from .domain import Operations, Problem
from .security import LocalSettings, Sessions, SecurityMiddleware, PrivateErrors, session_cookie, single_header


def create_app(repository, artifacts, readmodels, settings: LocalSettings, sessions: Sessions | None = None, drafts=None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    sessions = sessions or Sessions()
    contracts = Contracts()
    if drafts is None:
        from .draft_storage import SQLiteDraftRepository
        drafts = SQLiteDraftRepository(repository, artifacts)
    app.state.sessions = sessions
    app.state.settings = settings
    app.add_middleware(SecurityMiddleware, settings=settings)
    from .web_assets import mount_assets
    mount_assets(app, settings.base_path)
    api = settings.base_path + "/api/v1"

    def problem_response(error):
        document = contracts.validate("problem", error.document())
        return JSONResponse(document, status_code=error.status, media_type="application/problem+json")

    @app.exception_handler(Problem)
    async def problem_handler(_request, error):
        return problem_response(error)

    @app.exception_handler(ContractError)
    async def validation_handler(_request, error):
        code = error.issues[0].code
        return problem_response(Problem(code if code in {"UNSUPPORTED_SCHEMA_VERSION", "PRECONDITION_FAILED"} else "VALIDATION_FAILED"))

    @app.exception_handler(HTTPException)
    async def http_handler(_request, error):
        return problem_response(Problem("NOT_FOUND" if error.status_code == 404 else "VALIDATION_FAILED"))

    @app.exception_handler(Exception)
    async def internal_handler(_request, _error):
        return problem_response(Problem("INTERNAL"))

    def principal(request):
        cookie = session_cookie(request.scope)
        owner = sessions.authenticate(cookie)
        csrf = None
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            csrf = single_header(request.scope, b"x-csrf-token")
            if csrf is None:
                raise Problem("CSRF_REJECTED")
        return sessions.authenticate(cookie, csrf) if csrf is not None else owner

    async def body(request, operation):
        if single_header(request.scope, b"content-type") not in {"application/json", "application/json; charset=utf-8"}:
            raise Problem("VALIDATION_FAILED")
        try:
            document = loads(await request.body())
        except (ValueError, UnicodeError, RecursionError):
            raise Problem("VALIDATION_FAILED") from None
        return contracts.validate_ref(contracts.api_ref(operation), document)

    def json_response(operation, status, document, headers=None):
        contracts.validate_ref(contracts.api_ref(operation, status=status), document)
        return Response(canonical(document), status, headers=headers, media_type="application/json")

    action_routes = {"validateInput": ("VALIDATE_INPUT", "PROJECT", "project_id"), "createCampaign": ("CREATE_CAMPAIGN", "PROJECT", "project_id"), "createPlan": ("CREATE_PLAN", "CAMPAIGN", "campaign_id"), "preparePackage": ("PREPARE_PACKAGE", "PLAN", "plan_id"), "submitRun": ("SUBMIT_RUN", "PLAN", "plan_id"), "cancelRun": ("CANCEL_RUN", "RUN", "run_id"), "reconcileRun": ("RECONCILE_RUN", "RUN", "run_id"), "createResumePlan": ("CREATE_RESUME_PLAN", "RUN", "run_id"), "executeResumePlan": ("EXECUTE_RESUME_PLAN", "RESUME_PLAN", "resume_plan_id")}

    def endpoint(operation):
        async def handle(request: Request):
            params = request.path_params
            if operation == "getHealth":
                return json_response(operation, 200, {"status": "OK", "api_version": "0.1.0"})
            if operation == "createSession":
                document = await body(request, operation)
                cookie, response = sessions.exchange(document["bootstrap_token"])
                result = json_response(operation, 201, response)
                result.set_cookie("dftlab_session", cookie, max_age=sessions.session_seconds, httponly=True, samesite="strict", secure=False, path=settings.base_path+"/")
                return result
            owner = principal(request)
            if operation == "getSession":
                return json_response(operation, 200, sessions.current(session_cookie(request.scope)))
            if operation == "createDraft":
                document = await body(request, operation)
                bundle, created = await run_in_threadpool(drafts.create, owner, params["project_id"], document)
                return json_response(operation, 201 if created else 200, bundle)
            if operation == "listDrafts":
                return json_response(operation, 200, await run_in_threadpool(drafts.list, owner, params["project_id"]))
            if operation == "getDraft":
                return json_response(operation, 200, await run_in_threadpool(drafts.get, owner, params["draft_id"]))
            if operation == "reviseDraft":
                document = await body(request, operation)
                bundle, created = await run_in_threadpool(drafts.revise, owner, params["draft_id"], document)
                return json_response(operation, 201 if created else 200, bundle)
            if operation == "deleteSession":
                sessions.revoke(session_cookie(request.scope))
                result = Response(status_code=204)
                result.delete_cookie("dftlab_session", path=settings.base_path+"/", httponly=True, samesite="strict")
                return result
            if operation == "listCapabilities":
                # No installed/qualified engine adapter yet. Never imply
                # EXECUTION merely because QRAFT/HubbardFlow exist upstream.
                return json_response(operation, 200, [])
            if operation == "listProjects":
                return json_response(operation, 200, await run_in_threadpool(repository.list_projects, owner))
            if operation == "createProject":
                document = await body(request, operation)
                project, created = await run_in_threadpool(repository.create_project, owner, document)
                return json_response(operation, 201 if created else 200, project)
            if operation == "getProject":
                return json_response(operation, 200, await run_in_threadpool(repository.project, owner, params["project_id"]))
            if operation == "getOperation":
                return json_response(operation, 200, await run_in_threadpool(repository.operation, owner, params["operation_id"]))
            if operation in action_routes:
                document = await body(request, operation)
                action, kind, name = action_routes[operation]
                if document["action"] != action or document["target"]["kind"] != kind or document["target"]["id"] != params[name]:
                    raise Problem("VALIDATION_FAILED")
                if action == "VALIDATE_INPUT":
                    contracts.validate_ref(BASE+"schemas/operation-request.schema.json#/$defs/validate_input_payload", document["payload"])
                target = await run_in_threadpool(readmodels.target, owner, kind, params[name])
                if document["project_id"] != target["project_id"]:
                    raise Problem("NOT_FOUND")
                # A typed command is not execution admission. Until Ola 3
                # adapters qualify this scope, do not accept an effect.
                raise Problem("ENGINE_UNAVAILABLE")
            if operation in {"getRun", "getResumePlan"}:
                kind, key = ("RUN", "run_id") if operation == "getRun" else ("RESUME_PLAN", "resume_plan_id")
                return json_response(operation, 200, await run_in_threadpool(readmodels.get, owner, kind, params[key]))
            if operation == "listRunEvents":
                if set(request.query_params) - {"after", "limit"} or len(request.query_params.multi_items()) != len(request.query_params):
                    raise Problem("VALIDATION_FAILED")
                try:
                    limit = int(request.query_params.get("limit", "100"))
                except ValueError:
                    raise Problem("VALIDATION_FAILED") from None
                result = await run_in_threadpool(readmodels.replay, owner, params["run_id"], request.query_params.get("after"), limit)
                if single_header(request.scope, b"accept") == "text/event-stream":
                    # Finite replay, no worker/authority tied to a socket.
                    data = (("id: "+event["stream_id"]+":"+str(event["sequence"])+"\nevent: "+event["type"]+"\ndata: ").encode()+canonical(event)+b"\n\n" for event in result["events"])
                    return StreamingResponse(data, media_type="text/event-stream")
                return json_response(operation, 200, result)
            if operation == "createUpload":
                document = await body(request, operation)
                try:
                    result = await run_in_threadpool(artifacts.stage, owner, document)
                except Problem as error:
                    if error.code == "NOT_FOUND":
                        raise Problem("FORBIDDEN") from None
                    raise
                return json_response(operation, 201, result)
            if operation == "putUploadRange":
                if single_header(request.scope, b"content-type") != "application/octet-stream":
                    raise Problem("VALIDATION_FAILED")
                header = single_header(request.scope, b"content-range") or ""
                match = re.fullmatch(r"bytes ([0-9]{1,16})-([0-9]{1,16})/([0-9]{1,16})", header)
                if not match:
                    raise Problem("RANGE_NOT_SATISFIABLE")
                start, end, total = map(int, match.groups())
                data = await request.body()  # middleware caps each chunk at 8 MiB
                result = await run_in_threadpool(artifacts.write, owner, params["upload_id"], start, end, total, data)
                return json_response(operation, 200, result)
            if operation == "commitUpload":
                return json_response(operation, 200, await run_in_threadpool(artifacts.commit, owner, params["upload_id"]))
            if operation == "getArtifact":
                return json_response(operation, 200, await run_in_threadpool(artifacts.metadata, owner, params["artifact_id"]))
            if operation == "getArtifactContent":
                record = await run_in_threadpool(artifacts.metadata, owner, params["artifact_id"])
                payload = record["payload"]
                start, end, status = 0, payload["size_bytes"]-1, 200
                header = single_header(request.scope, b"range")
                if header is not None:
                    match = re.fullmatch(r"bytes=([0-9]{1,16})-([0-9]{0,16})", header)
                    if not match:
                        raise Problem("RANGE_NOT_SATISFIABLE")
                    start = int(match[1])
                    end = int(match[2]) if match[2] else end
                    status = 206
                stream = await run_in_threadpool(artifacts.stream, owner, params["artifact_id"], start, end)
                headers = {"Accept-Ranges": "bytes", "Content-Length": str(end-start+1), "Digest": "sha-256="+base64.b64encode(bytes.fromhex(payload["sha256"])).decode(), "Content-Disposition": "attachment"}
                if status == 206:
                    headers["Content-Range"] = f"bytes {start}-{end}/{payload['size_bytes']}"
                return StreamingResponse(stream, status_code=status, media_type="application/octet-stream", headers=headers)
            if operation == "createTerminalSession":
                await body(request, operation)
                raise Problem("ENGINE_UNAVAILABLE")
            if operation == "closeTerminalSession":
                raise Problem("NOT_FOUND")
            raise Problem("ENGINE_UNAVAILABLE")
        return handle

    for path, methods in contracts.openapi["paths"].items():
        for method, definition in methods.items():
            if method in {"get", "post", "put", "delete"}:
                app.add_api_route(settings.base_path+path, endpoint(definition["operationId"]), methods=[method.upper()], include_in_schema=False)
    return PrivateErrors(app)
