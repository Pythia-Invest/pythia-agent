import { deskRoutes } from "@/server/routes";

export const dynamic = "force-dynamic";
export const GET = deskRoutes.providerSignIn;
export const POST = deskRoutes.cancelProviderSignIn;
export const OPTIONS = deskRoutes.preflight;
