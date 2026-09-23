"""Present declarative research artifacts through the existing native host."""
import logging


def register(ctx):
    from hermes_cli.plugins import get_plugin_manager
    plugins = [item for item in get_plugin_manager()._plugins.values()
               if item.manifest.name == 'pythia' and item.enabled and item.module is not None]
    support = getattr(plugins[0].module, 'platform', None) if len(plugins) == 1 else None
    register_widgets = getattr(support, 'register_widget_presentation', None)
    if getattr(support, 'API_VERSION', None) != 1 or not callable(register_widgets):
        logging.getLogger(__name__).warning('Research visual presentation requires enabled Pythia core platform v1; file creation remains available.')
        return
    register_widgets(ctx, tool_name='pythia_research_visual_widgets', toolset='pythia-research-visuals',
                     widgets=({'id': 'research-visual', 'asset': 'research-visual',
                               'input_contract': 'pythia.research-visual.v1'},),
                     assets={'research-visual': 'dist/widgets/research-visual.mjs'})
