import { HermesApiError } from "./hermes-records";
import { DeviceSettingsError } from "./device-settings";

export function result(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function routeError(error: unknown) {
  if (error instanceof HermesApiError || error instanceof DeviceSettingsError) {
    return result(
      { error: { code: error.code ?? "hermes_error", message: error.message } },
      error.status,
    );
  }
  return result(
    {
      error: {
        code: "desk_error",
        message: "Pythia Desk could not complete the request.",
      },
    },
    500,
  );
}

export async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 65_536)
    throw new HermesApiError("The request is too large.", 413);
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HermesApiError("The request must contain a JSON object.", 400);
  }
}

export function textField(
  body: Record<string, unknown>,
  field: string,
  maximum: number,
  label: string,
) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (!value || value.length > maximum || /[\0]/u.test(value)) {
    throw new HermesApiError(
      `${label} is required and must be at most ${maximum} characters.`,
      400,
    );
  }
  return value;
}

export function identifier(value: string | undefined, label: string) {
  const clean = value?.trim() ?? "";
  if (!clean || clean.length > 512 || /[\r\n\0]/u.test(clean)) {
    throw new HermesApiError(`A valid ${label} is required.`, 400);
  }
  return clean;
}
