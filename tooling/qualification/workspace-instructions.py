"""Offline assembled instruction delivery through the pinned Hermes loader.

Native fixtures follow tests/agent/test_plugin_prompt_sections.py and the
native MemoryStore/skill catalog. No model inference or service is started.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile

from native_hermes_source import validate_source_binding


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--hermes-source', type=Path, required=True)
    parser.add_argument('--repository', type=Path, required=True)
    args = parser.parse_args()
    source, repository = args.hermes_source.resolve(), args.repository.resolve()
    pin = json.loads((repository / 'runtime/versions.json').read_text())['dependencies']['hermes_agent']
    binding = validate_source_binding(source, pin, None)
    assert Path(sys.prefix).resolve() == (source / '.venv').resolve()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source))

    def deny_network(*_args, **_kwargs):
        raise RuntimeError('Network prohibited in instruction qualification')

    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    with tempfile.TemporaryDirectory(prefix='pythia-workspace-instructions-') as raw:
        root = Path(raw)
        profile, workspace = root / 'profile', root / 'workspace'
        prior_environment, prior_cwd = dict(os.environ), Path.cwd()
        database = None
        try:
            os.environ.clear()
            os.environ.update({'HOME': raw, 'HERMES_HOME': str(profile),
                               'HERMES_DISABLE_LAZY_INSTALLS': '1', 'PATH': '/usr/bin:/bin',
                               'PYTHIA_MANAGED_SKILLS_DIR': str(repository / 'runtime/managed/skills'),
                               'TERMINAL_CWD': str(workspace)})
            shutil.copytree(repository / 'runtime/seeds/profile', profile)
            shutil.copytree(repository / 'runtime/seeds/workspace', workspace)
            copied_plugin = profile / 'plugins/pythia'
            shutil.copytree(repository / 'runtime/managed/core', copied_plugin,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            memory = profile / 'memories'
            memory.mkdir()
            (memory / 'MEMORY.md').write_text('Synthetic global environment memory.')
            (memory / 'USER.md').write_text('Synthetic concise investor preference.')
            (workspace / 'strategies/example').mkdir()
            (workspace / 'strategies/example/README.md').write_text('DO_NOT_PRELOAD_STRATEGY_DETAIL')
            os.chdir(workspace)

            import yaml
            from hermes_cli import plugins
            from hermes_cli.plugins import PluginManager
            from agent.system_prompt import build_system_prompt, invalidate_system_prompt
            from agent.conversation_loop import _restore_or_build_system_prompt
            from hermes_state import SessionDB
            from run_agent import AIAgent
            from tools.skills_tool import skill_view
            from agent.prompt_builder import build_skills_system_prompt, clear_skills_system_prompt_cache

            toolsets = yaml.safe_load((profile / 'config.yaml').read_text())['platform_toolsets']['api_server']
            manager = PluginManager()
            plugins._plugin_manager = manager
            manager.discover_and_load()
            database = SessionDB(db_path=profile / 'state.db')

            def make_agent(session_id):
                database.ensure_session(session_id, source='api_server', model='test/model')
                agent = AIAgent(api_key='synthetic-not-a-credential', base_url='https://example.invalid/v1',
                                model='test/model', provider='openrouter', platform='api_server',
                                quiet_mode=True, session_id=session_id, session_db=database, enabled_toolsets=toolsets)
                return agent

            current = make_agent('current')
            prompt = build_system_prompt(current)
            marker = '[PYTHIA_WORKSPACE_GUIDANCE_V1]'
            assert prompt.count(marker) == 1
            assert 'Synthetic global environment memory.' in prompt
            assert 'Synthetic concise investor preference.' in prompt
            assert 'This workspace belongs to the investor.' in prompt
            assert 'DO_NOT_PRELOAD_STRATEGY_DETAIL' not in prompt
            assert '## Plugin Context: pythia.operating' in prompt
            assert prompt.index('Synthetic concise investor preference.') < prompt.index(marker)
            assert 'mcp-basic-memory' not in prompt
            from model_tools import get_tool_definitions
            catalog = get_tool_definitions(enabled_toolsets=toolsets, quiet_mode=True, skip_tool_search_assembly=True)
            assert 'pythia_desk_view' in {tool['function']['name'] for tool in catalog}
            assert 'pythia_desk_view' in current.valid_tool_names or 'tool_search' in current.valid_tool_names
            assert 'investment-memory' in prompt
            detail = json.loads(skill_view('investment-memory'))
            assert 'error' not in detail
            support = json.loads(skill_view('investment-memory', file_path='references/note-discipline.md'))
            assert 'error' not in support
            clear_skills_system_prompt_cache(clear_snapshot=True)
            disabled_catalog = build_skills_system_prompt(available_tools=set(), available_toolsets=set(),
                                                         skills_dir_override=profile / 'skills')
            assert 'investment-memory' not in disabled_catalog

            # A saved prompt is the native resume authority; source activation
            # cannot retroactively replace it. Compaction invalidation can.
            legacy_prompt = 'Synthetic legacy prompt without current guidance.'
            database.create_session('legacy', source='api_server', model='test/model', system_prompt=legacy_prompt)
            database.append_message('legacy', 'user', 'Synthetic earlier research.')
            legacy = make_agent('legacy')
            _restore_or_build_system_prompt(legacy, None, [{'role': 'user', 'content': 'Synthetic earlier research.'}])
            assert legacy._cached_system_prompt == legacy_prompt
            fresh = make_agent('fresh-continuation')
            assert marker in build_system_prompt(fresh)
            invalidate_system_prompt(legacy)
            assert marker in build_system_prompt(legacy)
            print(json.dumps({'source_binding': binding, 'commit': pin['commit'],
                              'checks': ['native-plugin-discovery', 'assembled-memory-and-workspace',
                                         'operating-after-memory', 'no-strategy-preload',
                                         'native-skill-and-reference-read', 'disabled-file-skill-hidden',
                                         'fresh-view-tool', 'legacy-resume-preserved',
                                         'fresh-continuation-current', 'compaction-refresh'],
                              'claim': 'structural delivery only; model behavior untested'}))
        finally:
            if database is not None:
                database.close()
            os.chdir(prior_cwd)
            os.environ.clear()
            os.environ.update(prior_environment)


if __name__ == '__main__':
    main()
