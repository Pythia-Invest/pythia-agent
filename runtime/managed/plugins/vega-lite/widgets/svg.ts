const FAILURE = "This SVG contains unsupported resource references.";
const TAGS = new Set([
  "svg",
  "g",
  "defs",
  "clippath",
  "path",
  "rect",
  "line",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "text",
  "tspan",
  "lineargradient",
  "radialgradient",
  "stop",
]);

function attributeValue(value: string): string {
  return value.replace(/&([^;]+);/g, (_match, entity: string) => {
    const named: Record<string, string> = {
      amp: "&",
      quot: '"',
      apos: "'",
      lt: "<",
      gt: ">",
    };
    if (Object.hasOwn(named, entity)) return named[entity] as string;
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    throw new Error(FAILURE);
  });
}

/** Validate only Vega-generated SVG, never sanitize arbitrary user markup.
 * Vega's loader does not mediate SVG paint URLs, so exports need this check.
 */
export function assertSafeSvg(svg: string): string {
  // Vega's serializer emits quoted attributes and no declarations or comments.
  // Reject any unexpected markup rather than attempting to repair it.
  const tags = svg.match(/<[^>]*>/g) ?? [];
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>"))
    throw new Error(FAILURE);
  for (const tag of tags) {
    const parsed = /^<\/?([A-Za-z][A-Za-z0-9]*)([\s\S]*?)\/?\s*>$/.exec(tag);
    if (!parsed || !TAGS.has((parsed[1] as string).toLowerCase())) {
      throw new Error(FAILURE);
    }
    let attributes = parsed[2] as string;
    while (attributes.trim()) {
      const attribute =
        /^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(
          attributes,
        );
      if (!attribute) throw new Error(FAILURE);
      attributes = attributes.slice(attribute[0].length);
      const name = (attribute[1] as string).toLowerCase();
      const local = name.split(":").at(-1) as string;
      if (
        local === "href" ||
        local === "src" ||
        local === "style" ||
        local.startsWith("on")
      ) {
        throw new Error(FAILURE);
      }
      const value = attributeValue(attribute[2] ?? attribute[3] ?? "");
      // CSS escapes/comments can disguise resource-bearing tokens.
      if (value.includes("\\") || value.includes("/*"))
        throw new Error(FAILURE);
      for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
        const target = (match[1] as string)
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2");
        if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(target))
          throw new Error(FAILURE);
      }
      // An incomplete URL token is not valid generated paint syntax either.
      if (/url\s*\(/i.test(value.replace(/url\s*\([^)]*\)/gi, ""))) {
        throw new Error(FAILURE);
      }
    }
  }
  return svg;
}
