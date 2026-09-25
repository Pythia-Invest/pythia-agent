import { deskRoutes } from "@/server/routes";

export const dynamic = "force-dynamic";
export const GET = deskRoutes.pluginConfiguration;
export const PATCH = deskRoutes.setPluginConfiguration;
export const OPTIONS = deskRoutes.preflight;
