import type { ReactNode } from "react";
import { CatalogShell } from "../catalog-shell";

export default function DemonstrationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CatalogShell>{children}</CatalogShell>;
}
