"""Provider-free Desk record -> pinned native plugin dispatch qualification.

Native provenance: PluginContext.register_tool and model_tools.handle_function_call
at the Hermes pin in runtime/versions.json. The caller owns disposable state.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", type=Path)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--session", required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pythia-view-native-") as temporary:
        os.environ.update(HERMES_HOME=temporary, HERMES_DISABLE_LAZY_INSTALLS="1", PYTHIA_DESK_VIEW_STATE=str(args.state))
        plugin_path = Path(__file__).resolve().parents[2] / "runtime/managed/plugin/__init__.py"
        spec = importlib.util.spec_from_file_location("pythia_view_qualification", plugin_path)
        assert spec and spec.loader
        plugin = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = plugin
        spec.loader.exec_module(plugin)
        if args.hermes_source:
            sys.path.insert(0, str(args.hermes_source))
            from hermes_cli import plugins
            from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
            from model_tools import handle_function_call
            manager = PluginManager()
            manager._discovered = True
            plugins._plugin_manager = manager
            context = PluginContext(PluginManifest(name="pythia", key="pythia", source="user"), manager)
            plugin.register(context)
            result = handle_function_call("pythia_desk_view", {"view_reference": args.reference}, session_id=args.session)
        else:
            result = plugin.desk_view({"view_reference": args.reference}, session_id=args.session)
        assert isinstance(result, str)
        json.loads(result)
        print(result)


if __name__ == "__main__":
    main()
