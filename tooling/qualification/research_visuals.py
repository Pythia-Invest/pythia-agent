"""Copied native research visual discovery and writes; no network or providers."""
import json
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch
from native_hermes_source import validate_source_binding

repository = Path(__file__).resolve().parents[2]
pin = json.loads((repository / 'runtime/versions.json').read_text())['dependencies']['hermes_agent']
validate_source_binding(Path(sys.prefix).resolve().parent, pin, None)
root=Path(os.environ['HERMES_HOME'])
enabled=sys.argv[1]=='enabled'
if enabled:
    test_path = repository / 'runtime/test/python/test_research_visuals.py'
    spec = importlib.util.spec_from_file_location('research_visual_boundary_tests', test_path)
    tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tests)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromModule(tests))
    assert result.wasSuccessful(), 'Research visual boundary regressions failed'
original_popen = subprocess.Popen

def snapshot_process_only(args, **kwargs):
    expected = [os.environ['PYTHIA_NODE'], '--max-old-space-size=128', str(root / 'plugins/pythia-vega-lite/dist/snapshot.mjs')]
    assert len(args) == 3 and args[1] == expected[1] and all(Path(args[index]).resolve() == Path(expected[index]).resolve() for index in [0, 2]), 'Only the bundled local snapshot process may run'
    assert kwargs.get('env') == {}, 'Snapshot process must not inherit credentials or Node options'
    return original_popen(args, **kwargs)

with patch.object(socket.socket,'connect',side_effect=AssertionError('No network')), patch.object(subprocess,'Popen',side_effect=snapshot_process_only):
    from hermes_cli.plugins import get_plugin_manager
    from tools.registry import registry
    from tools.skills_tool import skill_view
    manager=get_plugin_manager(); manager.discover_and_load()
    plugin=manager._plugins['pythia-vega-lite']
    assert plugin.enabled == enabled, plugin.error
    entry=registry.get_entry('pythia_vega_lite')
    if enabled:
        assert plugin.module is not None, plugin.error
        assert entry is not None
        skill=json.loads(skill_view('pythia-vega-lite:vega-lite',preprocess=False)); assert skill['success'],skill
        value=json.loads((root/'fixture.json').read_text())
        result=json.loads(registry.dispatch('pythia_vega_lite',{'artifact':value,'destination':'working/native.pythia-vega-lite.json'}))
        assert result.get('schema_version')==1,result
        assert json.loads((root/'workspace/working/native.pythia-vega-lite.json').read_text())==value
        reopened=json.loads(registry.dispatch('pythia_vega_lite', {'action':'read','destination':'working/native.pythia-vega-lite.json'}))
        value['data']['parameters']['growth'] = .2
        updated=json.loads(registry.dispatch('pythia_vega_lite', {'action':'update','destination':'working/native.pythia-vega-lite.json','artifact':value,'revision':reopened['data']['revision']}))
        assert updated.get('schema_version')==1, updated
        exported=json.loads(registry.dispatch('pythia_vega_lite', {'action':'export','destination':'working/native.pythia-vega-lite.json','output':'research/snapshot.svg'}))
        assert exported.get('schema_version')==1, exported
        assert (root/'workspace/research/snapshot.svg').read_text().startswith('<svg')
        result=json.loads(registry.dispatch('pythia_vega_lite_widgets',{})); assert result.get('schema_version')==1,result
        assert result['data']['widgets'][0]['id']=='research-visual',result
        print(json.dumps({'native_plugin':True,'skill':True,'creation':True,'revision':True,'svg_export':True,'presentation':True}))
    else:
        assert entry is None
        assert manager.find_plugin_skill('pythia-vega-lite:vega-lite') is None
        print(json.dumps({'disabled_tool_absent':True,'disabled_skill_absent':True}))
