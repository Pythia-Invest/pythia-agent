import { HydrationBoundary } from "@tanstack/react-query";
import { headers } from "next/headers";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { initialWorkspaceState } from "@/server/workspace/initial";

export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const path = (await params).path?.join("/") ?? "";
  const request = new Request("http://desk.invalid/workspace", {
    headers: await headers(),
  });
  const state = await initialWorkspaceState(request, path);
  return (
    <HydrationBoundary state={state}>
      <WorkspacePage />
    </HydrationBoundary>
  );
}
