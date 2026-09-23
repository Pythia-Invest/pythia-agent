/** Admission for the pinned Vega AST interpreter. An expression interpreter is
 * not an object sandbox: native events and scene items carry links to the View
 * and DOM. Keep those objects opaque except for selection metadata and numeric
 * interaction helpers. Inspect the parsed AST, including compiler expressions,
 * rather than matching expression source or trusting Vega-Lite passthroughs.
 */
const FAILURE =
  "This visualization uses unsupported runtime expressions or event sources.";
type Node = { type: string; [key: string]: unknown };
type Kind =
  | "data"
  | "event"
  | "item"
  | "mark"
  | "group"
  | "item-array"
  | "mark-array";
const fail = (): never => {
  throw new Error(FAILURE);
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const forbidden = new Set(["__proto__", "prototype", "constructor", "context"]);
const eventScalars = new Set([
  "altKey",
  "ctrlKey",
  "metaKey",
  "shiftKey",
  "button",
  "buttons",
  "clientX",
  "clientY",
  "pageX",
  "pageY",
  "screenX",
  "screenY",
  "offsetX",
  "offsetY",
  "movementX",
  "movementY",
  "deltaX",
  "deltaY",
  "deltaZ",
  "deltaMode",
  "detail",
  "key",
  "code",
  "keyCode",
  "which",
  "repeat",
  "pointerId",
  "pointerType",
  "pressure",
  "timeStamp",
  "type",
]);
const itemScalars = new Set([
  "x",
  "y",
  "x2",
  "y2",
  "width",
  "height",
  "name",
  "isVoronoi",
  "anchor",
  "orient",
  "_anchor",
  "padding",
  "align",
  "angle",
  "limit",
]);
// Pinned native numeric/data functions. No arbitrary registered extensions,
// scene traversal (intersect), browser objects (view/screen), or accessors that
// hide property traversal (pluck). copy/encode return executable/runtime values.
const functions = new Set(
  `
  if isNaN isFinite abs acos asin atan atan2 ceil cos exp floor log max min pow
  random round sin sqrt tan clamp now utc datetime date day year month hours
  minutes seconds milliseconds time timezoneoffset utcdate utcday utcyear
  utcmonth utchours utcminutes utcseconds utcmilliseconds length join indexof
  lastindexof slice reverse parseFloat parseInt upper lower substring split
  replace trim regexp test cumulativeNormal cumulativeLogNormal cumulativeUniform
  densityNormal densityLogNormal densityUniform quantileNormal quantileLogNormal
  quantileUniform sampleNormal sampleLogNormal sampleUniform isArray isBoolean
  isDate isDefined isNumber isObject isRegExp isString isTuple isValid toBoolean
  toDate toNumber toString flush lerp merge pad peek span inrange truncate rgb lab
  hcl hsl luminance contrast sequence format utcFormat utcParse utcOffset
  utcSequence timeFormat timeParse timeOffset timeSequence timeUnitSpecifier
  monthFormat monthAbbrevFormat dayFormat dayAbbrevFormat quarter utcquarter week
  utcweek dayofyear utcdayofyear extent inScope clampRange pinchDistance pinchAngle
  containerSize windowSize bandspace setdata panLinear panLog panPow panSymlog
  zoomLinear zoomLog zoomPow zoomSymlog modify bandwidth domain range invert scale
  gradient geoArea geoBounds geoCentroid geoScale indata data treePath treeAncestors
  vlSelectionTest vlSelectionIdTest vlSelectionResolve vlSelectionTuples
  item group x y xy _bandwidth _range _scale
`
    .trim()
    .split(/\s+/),
);

function property(node: Node): string {
  const prop = node.property as Node;
  // No computed property expressions: concatenation, signals and helpers must
  // not turn ordinary data indexing into runtime/prototype traversal.
  const key = node.computed
    ? prop.type === "Literal"
      ? prop.value
      : fail()
    : prop.type === "Identifier"
      ? prop.name
      : fail();
  if (
    (typeof key !== "string" && typeof key !== "number") ||
    forbidden.has(String(key))
  )
    fail();
  return String(key);
}
const identifier = (n: unknown, name: string) =>
  object(n) && n.type === "Identifier" && n.name === name;
const call = (n: unknown, name: string) =>
  object(n) &&
  n.type === "CallExpression" &&
  identifier(n.callee, name) &&
  Array.isArray(n.arguments) &&
  n.arguments.length === 0;

function inspect(node: Node): Kind {
  switch (node.type) {
    case "Literal":
      return "data";
    case "Identifier":
      if (forbidden.has(String(node.name))) fail();
      return node.name === "event"
        ? "event"
        : node.name === "item"
          ? "item"
          : node.name === "unit"
            ? "group"
            : "data";
    case "MemberExpression": {
      const key = property(node);
      const base = inspect(node.object as Node);
      if (base === "event") {
        if (key === "item") return "item";
        if (!eventScalars.has(key)) fail();
      } else if (base === "item" || base === "group") {
        if (key === "mark") return "mark";
        if (key === "items") return "mark-array";
        if (key !== "datum" && !itemScalars.has(key)) fail();
      } else if (base === "mark") {
        if (key === "group") return "group";
        if (key === "items") return "item-array";
        if (!["name", "role", "marktype"].includes(key)) fail();
      } else if (base === "item-array" || base === "mark-array") {
        if (/^(0|[1-9][0-9]*)$/.test(key))
          return base === "item-array" ? "item" : "mark";
        if (key !== "length") fail();
      } else if (key === "items") {
        return "mark-array";
      } else if (key === "mark") {
        // Nearest-point data can itself be a scene item.
        return "mark";
      }
      return "data";
    }
    case "CallExpression": {
      const callee = node.callee as Node;
      if (callee.type !== "Identifier" || !functions.has(String(callee.name)))
        fail();
      const name = String(callee.name);
      const args = node.arguments as Node[];
      for (const arg of args) {
        const kind = inspect(arg);
        if (
          kind !== "data" &&
          !(
            (["isTuple", "inScope", "x", "y", "xy"].includes(name) &&
              ["item", "group"].includes(kind)) ||
            (["pinchDistance", "pinchAngle"].includes(name) && kind === "event")
          )
        )
          fail();
      }
      return name === "item" ? "item" : name === "group" ? "group" : "data";
    }
    case "UnaryExpression":
      if (inspect(node.argument as Node) !== "data" && node.operator !== "!")
        fail();
      return "data";
    case "BinaryExpression":
      if (
        [inspect(node.left as Node), inspect(node.right as Node)].some(
          (k) => k !== "data",
        ) &&
        !["==", "!=", "===", "!=="].includes(String(node.operator))
      )
        fail();
      return "data";
    case "LogicalExpression": {
      const left = inspect(node.left as Node);
      if (node.operator === "||" && left !== "data") fail();
      const right = inspect(node.right as Node);
      // Native event filters use `event.item && <boolean>`; never retain the
      // scene object as an expression result.
      if (right !== "data") fail();
      return "data";
    }
    case "ConditionalExpression": {
      inspect(node.test as Node);
      if (
        inspect(node.consequent as Node) !== "data" ||
        inspect(node.alternate as Node) !== "data"
      )
        fail();
      return "data";
    }
    case "ArrayExpression":
      if ((node.elements as Node[]).some((n) => inspect(n) !== "data")) fail();
      return "data";
    case "ObjectExpression":
      for (const prop of node.properties as { key: Node; value: Node }[]) {
        const key = prop.key.name ?? prop.key.value;
        if (forbidden.has(String(key)) || inspect(prop.value) !== "data")
          fail();
      }
      return "data";
    default:
      return fail();
  }
}

function inspectExpression(ast: Node, unitUpdate: boolean): void {
  // Vega-Lite's native selection unit signal retains the current group only
  // for x(unit)/y(unit) coordinates. Everywhere else `unit` stays opaque.
  if (
    unitUpdate &&
    ast.type === "ConditionalExpression" &&
    call(ast.consequent, "group") &&
    identifier(ast.alternate, "unit") &&
    object(ast.test) &&
    ast.test.type === "CallExpression" &&
    identifier(ast.test.callee, "isTuple") &&
    Array.isArray(ast.test.arguments) &&
    ast.test.arguments.length === 1 &&
    call(ast.test.arguments[0], "group")
  )
    return;
  if (inspect(ast) !== "data") fail();
}

/** Walk only runtime descriptors; inline investor rows are not expression ASTs. */
export function assertSafeRuntime(runtime: unknown): void {
  const unitExpressions = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (!object(value)) return;
    if (Array.isArray(value.operators) && Array.isArray(value.updates)) {
      const units = new Set(
        value.operators
          .filter((op) => object(op) && op.signal === "unit")
          .map((op) => op.id),
      );
      for (const update of value.updates) {
        if (
          object(update) &&
          units.has(update.target) &&
          object(update.update) &&
          object(update.update.$expr) &&
          object(update.update.$expr.ast)
        )
          unitExpressions.add(update.update.$expr.ast);
      }
    }
    if (object(value.ast))
      inspectExpression(value.ast as Node, unitExpressions.has(value.ast));
    if (Array.isArray(value.streams)) {
      for (const stream of value.streams) {
        if (!object(stream) || stream.source === undefined) continue;
        if (stream.source !== "view" && stream.source !== "window") fail();
        if (
          stream.source === "window" &&
          ![
            "pointermove",
            "pointerup",
            "mousemove",
            "mouseup",
            "touchmove",
            "touchend",
            "resize",
          ].includes(String(stream.type))
        )
          fail();
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "ast" && key !== "value") walk(child);
    }
  };
  walk(runtime);
}
