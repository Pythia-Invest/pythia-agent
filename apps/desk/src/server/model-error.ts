// Match observed native error text; never expose upstream details or secrets.
export function modelError(value: unknown) {
  if (typeof value !== "string") return null;
  if (/no inference provider configured/iu.test(value))
    return {
      code: "model_selection_missing" as const,
      error:
        "No model is selected. Choose a provider and model below, then send your message again.",
    };
  if (
    /no (?:model )?credentials|no .*credentials (?:stored|found)|no .*authentication found/iu.test(
      value,
    )
  )
    return {
      code: "model_auth_missing" as const,
      error:
        "Connect credentials for the selected provider through native Hermes authentication.",
    };
  if (/provider authentication|authentication failed/iu.test(value))
    return {
      code: "model_provider_failed" as const,
      error:
        "Hermes could not authenticate with the selected provider. Check that provider's account and model configuration; another login may not be necessary.",
    };
  return null;
}
