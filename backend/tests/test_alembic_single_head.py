from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / 'backend'
OPEN_WEBUI_ROOT = BACKEND_ROOT / 'open_webui'
CUSTOM_PRE_MERGE_HEAD = 'c9f5e7a2b310'
sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault('WEBUI_SECRET_KEY', 'task6-migration-head-test-secret')
os.environ.setdefault('OAUTH_CLIENT_INFO_ENCRYPTION_KEY', 'task6-migration-head-oauth-test-secret')


def _alembic_config() -> Config:
    config = Config(str(OPEN_WEBUI_ROOT / 'alembic.ini'))
    config.set_main_option('script_location', str(OPEN_WEBUI_ROOT / 'migrations'))
    return config


def test_migration_graph_has_exactly_one_head() -> None:
    heads = ScriptDirectory.from_config(_alembic_config()).get_heads()

    assert len(heads) == 1, f'expected one Alembic head, found {heads}'


def test_custom_pre_merge_database_upgrades_through_v0_11_1(tmp_path: Path) -> None:
    database_path = tmp_path / 'tide-bot-upstream-merge.db'
    database_url = f'sqlite:///{database_path.as_posix()}'
    probe = textwrap.dedent(
        f"""
        from pathlib import Path

        import sqlalchemy as sa
        from alembic import command
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        open_webui_root = Path({str(OPEN_WEBUI_ROOT)!r})
        database_url = {database_url!r}
        config = Config(str(open_webui_root / 'alembic.ini'))
        config.set_main_option('script_location', str(open_webui_root / 'migrations'))

        command.upgrade(config, {CUSTOM_PRE_MERGE_HEAD!r})
        engine = sa.create_engine(database_url)
        with engine.connect() as connection:
            version = connection.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one()
            assert version == {CUSTOM_PRE_MERGE_HEAD!r}
        engine.dispose()

        command.upgrade(config, 'head')
        script_head = ScriptDirectory.from_config(config).get_current_head()
        engine = sa.create_engine(database_url)
        with engine.connect() as connection:
            inspector = sa.inspect(connection)
            version = connection.execute(sa.text('SELECT version_num FROM alembic_version')).scalar_one()
            assert version == script_head
            assert {{'variables', 'timer_at'}} <= {{c['name'] for c in inspector.get_columns('chat')}}
            assert 'variables' in {{c['name'] for c in inspector.get_columns('user')}}
            assert 'folder_id' in {{c['name'] for c in inspector.get_columns('automation')}}
            assert {{'previous_refresh_token_hash', 'rotated_at'}} <= {{
                c['name'] for c in inspector.get_columns('browser_paired_device')
            }}
        engine.dispose()
        """
    )
    env = {
        **os.environ,
        'DATA_DIR': str(tmp_path / 'data'),
        'DATABASE_URL': database_url,
        'PYTHONPATH': str(BACKEND_ROOT),
        'WEBUI_SECRET_KEY': 'task6-migration-test-secret',
        'OAUTH_CLIENT_INFO_ENCRYPTION_KEY': 'task6-migration-oauth-test-secret',
    }

    completed = subprocess.run(
        [sys.executable, '-c', probe],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
