"use client";

import type { Kit, KitMeta } from "@prepkit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "./api";
import type { KitDetail } from "./kits";

// Every builder change goes through here. The shape is the same for all of them:
//
//   1. apply the change to the cached kit at once, so the page answers the keystroke
//   2. send one small request describing only that change
//   3. on success, take the server's answer as the truth — it recomputed coverage and the
//      schedule, and may have merged changes landing from elsewhere
//   4. on failure, put the cached kit back as it was and say so
//
// Only the change is sent, never the whole kit, so a slow save cannot overwrite something
// edited after it was sent; the server applies each change to the latest kit it has.

export interface EditRequest {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to /api/kits/:id */
  path: string;
  body?: unknown;
  /** What the kit looks like once this change has applied, for the moment before the server answers. */
  optimistic?: (current: { kit: Kit; meta: KitMeta }) => { kit: Kit; meta: KitMeta };
  /** Shown in the toast if the save fails. */
  failed: string;
}

export function useEditKit(kitId: string) {
  const queryClient = useQueryClient();
  const key = ["kit", kitId] as const;

  return useMutation({
    mutationFn: (edit: EditRequest) => api<{ kit: KitDetail }>(`/kits/${kitId}${edit.path}`, { method: edit.method, body: edit.body }),
    onMutate: async (edit) => {
      // A poll or refetch landing mid-edit would overwrite the optimistic state.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<KitDetail>(key);
      if (previous?.kit && edit.optimistic) {
        const next = edit.optimistic({ kit: previous.kit, meta: previous.meta ?? { items: {}, nextQuestion: 1, nextFlashcard: 1, scheduleEdited: false } });
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
