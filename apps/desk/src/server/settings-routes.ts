import { admitBrowserRequest } from "./admission";
import {
  DeviceSettingsError,
  type DeviceSettingsService,
} from "./device-settings";

type RouteContext = { params: Promise<Record<string, string>> };

function result(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function routeError(error: unknown) {
  if (error instanceof DeviceSettingsError) {
    return result(
      { error: { code: error.code, message: error.message } },
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

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 65_536) {
    throw new DeviceSettingsError(
      "The request is too large.",
      413,
      "invalid_settings_request",
    );
  }
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new DeviceSettingsError(
      "The request must contain a JSON object.",
      400,
      "invalid_settings_request",
    );
  }
}

function booleanField(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "boolean") {
    throw new DeviceSettingsError(
      `${field} must be true or false.`,
      400,
      "invalid_settings_request",
    );
  }
  return body[field];
}

function identifier(value: string | undefined, label: string) {
  const clean = value?.trim() ?? "";
  if (!clean || clean.length > 512 || /[\r\n\0]/u.test(clean)) {
    throw new DeviceSettingsError(
      `A valid ${label} is required.`,
      400,
      "invalid_settings_request",
    );
  }
  return clean;
}

export function createSettingsRoutes(settings: DeviceSettingsService) {
  return {
    async settingsSnapshot(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        return result(await settings.snapshot());
      } catch (error) {
        return routeError(error);
      }
    },
    async setSkillEnabled(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const name = identifier((await context.params).name, "skill name");
        const body = await readBody(request);
        return result({
          skill: await settings.setSkillEnabled(
            name,
            booleanField(body, "enabled"),
          ),
        });
      } catch (error) {
        return routeError(error);
      }
    },
    async setToolsetEnabled(request: Request, context: RouteContext) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const name = identifier((await context.params).name, "toolset name");
        const body = await readBody(request);
        return result({
          toolset: await settings.setToolsetEnabled(
            name,
            booleanField(body, "enabled"),
          ),
        });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
