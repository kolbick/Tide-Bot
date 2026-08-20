from __future__ import annotations

import asyncio
import json
import signal
import time
import uuid
from pathlib import Path
from typing import Any

import socketio
from aiohttp import web

DEVICE_ID = "00000000-0000-4000-8000-000000000001"
USER_ID = "00000000-0000-4000-8000-000000000002"
TOKEN_FAMILY_ID = "00000000-0000-4000-8000-000000000003"
PAIRING_GRANT_ID = "00000000-0000-4000-8000-000000000004"
PAIRING_CODE = "TIDE-E2E"
PAIRING_VERIFIER = "e2e-verifier-value"
ACCESS_TOKEN = "e2e-access-token"
REFRESH_TOKEN = "e2e-refresh-token"


class ScenarioError(Exception):
    pass


state: dict[str, Any] = {
    "origin": "",
    "approved": False,
    "revoked": False,
    "offline": False,
    "socket_sid": None,
    "sessions": {},
    "sequence": {},
    "chats": {},
    "workflows": {},
    "schedules": {},
    "events": {
        "ordinary": 0,
        "delete": 0,
        "locked": 0,
        "telemetry": 0,
        "schedule_runs": 0,
    },
    "coverage": {},
}

sio = socketio.AsyncServer(async_mode="aiohttp", cors_allowed_origins="*")
app = web.Application(client_max_size=16 * 1024 * 1024)
sio.attach(app, socketio_path="ws/socket.io")


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "authorization,content-type,x-tide-bot-origin"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    response.headers["Cache-Control"] = "no-store"
    return response


app.middlewares.append(cors_middleware)


def token_response() -> dict[str, Any]:
    return {
        "access_token": ACCESS_TOKEN,
        "refresh_token": REFRESH_TOKEN,
        "token_type": "Bearer",
        "expires_in": 61,
        "token_family_id": TOKEN_FAMILY_ID,
        "device": {
            "id": DEVICE_ID,
            "label": "E2E Chrome",
            "allowed_origin": state["origin"],
            "extension_version": "0.1.0",
        },
    }


def json_response(value: Any, status: int = 200) -> web.Response:
    return web.json_response(value, status=status)


async def pairing_start(request: web.Request) -> web.Response:
    await request.json()
    state["approved"] = False
    state["revoked"] = False
    return json_response(
        {
            "grant_id": PAIRING_GRANT_ID,
            "device_code": PAIRING_CODE,
            "verifier": PAIRING_VERIFIER,
            "verification_uri": f"{state['origin']}/verify",
            "interval": 1,
            "expires_in": 120,
        }
    )


async def pairing_token(request: web.Request) -> web.Response:
    body = await request.json()
    if (
        body.get("grant_id") != PAIRING_GRANT_ID
        or body.get("device_code") != PAIRING_CODE
        or body.get("verifier") != PAIRING_VERIFIER
    ):
        return json_response({"detail": "invalid_pairing"}, 400)
    if not state["approved"]:
        return json_response({"detail": "authorization_pending"}, 428)
    return json_response(token_response())


async def refresh_token(request: web.Request) -> web.Response:
    await request.json()
    state["coverage"]["refresh_token"] = state["coverage"].get("refresh_token", 0) + 1
    if state["revoked"]:
        return json_response({"detail": "device_revoked"}, 401)
    return json_response(token_response())


async def verify_page(_: web.Request) -> web.Response:
    return web.Response(
        text="""<!doctype html><html><head><title>Approve Tide-Bot</title></head>
        <body><main><h1>Pair Tide-Bot Browser Control</h1>
        <p>Code <strong>TIDE-E2E</strong></p>
        <form method="post"><button type="submit">Approve browser</button></form>
        </main></body></html>""",
        content_type="text/html",
    )


async def verify_approve(_: web.Request) -> web.Response:
    state["approved"] = True
    return web.Response(
        text="<!doctype html><title>Approved</title><h1>Browser approved</h1>",
        content_type="text/html",
    )


@sio.event
async def connect(sid: str, _environ: dict, _auth: dict | None):
    state["socket_sid"] = sid


@sio.event
async def disconnect(sid: str, _reason: str | None = None):
    state["sessions"].pop(sid, None)
    if state["socket_sid"] == sid:
        state["socket_sid"] = None


@sio.on("browser:device:join")
async def device_join(sid: str, _payload: dict):
    if state["offline"]:
        return {"ok": False, "error": "offline"}
    if state["revoked"]:
        return {"ok": False, "error": "device_revoked"}
    return {"ok": True, "deviceId": DEVICE_ID, "userId": USER_ID}


