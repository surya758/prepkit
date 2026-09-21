"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number | undefined;
  /**
   * Set when the user has been told a kit already exists and asked for a fresh one anyway. The
   * key is made once per such decision, so the same decision arriving twice makes one kit.
   */
  fresh?: { idempotencyKey: string };
}

export function useCreateKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fresh, ...input }: CreateKitInput) =>
      api<{ kit: KitSummary }>("/kits", {
        method: "POST",
        body: fresh ? { ...input, force: true } : input,
        headers: fresh ? { "Idempotency-Key": fresh.idempotencyKey } : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kits"] }),
  });
}

/** The outcome for one role of an uploaded file. Roles succeed or fail independently. */
export type BulkResult =
  | { index: number; status: "created"; kit: KitSummary }
  | { index: number; status: "duplicate"; kitId?: string; message: string }
  | { index: number; status: "invalid"; message: string; details?: { path: string; message: string }[] };

export function useCreateKits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: unknown[]) => api<{ results: BulkResult[] }>("/kits/bulk", { method: "POST", body: { items } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kits"] }),
  });
}
