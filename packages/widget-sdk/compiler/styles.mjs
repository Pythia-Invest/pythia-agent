import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { transform } from "lightningcss";

const scopedRules = new Set([
  "style",
  "nesting",
  "nested-declarations",
  "media",
  "supports",
  "container",
  "scope",
  "starting-style",
  "ignored",
]);

/** Ordinary authored CSS is retained, but globally named rules cannot acquire
 * Desk-wide effect just by being wrapped in @scope. Fail explicitly instead. */
function authoredStyles(css) {
  return transform({
    filename: "widget-authored.css",
    code: Buffer.from(css),
    visitor: {
      Rule(rule) {
        if (!scopedRules.has(rule.type))
          throw new Error(
            `Widget CSS cannot use global @${rule.type} rules. Use scoped selectors and the host theme.`,
          );
      },
    },
  }).code.toString();
}

export async function compileStyles(javascript, authoredCss, base) {
  // References contribute only utility definitions. Desk already owns tokens,
  // font faces, theme/profile selectors, preflight, and shared UI component CSS.
  const compiler = await compile(
    '@reference "tailwindcss";\n@reference "@pythia/ui/styles.css";\n@tailwind utilities;',
    { base, onDependency() {} },
  );
  const candidates = new Scanner({}).scanFiles([
    { content: javascript, extension: "js" },
  ]);
  return {
    utilities: compiler.build(candidates),
    authored: authoredStyles(authoredCss),
  };
}

export function scopeStyles({ utilities, authored }, scope) {
  const animations = new Set();
  transform({
    filename: "widget-utilities.css",
    code: Buffer.from(utilities),
    visitor: {
      Rule: {
        keyframes(rule) {
          animations.add(rule.value.name.value);
        },
      },
    },
  });
  const scopedUtilities = transform({
    filename: "widget-utilities.css",
    code: Buffer.from(utilities),
    visitor: {
      // Layers are owned by Desk. Widget utility ordering stays local, and
      // registration names never collide with another widget or the host.
      Rule: {
        "layer-statement"() {
          return [];
        },
        "layer-block"(rule) {
          return rule.value.rules;
        },
      },
      DashedIdent(name) {
        if (name.startsWith("--tw-") || name.startsWith("--animate-"))
          return `--${scope}-${name.slice(2)}`;
      },
      CustomIdent(name) {
        if (animations.has(name)) return `${scope}-${name}`;
      },
      Token: {
        ident(token) {
          if (animations.has(token.value))
            return {
              type: "token",
              value: { ...token, value: `${scope}-${token.value}` },
            };
        },
      },
    },
  }).code.toString();
  return transform({
    filename: "widget.css",
    code: Buffer.from(
      `@scope ([data-pythia-widget="${scope}"]) {\n${scopedUtilities}\n${authored}\n}`,
    ),
    minify: true,
  }).code.toString();
}