@sio.on("browser:session:open")
async def session_open(sid: str, payload: dict):
    state["sessions"][sid] = payload
    return {"ok": True, "sessionId": payload.get("sessionId")}


@sio.on("browser:session:close")
async def session_close(sid: str, _payload: dict):
    state["sessions"].pop(sid, None)
    return {"ok": True}


@sio.on("browser:heartbeat")
async def heartbeat(_sid: str, _payload: dict):
    return {"ok": not state["offline"]}


async def issue_command(name: str, args: dict[str, Any], mutating: bool) -> Any:
    sid = state["socket_sid"]
    session = state["sessions"].get(sid)
    if not sid or not session:
        raise ScenarioError("session_not_open")
    session_id = session["sessionId"]
    sequence = state["sequence"].get(session_id, 0) + 1
    state["sequence"][session_id] = sequence
    now = int(time.time() * 1000)
    envelope = {
        "version": 1,
        "id": str(uuid.uuid4()),
        "type": "command.request",
        "deviceId": DEVICE_ID,
        "userId": USER_ID,
        "sessionId": session_id,
        "timestamp": now,
        "deadlineAt": now + 30_000,
        "nonce": uuid.uuid4().hex,
        "sequence": sequence,
        "payload": {"name": name, "args": args, "mutating": mutating},
    }
    try:
        result = await sio.call("browser:command:request", envelope, to=sid, timeout=25)
    except socketio.exceptions.TimeoutError as error:
        raise ScenarioError("command_timeout") from error
    payload = result.get("payload", {}) if isinstance(result, dict) else {}
    if payload.get("ok") is not True:
        code = payload.get("error", {}).get("code", "command_failed")
        raise ScenarioError(str(code))
    state["coverage"][name] = state["coverage"].get(name, 0) + 1
    return payload.get("value")


async def observe() -> Any:
    return await issue_command("browser_observe", {}, False)


async def run_chat_scenario(prompt: str) -> str:
    normalized = prompt.casefold()
    if "ordinary controls" in normalized:
        await observe()
        await issue_command(
            "browser_type",
            {
                "target": {"role": "textbox", "name": "Name"},
                "text": "Ada Lovelace",
                "operation": "replace",
            },
            True,
        )
        await issue_command(
            "browser_select",
            {"target": {"role": "combobox", "name": "Plan"}, "values": ["pro"]},
            True,
        )
        await issue_command(
            "browser_click",
            {"target": {"role": "button", "name": "Ordinary action"}},
            True,
        )
        return "Ordinary controls completed in the locked tab."
    if "navigate within test" in normalized:
        await issue_command(
            "browser_navigate",
            {"url": f"{state['origin']}/test-page?view=navigated"},
            True,
        )
        return "Navigation completed."
    if "capture safe diagnostics" in normalized:
        screenshot = await issue_command("browser_screenshot", {"format": "png", "quality": 85}, False)
        await observe()
        await issue_command(
            "browser_click",
            {"target": {"role": "button", "name": "Generate telemetry"}},
            True,
        )
        await issue_command("browser_wait", {"condition": "delay", "milliseconds": 350}, False)
        console = await issue_command("browser_console", {"maxEntries": 20}, False)
        network = await issue_command("browser_network", {"maxEntries": 20}, False)
        console_json = json.dumps(console)
        network_json = json.dumps(network)
        if screenshot.get("byteLength", 0) <= 0 or screenshot.get("format") != "png":
            raise ScenarioError("invalid_screenshot_metadata")
        if "console-secret-value" in console_json or "[REDACTED]" not in console_json:
            raise ScenarioError("console_not_sanitized")
        if "network-secret-value" in network_json or "?" in network_json:
            raise ScenarioError("network_not_sanitized")
        state["coverage"]["sanitized_diagnostics"] = True
        return "Screenshot metadata and sanitized diagnostics verified."
    if "download test report" in normalized:
        await observe()
        await issue_command(
            "browser_download",
            {"target": {"role": "link", "name": "Download test report"}},
            True,
        )
        return "The approved report download started."
    if "delete account test" in normalized:
        await observe()
        await issue_command(
            "browser_click",
            {"target": {"role": "button", "name": "Delete account"}},
            True,
        )
        return "The consequential test action completed after approval."
    if "manual ordinary action" in normalized:
        await observe()
        await issue_command(
            "browser_click",
            {"target": {"role": "button", "name": "Ordinary action"}},
            True,
        )
        return "The manual action completed after approval."
    if "locked tab check" in normalized:
        await observe()
        await issue_command(
            "browser_click",
            {"target": {"role": "button", "name": "Locked tab check"}},
            True,
        )
        return "The original tab remained locked."
    return "Tide-Bot replied through the selected local model."


