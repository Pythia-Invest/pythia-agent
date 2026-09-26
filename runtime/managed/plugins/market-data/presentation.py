"""Feature-owned standard presentations over qualified InstrumentRead values.

Each module supplies the feature-owned @pythia/market-data/widgets binding for
canonical requests and display adaptation. Hosts may also supply an already
qualified InstrumentRead directly; neither route gives the renderer provider access.
The optional top bar composes @pythia/market-data/search-ui (ADR 0036); it is
selected in the workspace's desk/top-bar.json, not by default.
"""
import logging

from ._platform import platform

WIDGETS = (
    {'id': 'instrument-tile', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-compact-tile', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-table', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'top-bar', 'asset': 'top-bar', 'input_contract': 'pythia.desk-topbar.v1'},
)
ASSETS = {'instruments': 'dist/widgets/instruments.mjs', 'top-bar': 'dist/widgets/top-bar.mjs'}


def register(ctx):
    register_widgets = getattr(platform(), 'register_widget_presentation', None)
    if not callable(register_widgets):
        logging.getLogger(__name__).warning(
            'Market-data widget presentations are unavailable: the selected Pythia core lacks widget support. '
            'The financial backend remains available; update or reconcile the preserved core package explicitly.')
        return
    register_widgets(ctx, tool_name='pythia_market_data_widgets', toolset='pythia-market-data',
                     widgets=WIDGETS, assets=ASSETS)
