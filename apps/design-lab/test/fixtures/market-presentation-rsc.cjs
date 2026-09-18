const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript");
const {
  createClientModuleProxy,
} = require("next/dist/compiled/react-server-dom-webpack/server.node");

// Exercise the installed Next client reference, not react-dom's unpartitioned
// SSR environment. Transform TSX locally; never execute a client-marked module.
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    if (/^\s*["']use client["'];/u.test(source)) {
      module.exports = createClientModuleProxy(filename);
      return;
    }
    module._compile(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      filename,
    );
  };
}
const sourceRoot = resolve(
  __dirname,
  "../../../../packages/ui/src/market-widgets",
);
const { InstrumentChange } = require(resolve(sourceRoot, "values.tsx"));
assert.throws(() => InstrumentChange({}), /from the server.*on the client/u);

const { InstrumentExtendedSummary } = require(
  resolve(sourceRoot, "extended-change.tsx"),
);
const result = InstrumentExtendedSummary({
  item: {
    id: "synthetic:one",
    ticker: "ONE",
    price: 42.5,
    status: "closed",
    statusLabel: "Synthetic",
    description: "Synthetic server composition",
    extended: {
      label: "Post",
      price: 43,
      absolute: 0.5,
      percent: 1.18,
      time: "2026-01-02T22:00:00Z",
    },
  },
});
assert.equal(
  result.props.title,
  "Post: 43.00. +0.50 · +1.18% since the last regular close.",
);
assert.equal(result.props.children[1].type, InstrumentChange);
