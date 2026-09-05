import { deskRoutes } from "@/server/routes";

export const dynamic = "force-dynamic";
export const GET = deskRoutes.listSessions;
export const POST = deskRoutes.createSession;
export const OPTIONS = deskRoutes.preflight;
