"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Kit, KitMeta } from "@prepkit/core";
import { api } from "./api";
import type { ProgressEvent } from "./timeline";

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
    onSuccess: ({ kit }, { fresh: _fresh, days, ...input }) => {
      // The record as the server holds it at this moment: queued, no steps yet. Cached so the
      // kit page can show its header and timeline at once; the first poll replaces it.
      queryClient.setQueryData<KitDetail>(["kit", kit.id], {
        id: kit.id,
        status: kit.status,
        input: { ...input, days: days ?? kit.days },
        progress: [],
        error: null,
        kit: null,
        meta: null,
        rev: 0,
        createdAt: kit.createdAt,
        updatedAt: kit.updatedAt,
      });
      return queryClient.invalidateQueries({ queryKey: ["kits"] });
    },
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

/** GET /api/kits/:id — the kit itself once it is ready, and how generation went until then. */
export interface KitDetail {
  id: string;
  status: KitStatus;
  input: { jd: string; companyUrl: string; days: number };
  progress: ProgressEvent[];
  error: { code: string; message: string } | null;
  kit: Kit | null;
  meta: KitMeta | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** Before the kit exists, the first line of the description is the best name there is. */
export function kitTitle(kit: Pick<KitDetail, "kit" | "input">): string {
  const fromKit = kit.kit?.role.title || kit.kit?.source.role;
  if (fromKit) return fromKit;
  return kit.input.jd.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Untitled role";
}

const KIT_POLL_MS = 2_000;

export function useKit(id: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["kit", id],
    // Switched off while the kit is being deleted: a poll landing just after the delete would
    // be answered 404, and the page would flash "not found" on its way back to the list.
    enabled,
    queryFn: async ({ signal }) => (await api<{ kit: KitDetail }>(`/kits/${id}`, { signal })).kit,
    // The server writes every step as it happens; this is what makes the timeline move. It
    // stops asking as soon as the kit is ready or has failed.
    refetchInterval: (query) => (query.state.data && isGenerating(query.state.data) ? KIT_POLL_MS : false),
  });
}

export function useRetryKit(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ kit: KitSummary }>(`/kits/${id}/retry`, { method: "POST" }),
    onSuccess: ({ kit }) => {
      // Queued again, from scratch: shown at once, confirmed by the next poll.
      queryClient.setQueryData<KitDetail>(["kit", id], (current) => current && { ...current, status: kit.status, progress: [], error: null, updatedAt: kit.updatedAt });
      return Promise.all([queryClient.invalidateQueries({ queryKey: ["kit", id] }), queryClient.invalidateQueries({ queryKey: ["kits"] })]);
    },
  });
}

/**
 * `onDeleted` and `onFailed` are given here rather than to mutate(): deleting unmounts the button
 * that asked for it, and TanStack Query drops a mutate() call's own callbacks once its component
 * is gone. Callbacks given to useMutation always run.
 */
export function useDeleteKit(id: string, { onDeleted, onFailed }: { onDeleted: () => void; onFailed: () => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/kits/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      // The list the user lands on is the cached one, so the kit comes out of it now rather than
      // when the refetch answers: otherwise it stays on the page for a round trip after deletion.
      queryClient.setQueryData<KitSummary[]>(["kits"], (kits) => kits?.filter((kit) => kit.id !== id));
      onDeleted();
      queryClient.removeQueries({ queryKey: ["kit", id] });
      return queryClient.invalidateQueries({ queryKey: ["kits"] });
    },
    onError: onFailed,
  });
}
