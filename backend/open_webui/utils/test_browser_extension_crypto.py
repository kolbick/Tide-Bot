import copy

import pytest
from cryptography.exceptions import InvalidTag

from open_webui.utils.browser_extension_crypto import (
    REDACTED,
    decrypt_workflow_definition,
    derive_browser_extension_keys,
    encrypt_workflow_definition,
    hash_browser_token,
    redact_sensitive_data,
)


def test_browser_extension_keys_are_deterministic_and_separated():
    first = derive_browser_extension_keys('correct horse battery staple')
    second = derive_browser_extension_keys('correct horse battery staple')

    assert first == second
    assert len(first.workflow_encryption) == 32
    assert len(first.token_hashing) == 32
    assert len(first.access_signing) == 32
    assert len(first.refresh_signing) == 32
    assert (
        len(
            {
                first.workflow_encryption,
                first.token_hashing,
                first.access_signing,
                first.refresh_signing,
            }
        )
        == 4
    )


def test_workflow_definition_uses_authenticated_encryption():
    definition = {'name': 'Book tide trip', 'steps': [{'action': 'click', 'selector': '#reserve'}]}

    encrypted = encrypt_workflow_definition(
        definition,
        secret_key='test-secret',
        user_id='user-a',
        workflow_id='workflow-a',
        version=2,
    )

    assert encrypted.ciphertext != str(definition)
    assert encrypted.nonce not in encrypted.ciphertext
    assert (
        decrypt_workflow_definition(
            encrypted.ciphertext,
            encrypted.nonce,
            secret_key='test-secret',
            user_id='user-a',
            workflow_id='workflow-a',
            version=2,
        )
        == definition
    )

    with pytest.raises(InvalidTag):
        decrypt_workflow_definition(
            encrypted.ciphertext,
            encrypted.nonce,
            secret_key='test-secret',
            user_id='user-b',
            workflow_id='workflow-a',
            version=2,
        )


def test_encrypting_twice_uses_unique_nonces():
    args = {
        'definition': {'steps': []},
        'secret_key': 'test-secret',
        'user_id': 'user-a',
        'workflow_id': 'workflow-a',
        'version': 1,
    }

    first = encrypt_workflow_definition(**args)
    second = encrypt_workflow_definition(**args)

    assert first.nonce != second.nonce
    assert first.ciphertext != second.ciphertext


def test_token_hash_is_keyed_and_never_contains_the_token():
    token = 'refresh-token-that-must-not-be-stored'

    first = hash_browser_token(token, 'test-secret')
    second = hash_browser_token(token, 'test-secret')
    other_secret = hash_browser_token(token, 'other-secret')

    assert first == second
    assert first != other_secret
    assert token not in first


def test_redaction_removes_nested_credentials_and_card_like_values():
    source = {
        'Authorization': 'Bearer header-secret',
        'cookie': 'session=browser-cookie',
        'nested': {
            'password': 'hunter2',
            'api_key': 'sk-local-secret',
            'note': 'Bearer body-secret and card 4242 4242 4242 4242',
        },
        'items': ['password=inline-secret', {'card_number': '4111111111111111'}],
    }
    original = copy.deepcopy(source)

    redacted = redact_sensitive_data(source)

    assert source == original
    assert redacted['Authorization'] == REDACTED
    assert redacted['cookie'] == REDACTED
    assert redacted['nested']['password'] == REDACTED
    assert redacted['nested']['api_key'] == REDACTED
    assert 'body-secret' not in redacted['nested']['note']
    assert '4242 4242 4242 4242' not in redacted['nested']['note']
    assert 'inline-secret' not in redacted['items'][0]
    assert redacted['items'][1]['card_number'] == REDACTED


@pytest.mark.parametrize('secret_key', ['', None])
def test_empty_secret_key_is_rejected(secret_key):
    with pytest.raises(ValueError, match='WEBUI_SECRET_KEY'):
        derive_browser_extension_keys(secret_key)
