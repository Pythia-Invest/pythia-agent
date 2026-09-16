import type { ReactNode } from "react";

/** The page seeds its initial query cache; native history navigation keeps the
 * mounted workspace browser and companion state while changing the pathname. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return children;
}
