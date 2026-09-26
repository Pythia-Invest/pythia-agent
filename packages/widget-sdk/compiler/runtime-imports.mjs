// Compiler-owned bindings: every resolved browser dependency is a fixed host
// import. A separate tiny module per export lets esbuild's output metafile tell
// us which bindings survive tree shaking, without parsing generated JavaScript.
const surfaces = {
  react: [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "cache",
    "cloneElement",
    "createContext",
    "createElement",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useEffectEvent",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version",
  ],
  jsxRuntime: ["Fragment", "jsx", "jsxs"],
  reactDom: [
    "createPortal",
    "flushSync",
    "preconnect",
    "prefetchDNS",
    "preinit",
    "preinitModule",
    "preload",
    "preloadModule",
    "requestFormReset",
    "useFormState",
    "useFormStatus",
    "version",
  ],
  sdk: [
    "InstrumentTile",
    "InstrumentCompactTile",
    "InstrumentTable",
    "InstrumentReadState",
    "InstrumentIdentity",
    "InstrumentStatusDot",
    "InstrumentPrice",
    "InstrumentChange",
    "InstrumentExtendedSummary",
    "InstrumentPathView",
    "InstrumentSparkline",
    "instrumentNumber",
    "cn",
    "Button",
    "Combobox",
    "ComboboxEmpty",
    "ComboboxGroup",
    "ComboboxInput",
    "ComboboxInputGroup",
    "ComboboxItem",
    "ComboboxList",
    "ComboboxPopup",
    "ComboboxPortal",
    "ComboboxPositioner",
    "EmptyState",
    "Popover",
    "Skeleton",
    "Toggle",
    "ToggleGroup",
    "useQuery",
    "useMutation",
    "useQueryClient",
  ],
};

const imports = {
  react: "react",
  "react/jsx-runtime": "jsxRuntime",
  "react-dom": "reactDom",
  "@pythia/widget-sdk": "sdk",
  "@tanstack/react-query": "sdk",
};

export function runtimeImports() {
  return {
    name: "pythia-widget-runtime",
    setup(builder) {
      builder.onResolve(
        {
          filter:
            /^(?:@tanstack\/react-query(?:\/|$)|@pythia\/(?:widget-sdk|ui)(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$))/,
        },
        (args) => {
          const surface = imports[args.path];
          if (!surface)
            throw new Error(
              `Unsupported shared import ${args.path}. Import presentation from @pythia/widget-sdk; Desk owns React mounting.`,
            );
          return {
            path: surface,
            namespace: "pythia-host",
            sideEffects: false,
          };
        },
      );
      builder.onLoad({ filter: /.*/, namespace: "pythia-host" }, (args) => ({
        contents: [
          ...surfaces[args.path].map(
            (name) =>
              `export {default as ${name}} from "pythia-binding:${args.path}/${name}";`,
          ),
          ...(args.path === "react" || args.path === "reactDom"
            ? [`export {default} from "pythia-binding:${args.path}/default";`]
            : []),
        ].join("\n"),
        loader: "js",
      }));
      builder.onResolve({ filter: /^pythia-binding:/ }, (args) => {
        if (args.namespace !== "pythia-host")
          throw new Error("Compiler binding imports are not an authoring API.");
        return {
          path: args.path.slice("pythia-binding:".length),
          namespace: "pythia-binding",
          sideEffects: false,
        };
      });
      builder.onLoad({ filter: /.*/, namespace: "pythia-binding" }, (args) => {
        const [surface, name] = args.path.split("/");
        return {
          contents: `export default __pythiaHost.${surface}${name === "default" ? "" : `.${name}`};`,
          loader: "js",
        };
      });
    },
  };
}

export function requiredImports(metafile) {
  const required = {};
  for (const output of Object.values(metafile.outputs))
    for (const [path, contribution] of Object.entries(output.inputs)) {
      if (
        !path.startsWith("pythia-binding:") ||
        contribution.bytesInOutput === 0
      )
        continue;
      const [surface, name] = path.slice("pythia-binding:".length).split("/");
      required[surface] ??= new Set();
      const names = required[surface];
      for (const exported of name === "default" ? surfaces[surface] : [name])
        names.add(exported);
    }
  return Object.fromEntries(
    Object.entries(required).map(([surface, names]) => [
      surface,
      [...names].sort(),
    ]),
  );
}
