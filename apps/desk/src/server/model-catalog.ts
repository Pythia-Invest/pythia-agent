export const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ModelSelection = {
  provider: string;
  model: string;
  effort?: (typeof reasoningEfforts)[number] | undefined;
};
export type ModelCatalog = {
  provider: string;
  model: string;
  providers: {
    slug: string;
    name: string;
    authenticated: boolean;
    models: { id: string; reasoning: boolean; canDisableReasoning: boolean }[];
  }[];
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" &&
    value.length <= 512 &&
    !/[\r\n\0]/u.test(value)
    ? value
    : "";
}

// Deliberately exclude endpoints, credential metadata, pricing and unknown fields.
export function modelCatalog(value: unknown): ModelCatalog {
  const source = record(value);
  return {
    provider: text(source.provider),
    model: text(source.model),
    providers: (Array.isArray(source.providers)
      ? source.providers
      : []
    ).flatMap((value) => {
      const row = record(value);
      const slug = text(row.slug);
      if (!slug) return [];
      return [
        {
          slug,
          name: text(row.name) || slug,
          authenticated: row.authenticated === true,
          models: (Array.isArray(row.models) ? row.models : []).flatMap(
            (value) => {
              const id = text(value);
              const caps = record(record(row.capabilities)[id]);
              return id
                ? [
                    {
                      id,
                      reasoning: caps.reasoning !== false,
                      canDisableReasoning: caps.can_disable_reasoning !== false,
                    },
                  ]
                : [];
            },
          ),
        },
      ];
    }),
  };
}

export function parseModelSelection(
  value: unknown,
): ModelSelection | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const provider = text(source.provider).trim();
  const model = text(source.model).trim();
  if (
    !provider ||
    !model ||
    !/^[a-zA-Z0-9_.:-]+$/u.test(provider) ||
    Object.keys(source).some(
      (key) => !["provider", "model", "effort"].includes(key),
    ) ||
    (source.effort !== undefined &&
      !reasoningEfforts.includes(
        source.effort as ModelSelection["effort"] & string,
      ))
  ) {
    throw new Error("Choose a provider, model and valid reasoning effort.");
  }
  return {
    provider,
    model,
    ...(source.effort === undefined
      ? {}
      : { effort: source.effort as ModelSelection["effort"] }),
  };
}
