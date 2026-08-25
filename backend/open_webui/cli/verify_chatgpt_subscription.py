from __future__ import annotations

import asyncio
import json

from open_webui.routers import openai


def _operational_failure(connection_present: bool) -> openai.ChatGPTSubscriptionHealth:
    return {
        'connection_present': connection_present,
        'credential_decryptable': False,
        'credential_state': 'catalog_unavailable',
        'model_catalog_available': False,
        'model_count': 0,
    }


async def verify_chatgpt_subscription() -> openai.ChatGPTSubscriptionHealth:
    try:
        _, api_base_urls, _, api_configs = await openai.get_openai_runtime_config()
        idx, connection = openai._find_chatgpt_connection(api_base_urls, api_configs)
    except Exception:
        return _operational_failure(False)

    if idx is None or connection is None:
        return {
            'connection_present': False,
            'credential_decryptable': False,
            'credential_state': 'disconnected',
            'model_catalog_available': False,
            'model_count': 0,
        }

    try:
        return await openai.probe_chatgpt_subscription_health(api_base_urls[idx], connection)
    except Exception:
        return _operational_failure(True)


def _exit_code(result: openai.ChatGPTSubscriptionHealth) -> int:
    if result['credential_state'] == 'connected':
        return 0
    if result['credential_state'] == 'reconnect_required':
        return 20
    if result['credential_state'] == 'disconnected':
        return 21
    return 22


def main() -> int:
    result = asyncio.run(verify_chatgpt_subscription())
    print(json.dumps(result, sort_keys=True))
    return _exit_code(result)


if __name__ == '__main__':
    raise SystemExit(main())
