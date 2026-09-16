"use client";

import { createContext } from "react";

/** Temporary chat sheets yield to an explicitly opened artifact, even at the same URL. */
export const ArtifactNavigationContext = createContext<() => void>(() => {});