async def models(_: web.Request) -> web.Response:
    return json_response(
        {
            "data": [
                {"id": "local-llama", "name": "Local Llama", "owned_by": "local"},
                {"id": "local-qwen", "name": "Local Qwen", "owned_by": "local"},
            ]
        }
    )


async def list_chats(_: web.Request) -> web.Response:
    return json_response(list(state["chats"].values()))


async def create_chat(request: web.Request) -> web.Response:
    body = await request.json()
    state["coverage"]["create_chat"] = state["coverage"].get("create_chat", 0) + 1
    document = body.get("chat", {})
    chat_id = str(document.get("id") or uuid.uuid4())
    state["chats"][chat_id] = {"id": chat_id, "title": "Extension E2E", "chat": document}
    return json_response({"id": chat_id})


async def chat_resource(request: web.Request) -> web.Response:
    chat_id = request.match_info["chat_id"]
    if request.method == "GET":
        return json_response(state["chats"].get(chat_id, {"id": chat_id, "chat": {}}))
    body = await request.json()
    state["chats"][chat_id] = {
        "id": chat_id,
        "title": "Extension E2E",
        "chat": body.get("chat", {}),
    }
    return json_response({"id": chat_id})


async def chat_completion(request: web.Request) -> web.Response:
    body = await request.json()
    state["coverage"]["chat_completion"] = state["coverage"].get("chat_completion", 0) + 1
    messages = body.get("messages", [])
    prompt = str(messages[-1].get("content", "")) if messages else ""
    try:
        content = await run_chat_scenario(prompt)
    except ScenarioError as error:
        return json_response({"detail": str(error)}, 500)
    return json_response({"choices": [{"message": {"role": "assistant", "content": content}}]})


async def transcribe(_: web.Request) -> web.Response:
    state["coverage"]["hands_free_transcription"] = True
    return json_response({"text": "Hands-free status check"})


async def speech(_: web.Request) -> web.Response:
    return web.Response(body=b"ID3e2e", content_type="audio/mpeg")


def workflow_value(workflow_id: str, body: dict[str, Any]) -> dict[str, Any]:
    definition = body.get("definition", {})
    steps = [step for step in definition.get("steps", []) if step.get("action") == "click"]
    if steps:
        definition = {**definition, "steps": steps}
    return {
        "id": workflow_id,
        "name": str(body.get("name", "E2E workflow")),
        "version": int(body.get("version", 1)),
        "definition": definition,
        "created_at": int(time.time() * 1_000_000_000),
        "updated_at": int(time.time() * 1_000_000_000),
    }


async def workflows(request: web.Request) -> web.Response:
    if request.method == "GET":
        return json_response(list(state["workflows"].values()))
    body = await request.json()
    workflow_id = str(uuid.uuid4())
    value = workflow_value(workflow_id, body)
    state["workflows"][workflow_id] = value
    return json_response(value)


async def workflow_resource(request: web.Request) -> web.Response:
    workflow_id = request.match_info["workflow_id"]
    if request.method == "GET":
        value = state["workflows"].get(workflow_id)
        return json_response(value or {"detail": "not_found"}, 200 if value else 404)
    if request.method == "DELETE":
        state["workflows"].pop(workflow_id, None)
        return web.Response(status=204)
    body = await request.json()
    value = workflow_value(workflow_id, body)
    state["workflows"][workflow_id] = value
    return json_response(value)


async def schedules(request: web.Request) -> web.Response:
    if request.method == "GET":
        return json_response(list(state["schedules"].values()))
    body = await request.json()
    schedule_id = str(uuid.uuid4())
    value = {
        "id": schedule_id,
        "workflow_id": body["workflow_id"],
        "device_id": body["device_id"],
        "name": body["name"],
        "rrule": body["rrule"],
        "timezone": body["timezone"],
        "is_active": True,
        "last_run_at": None,
        "next_run_at": (int(time.time() * 1000) + 1_500) * 1_000_000,
    }
    state["schedules"][schedule_id] = value
    return json_response(value)


