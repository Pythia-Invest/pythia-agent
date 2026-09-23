// Selected-source build inputs and outputs, not a runtime widget inventory.
const feature = "runtime/managed/plugins/market-data";
export const MANAGED_WIDGET_BUILDS = Object.freeze([
  Object.freeze({
    entry: `${feature}/widgets/top-bar.tsx`,
    output: `${feature}/dist/widgets/top-bar.mjs`,
  }),
  Object.freeze({
    entry: `${feature}/widgets/instruments.tsx`,
    output: `${feature}/dist/widgets/instruments.mjs`,
  }),
]);
