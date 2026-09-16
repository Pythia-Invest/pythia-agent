"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDeskDrafts } from "@/client/providers";
import { strategyName } from "@/workspace/strategies";

/** Prepare an ordinary new-chat draft. Hermes creates a session only on send. */
export function useStartStrategy() {
  const drafts = useDeskDrafts();
  const router = useRouter();
  return useCallback(
    (briefPath: string) => {
      if (!strategyName(briefPath)) return;
      drafts.stageNewChat({ references: [], startStrategyPath: briefPath });
      router.push("/");
    },
    [drafts, router],
  );
}
