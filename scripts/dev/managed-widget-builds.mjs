// Selected-source build inputs and outputs, not a runtime widget inventory.
const feature = "runtime/managed/plugins/market-data";
export const MANAGED_NODE_BUILDS = Object.freeze([
  Object.freeze({
    entry: "runtime/managed/plugins/vega-lite/snapshot-main.ts",
    output: "runtime/managed/plugins/vega-lite/dist/snapshot.mjs",
  }),
]);
export const MANAGED_WIDGET_BUILDS = Object.freeze([
  Object.freeze({
    entry: `${feature}/widgets/instruments.tsx`,
    output: `${feature}/dist/widgets/instruments.mjs`,
  }),
  Object.freeze({
    entry: "runtime/managed/plugins/vega-lite/widgets/research-visual.tsx",
    output:
      "runtime/managed/plugins/vega-lite/dist/widgets/research-visual.mjs",
  }),
]);
