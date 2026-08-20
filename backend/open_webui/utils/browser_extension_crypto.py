from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

REDACTED = '[REDACTED]'

_HKDF_SALT = b'tide-bot/browser-extension/v1'
_WORKFLOW_INFO = b'tide-bot/browser-extension/workflow-encryption/v1'
_TOKEN_INFO = b'tide-bot/browser-extension/token-hashing/v1'
_ACCESS_SIGNING_INFO = b'tide-bot/browser-extension/access-signing/v1'
_REFRESH_SIGNING_INFO = b'tide-bot/browser-extension/refresh-signing/v1'

_SENSITIVE_KEYS = {
    'access_token',
    'api_key',
    'apikey',
    'authorization',
    'bearer',
    'card_number',
    'client_secret',
    'cookie',
    'credit_card',
    'credit_card_number',
    'cvc',
    'cvv',
    'device_code',
    'id_token',
    'passcode',
    'passphrase',
    'password',
    'passwd',
    'proxy_authorization',
    'refresh_token',
    'secret',
    'set_cookie',
    'token',
    'verifier',
    'x_api_key',
}

_BEARER_PATTERN = re.compile(r'(?i)\bbearer\s+[a-z0-9._~+/=-]+')
_COOKIE_PATTERN = re.compile(r'(?i)\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+')
_ASSIGNMENT_PATTERN = re.compile(r'''(?ix)
    \b(password|passwd|passcode|api[_-]?key|access[_-]?token|refresh[_-]?token|
       token|client[_-]?secret|secret|verifier|device[_-]?code)
    \s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)
    ''')
_CARD_PATTERN = re.compile(r'(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)')


@dataclass(frozen=True)
class BrowserExtensionKeys:
    workflow_encryption: bytes
    token_hashing: bytes
    access_signing: bytes
    refresh_signing: bytes


@dataclass(frozen=True)
class EncryptedWorkflowDefinition:
    ciphertext: str
    nonce: str


def _derive_key(secret_key: str, info: bytes) -> bytes:
    if not secret_key:
        raise ValueError('WEBUI_SECRET_KEY is required for browser extension cryptography')
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=info,
    ).derive(secret_key.encode('utf-8'))


def derive_browser_extension_keys(secret_key: str | None) -> BrowserExtensionKeys:
    if not secret_key:
        raise ValueError('WEBUI_SECRET_KEY is required for browser extension cryptography')
    return BrowserExtensionKeys(
        workflow_encryption=_derive_key(secret_key, _WORKFLOW_INFO),
        token_hashing=_derive_key(secret_key, _TOKEN_INFO),
        access_signing=_derive_key(secret_key, _ACCESS_SIGNING_INFO),
        refresh_signing=_derive_key(secret_key, _REFRESH_SIGNING_INFO),
    )


def hash_browser_token(token: str, secret_key: str) -> str:
    if not token:
        raise ValueError('Browser extension token must not be empty')
    key = derive_browser_extension_keys(secret_key).token_hashing
    return hmac.new(key, token.encode('utf-8'), hashlib.sha256).hexdigest()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def _decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    return base64.urlsafe_b64decode(f'{value}{padding}')


def _workflow_aad(user_id: str, workflow_id: str, version: int) -> bytes:
    return f'{user_id}:{workflow_id}:{version}'.encode('utf-8')


def encrypt_workflow_definition(
    definition: dict[str, Any],
    *,
    secret_key: str,
    user_id: str,
    workflow_id: str,
    version: int,
) -> EncryptedWorkflowDefinition:
    plaintext = json.dumps(
        definition,
        ensure_ascii=False,
        separators=(',', ':'),
        sort_keys=True,
    ).encode('utf-8')
    nonce = os.urandom(12)
    key = derive_browser_extension_keys(secret_key).workflow_encryption
    ciphertext = AESGCM(key).encrypt(
        nonce,
        plaintext,
        _workflow_aad(user_id, workflow_id, version),
    )
    return EncryptedWorkflowDefinition(ciphertext=_encode(ciphertext), nonce=_encode(nonce))


def decrypt_workflow_definition(
    ciphertext: str,
    nonce: str,
    *,
    secret_key: str,
    user_id: str,
    workflow_id: str,
    version: int,
) -> dict[str, Any]:
    key = derive_browser_extension_keys(secret_key).workflow_encryption
    plaintext = AESGCM(key).decrypt(
        _decode(nonce),
        _decode(ciphertext),
        _workflow_aad(user_id, workflow_id, version),
    )
    definition = json.loads(plaintext)
    if not isinstance(definition, dict):
        raise ValueError('Workflow definition must be a JSON object')
    return definition


def _normalize_key(key: Any) -> str:
    return re.sub(r'[^a-z0-9]+', '_', str(key).strip().lower()).strip('_')


def _redact_string(value: str) -> str:
    value = _BEARER_PATTERN.sub(f'Bearer {REDACTED}', value)
    value = _COOKIE_PATTERN.sub(f'Cookie: {REDACTED}', value)
    value = _ASSIGNMENT_PATTERN.sub(lambda match: f'{match.group(1)}={REDACTED}', value)
    return _CARD_PATTERN.sub(REDACTED, value)


def redact_sensitive_data(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED if _normalize_key(key) in _SENSITIVE_KEYS else redact_sensitive_data(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive_data(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive_data(item) for item in value)
    if isinstance(value, str):
        return _redact_string(value)
    return value
