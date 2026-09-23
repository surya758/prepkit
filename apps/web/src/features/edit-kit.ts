"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { KitMeta } from "@prepkit/core";
import { api } from "@/lib/api";
import type { KitState } from "@/lib/kit-edits";
import type { KitDetail } from "@/lib/kits";

// Every builder change goes through here: applied to the cached kit at once so the page answers
// the keystroke, then confirmed by the server's answer, which is taken as the truth because it
// recomputed coverage and the schedule and may have merged changes landing from elsewhere.
//
// Only the change is sent, never the whole kit, so a slow save cannot overwrite something
// edited after it was sent; the server applies each change to the latest kit it has.

export interface EditRequest {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to /api/kits/:id */
  path: string;
  /** A function is given the kit as cached, for a body that depends on it (a full order built from one category's). */
  body?: Record<string, unknown> | ((current: KitState) => Record<string, unknown>);
  /** What the kit looks like once this change has applied, for the moment before the server answers. One of lib/kit-edits. */
  optimistic?: (current: KitState) => KitState;
  /** Shown in the toast if the save fails. */
  failed: string;
}

const EMPTY_META: KitMeta = { items: {}, nextQuestion: 1, nextFlashcard: 1, scheduleEdited: false };

export function useEditKit(kitId: string) {
  const queryClient = useQueryClient();
  const key = ["kit", kitId] as const;

  return useMutation({
    mutationFn: (edit: EditRequest) => {
      const current = queryClient.getQueryData<KitDetail>(key);
      const body = typeof edit.body === "function" && current?.kit ? edit.body({ kit: current.kit, meta: current.meta ?? EMPTY_META }) : edit.body;
      return api<{ kit: KitDetail }>(`/kits/${kitId}${edit.path}`, { method: edit.method, body });
    },
    onMutate: async (edit) => {
      // A poll or refetch landing mid-edit would overwrite the optimistic state.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<KitDetail>(key);
      if (previous?.kit && edit.optimistic) {
        const next = edit.optimistic({ kit: previous.kit, meta: previous.meta ?? EMPTY_META });
        queryClient.setQueryData<KitDetail>(key, { ...previous, kit: next.kit, meta: next.meta });
      }
      return { previous };
    },
    onSuccess: ({ kit }) => queryClient.setQueryData<KitDetail>(key, kit),
    onError: (error, edit, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(edit.failed, { description: error.message });
    },
  });
}
