"""Qualify copied feature skill ownership through the pinned native loader."""
import json
from pathlib import Path
import socket
import subprocess
import sys
from unittest.mock import patch

from native_hermes_source import validate_source_binding

root = Path(sys.argv[1])
enabled = sys.argv[2] == 'true'
available = sys.argv[3] == 'true'
widgets = sys.argv[4] == 'true'
repository = Path(__file__).resolve().parents[2]
pin = json.loads((repository / 'runtime/versions.json').read_text())['dependencies']['hermes_agent']
validate_source_binding(Path(sys.prefix).resolve().parent, pin, None)

with patch.object(socket.socket, 'connect', side_effect=AssertionError('No network in skill qualification')), \
     patch.object(subprocess, 'Popen', side_effect=AssertionError('No child processes in skill qualification')):
    from hermes_cli.plugins import get_plugin_manager
    from tools.skills_tool import skills_list, skill_view
    from tools.registry import registry

    manager = get_plugin_manager()
    manager.discover_and_load()
    qualified = 'pythia-market-data:market-data'
    listing = json.loads(skills_list())
    assert listing['success'], listing
    names = {skill['name'] for skill in listing['skills']}
    assert 'investment-memory' in names, listing
    assert not {'sec-edgar-research', 'eodhd-market-data'} & names, listing
    viewed = json.loads(skill_view(qualified, preprocess=False))
    plugin = manager._plugins['pythia-market-data']
    if enabled:
        assert plugin.enabled and plugin.module is not None, plugin.error
        assert 'market-data' not in names, listing
        copied = root / 'plugins/pythia-market-data/skills/market-data/SKILL.md'
        assert manager.find_plugin_skill(qualified).resolve() == copied.resolve()
        if available:
            assert copied.read_text() in viewed['content'], viewed
        assert registry.get_entry('pythia_market_data') is not None
        assert (registry.get_entry('pythia_market_data_widgets') is not None) == widgets
        if not widgets:
            from gateway.session_context import set_session_vars, clear_session_vars
            tokens = set_session_vars(platform='api_server')
            try:
                result = json.loads(registry.dispatch('pythia_market_data', {'action': 'get_preferences'}))
                assert result['schema_version'] == 1 and result['outcome'] == 'ok', result
            finally:
                clear_session_vars(tokens)
    else:
        assert not plugin.enabled
        assert manager.find_plugin_skill(qualified) is None
        assert registry.get_entry('pythia_market_data') is None
        assert registry.get_entry('pythia_market_data_widgets') is None
    assert (qualified in names) == available, listing
    assert viewed['success'] == available, viewed

print(json.dumps({'plugin_enabled': enabled, 'qualified_skill_available': viewed['success'],
                  'widgets_available': enabled and widgets,
                  'hermes_commit': pin['commit']}))