async def schedule_resource(request: web.Request) -> web.Response:
    schedule_id = request.match_info["schedule_id"]
    if request.method == "DELETE":
        state["schedules"].pop(schedule_id, None)
        return web.Response(status=204)
    body = await request.json()
    value = {**state["schedules"][schedule_id], **body}
    state["schedules"][schedule_id] = value
    return json_response(value)


async def schedule_run(request: web.Request) -> web.Response:
    schedule_id = request.match_info["schedule_id"]
    body = await request.json()
    if schedule_id in state["schedules"]:
        state["schedules"][schedule_id].update(
            {
                "last_run_at": body.get("last_run_at"),
                "next_run_at": body.get("next_run_at"),
            }
        )
    state["events"]["schedule_runs"] += 1
    return json_response({"ok": True})


async def test_page(_: web.Request) -> web.Response:
    source = Path(__file__).with_name("test-page.html").read_text(encoding="utf-8")
    return web.Response(text=source, content_type="text/html")


async def download(_: web.Request) -> web.Response:
    return web.Response(
        body=b"Tide-Bot extension E2E report\n",
        headers={"Content-Disposition": 'attachment; filename="tide-bot-e2e-report.txt"'},
        content_type="text/plain",
    )


async def record_event(request: web.Request) -> web.Response:
    body = await request.json()
    name = str(body.get("name", ""))
    if name in state["events"]:
        state["events"][name] += 1
    return json_response({"ok": True})


async def e2e_state(_: web.Request) -> web.Response:
    return json_response(
        {
            "approved": state["approved"],
            "revoked": state["revoked"],
            "offline": state["offline"],
            "events": state["events"],
            "coverage": state["coverage"],
            "workflow_count": len(state["workflows"]),
            "schedule_count": len(state["schedules"]),
        }
    )


async def set_offline(request: web.Request) -> web.Response:
    body = await request.json()
    state["offline"] = bool(body.get("offline"))
    if state["offline"]:
        for sid in list(sio.manager.get_participants("/", None)):
            participant = sid[0] if isinstance(sid, tuple) else sid
            await sio.disconnect(participant)
    return json_response({"offline": state["offline"]})


async def revoke(_: web.Request) -> web.Response:
    state["revoked"] = True
    for sid in list(sio.manager.get_participants("/", None)):
        participant = sid[0] if isinstance(sid, tuple) else sid
        await sio.disconnect(participant)
    return json_response({"revoked": True})


app.router.add_post("/api/v1/browser-extension/pairing/start", pairing_start)
app.router.add_post("/api/v1/browser-extension/pairing/token", pairing_token)
app.router.add_post("/api/v1/browser-extension/token/refresh", refresh_token)
app.router.add_get("/verify", verify_page)
app.router.add_post("/verify", verify_approve)
app.router.add_get("/api/models", models)
app.router.add_get("/api/v1/chats/", list_chats)
app.router.add_post("/api/v1/chats/new", create_chat)
app.router.add_route("*", "/api/v1/chats/{chat_id}", chat_resource)
app.router.add_post("/api/chat/completions", chat_completion)
app.router.add_post("/api/v1/audio/transcriptions", transcribe)
app.router.add_post("/api/v1/audio/speech", speech)
app.router.add_route("*", "/api/v1/browser-extension/workflows", workflows)
app.router.add_route("*", "/api/v1/browser-extension/workflows/{workflow_id}", workflow_resource)
app.router.add_route("*", "/api/v1/browser-extension/schedules", schedules)
app.router.add_route("*", "/api/v1/browser-extension/schedules/{schedule_id}", schedule_resource)
app.router.add_post("/api/v1/browser-extension/schedules/{schedule_id}/runs", schedule_run)
app.router.add_get("/test-page", test_page)
app.router.add_get("/download/report.txt", download)
app.router.add_post("/__e2e/event", record_event)
app.router.add_get("/__e2e/state", e2e_state)
app.router.add_post("/__e2e/offline", set_offline)
app.router.add_post("/__e2e/revoke", revoke)
app.router.add_route("OPTIONS", "/{path:.*}", lambda _: web.Response(status=204))


async def main() -> None:
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    sockets = site._server.sockets  # type: ignore[attr-defined]
    port = int(sockets[0].getsockname()[1])
    state["origin"] = f"http://127.0.0.1:{port}"
    print(json.dumps({"origin": state["origin"]}), flush=True)

    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_name, stopped.set)
    await stopped.wait()
    await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
