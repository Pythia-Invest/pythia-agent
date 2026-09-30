import { deskRoutes } from "@/server/routes";

export const dynamic = "force-dynamic";
export const GET = deskRoutes.hermesConfig;
export const PATCH = deskRoutes.saveHermesConfig;
export const OPTIONS = deskRoutes.preflight;
