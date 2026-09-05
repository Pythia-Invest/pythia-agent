import {
  brandAssetUrls,
  DEFAULT_THEME_ROOT_ATTRIBUTES,
  THEME_BOOTSTRAP_SCRIPT,
} from "@pythia/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "./globals.css";
import { shouldHideDesignLab } from "./runtime-policy";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  if (shouldHideDesignLab(process.env.NODE_ENV)) notFound();

  return (
    <html
      data-pythia-profile="public"
      data-theme={DEFAULT_THEME_ROOT_ATTRIBUTES["data-theme"]}
      data-theme-preference={
        DEFAULT_THEME_ROOT_ATTRIBUTES["data-theme-preference"]
      }
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <link href={brandAssetUrls.favicon} rel="icon" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
