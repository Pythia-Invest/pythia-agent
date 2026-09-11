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
  providers: ModelProvider[];
};
export type ModelPrice = {
  input?: string | undefined;
  output?: string | undefined;
  free: boolean;
};
export type ModelProvider = {
  slug: string;
  name: string;
  aliases: string[];
  authenticated: boolean;
  authType?: string | undefined;
  featuredModels: string[];
  source?: string | undefined;
  warning?: string | undefined;
  models: {
    id: string;
    reasoning: boolean;
    canDisableReasoning: boolean;
    price?: ModelPrice | undefined;
    unavailable: boolean;
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
      const pricing = record(row.pricing);
      const unavailable = new Set(
        (Array.isArray(row.unavailable_models)
          ? row.unavailable_models
          : []
        ).flatMap((value) => {
          const id = text(value);
          return id ? [id] : [];
        }),
      );
      return [
        {
          slug,
          name: text(row.name) || slug,
          aliases: (Array.isArray(row.aliases) ? row.aliases : []).flatMap(
            (value) => {
              const alias = text(value);
              return alias ? [alias] : [];
            },
          ),
          authenticated: row.authenticated === true,
          ...(text(row.auth_type) ? { authType: text(row.auth_type) } : {}),
          featuredModels: (Array.isArray(row.featured_models)
            ? row.featured_models
            : []
          ).flatMap((value) => {
            const id = text(value);
            return id ? [id] : [];
          }),
          ...(text(row.source) ? { source: text(row.source) } : {}),
          ...(text(row.warning) ? { warning: text(row.warning) } : {}),
          models: (Array.isArray(row.models) ? row.models : []).flatMap(
            (value) => {
              const id = text(value);
              const caps = record(record(row.capabilities)[id]);
              const nativePrice = record(pricing[id]);
              const input = text(nativePrice.input);
              const output = text(nativePrice.output);
              const hasPrice =
                input || output || typeof nativePrice.free === "boolean";
              return id
                ? [
                    {
                      id,
                      reasoning: caps.reasoning !== false,
                      canDisableReasoning: caps.can_disable_reasoning !== false,
                      ...(hasPrice
                        ? {
                            price: {
                              ...(input ? { input } : {}),
                              ...(output ? { output } : {}),
                              free: nativePrice.free === true,
                            },
                          }
                        : {}),
                      unavailable: unavailable.has(id),
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

/**
 * Remove effort overrides that contradict Hermes' native model capability
 * flags or apply the ordinary single-model control to its virtual MoA route.
 * Explicit enabled levels stay untouched because Hermes owns the
 * provider-specific effort clamping behind its canonical ladder.
 */
export function normalizeModelSelection(
  catalog: ModelCatalog,
  selection: ModelSelection,
): ModelSelection {
  const model = catalog.providers
    .find((provider) => provider.slug === selection.provider)
    ?.models.find((candidate) => candidate.id === selection.model);
  const invalidEffort =
    model &&
    (selection.provider === "moa" ||
      !model.reasoning ||
      (selection.effort === "none" && !model.canDisableReasoning));
  if (!invalidEffort || selection.effort === undefined) return selection;
  return { provider: selection.provider, model: selection.model };
}
