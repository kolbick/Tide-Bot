"""Internal CPTR gateway for Tide-Bot.

Open WebUI forwards authenticated user identity headers to this service.  Admins
are always allowed through; other users must be explicitly listed in
TIDE_CPTR_APPROVED_EMAILS.  The CPTR API key never reaches Open WebUI clients.
"""

from __future__ import annotations

import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import unquote

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be configured")
    return value


GATE_TOKEN = required_env("TIDE_CPTR_GATE_TOKEN")
UPSTREAM_URL = required_env("TIDE_CPTR_UPSTREAM_URL").rstrip("/")
UPSTREAM_API_KEY = required_env("TIDE_CPTR_UPSTREAM_API_KEY")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    yield
    await app.state.client.aclose()


app = FastAPI(title="Tide CPTR Gate", docs_url=None, redoc_url=None, lifespan=lifespan)


def approved_emails() -> set[str]:
    return {
        item.strip().lower()
        for item in os.getenv("TIDE_CPTR_APPROVED_EMAILS", "").split(",")
        if item.strip()
    }


def authenticated_and_approved(request: Request) -> bool:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return False
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, GATE_TOKEN):
        return False

    role = request.headers.get("x-openwebui-user-role", "").strip().lower()
    if role == "admin":
        return True

    email = unquote(request.headers.get("x-openwebui-user-email", "")).strip().lower()
    return bool(email and email in approved_emails())


def denied_models() -> JSONResponse:
    # Returning an empty model list prevents the CPTR workspace from showing up
    # in the model picker for users who do not have approval.
    return JSONResponse({"object": "list", "data": []})


def outbound_headers(request: Request) -> dict[str, str]:
    ignored = {"host", "content-length", "connection", "authorization"}
    headers = {key: value for key, value in request.headers.items() if key.lower() not in ignored}
    headers["authorization"] = f"Bearer {UPSTREAM_API_KEY}"
    return headers


async def response_stream(response: httpx.Response) -> AsyncIterator[bytes]:
    try:
        async for chunk in response.aiter_raw():
            yield chunk
    finally:
        await response.aclose()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.api_route("/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, request: Request) -> Response:
    allowed = authenticated_and_approved(request)
    if not allowed:
        if request.method == "GET" and path == "models":
            return denied_models()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CPTR access requires admin approval")

    upstream_request = app.state.client.build_request(
        request.method,
        f"{UPSTREAM_URL}/{path}",
        params=request.query_params,
        headers=outbound_headers(request),
        content=await request.body(),
    )
    upstream_response = await app.state.client.send(upstream_request, stream=True)
    response_headers = {
        key: value
        for key, value in upstream_response.headers.items()
        if key.lower() not in {"connection", "content-length", "transfer-encoding"}
    }
    return StreamingResponse(
        response_stream(upstream_response),
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
