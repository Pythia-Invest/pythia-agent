"""Feature-owned standard presentations over qualified InstrumentRead values.

Each module supplies the feature-owned @pythia/market-data/widgets binding for
canonical requests and display adaptation; `instrument-chart` is an instrument
page's price section with its own chart binding and a host-selected period.
Hosts may also supply an already qualified InstrumentRead directly; neither
route gives the renderer provider access.
The top bar composes @pythia/market-data/search-ui (ADR 0036); it is Desk's
product default unless the workspace's desk/top-bar.json selects another.
"""
WIDGETS = (
    {'id': 'instrument-tile', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-compact-tile', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-table', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-panel', 'asset': 'instruments', 'input_contract': 'pythia.instrument-read.v1'},
    {'id': 'instrument-chart', 'asset': 'instrument-chart', 'input_contract': 'pythia.instrument-chart.v1'},
    {'id': 'top-bar', 'asset': 'top-bar', 'input_contract': 'pythia.desk-topbar.v1'},
)
ASSETS = {'instruments': 'dist/widgets/instruments.mjs', 'instrument-chart': 'dist/widgets/instrument-chart.mjs',
          'top-bar': 'dist/widgets/top-bar.mjs'}


def register(ctx):
    import pythia_platform as platform
    platform.register_widget_presentation(ctx, tool_name='pythia_market_data_widgets', toolset='pythia-core',
                                          widgets=WIDGETS, assets=ASSETS)
