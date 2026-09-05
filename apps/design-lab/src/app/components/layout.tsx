import type { ReactNode } from "react";
import { CatalogShell } from "../catalog-shell";

export default function ComponentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CatalogShell>{children}</CatalogShell>;
}
