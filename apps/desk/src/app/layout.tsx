import {
  brandAssetUrls,
  DEFAULT_THEME_ROOT_ATTRIBUTES,
  THEME_BOOTSTRAP_SCRIPT,
} from "@pythia/ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pythia Desk",
  description: "A local investment agent built on Hermes.",
  icons: { icon: brandAssetUrls.favicon },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "light dark" };

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      data-pythia-profile="product"
      data-theme={DEFAULT_THEME_ROOT_ATTRIBUTES["data-theme"]}
      data-theme-preference={
        DEFAULT_THEME_ROOT_ATTRIBUTES["data-theme-preference"]
      }
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
