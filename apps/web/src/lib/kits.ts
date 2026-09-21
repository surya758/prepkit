"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type KitStatus = "queued" | "running" | "ready" | "failed";

/** One row of GET /api/kits. */
export interface KitSummary {
  id: string;
  status: KitStatus;
  title: string;
  company: string;
  days: number;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const isGenerating = (kit: Pick<KitSummary, "status">) => kit.status === "queued" || kit.status === "running";

const POLL_MS = 3_000;

export function useKits() {
  return useQuery({
    queryKey: ["kits"],
    queryFn: async ({ signal }) => (await api<{ kits: KitSummary[] }>("/kits", { signal })).kits,
    // Generation happens on the server whether or not anyone is watching. The list re-asks only
    // while something is still generating, and stops by itself when the last kit settles.
    refetchInterval: (query) => (query.state.data?.some(isGenerating) ? POLL_MS : false),
  });
}
