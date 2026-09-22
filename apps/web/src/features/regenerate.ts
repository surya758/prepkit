"use client";

import type { Question } from "@prepkit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import type { KitDetail } from "@/lib/kits";

// Asking the model again for one part of the kit. Unlike an edit, nothing is predicted here:
// what comes back is the server's merge of the fresh draft with what the user has kept, a rule
// that lives in core and takes a few seconds, so the page shows progress on that part only and
// takes the answer when it lands. Everything else stays editable meanwhile; an edit made while
// the model is thinking is merged on the server against the kit as it is by then.

export type RegenerateTarget = { section: "questions"; category: Question["category"] } | { section: "brief" } | { section: "schedule"; days?: number };

const keyOf = (target: RegenerateTarget) => (target.section === "questions" ? `questions:${target.category}` : target.section);

export function useRegenerate(kitId: string) {
  const queryClient = useQueryClient();
  // Which parts are being regenerated right now. A Set, since two categories can run at once.
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  // A 409 is not a failure to show as one: the server explains what the kit is missing.
  const [refused, setRefused] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (target: RegenerateTarget) => api<{ kit: KitDetail }>(`/kits/${kitId}/regenerate`, { method: "POST", body: target }),
    onMutate: (target) => {
      setRunning((s) => new Set(s).add(keyOf(target)));
      setRefused((r) => {
        const next = { ...r };
        delete next[keyOf(target)];
        return next;
      });
    },
    onSuccess: ({ kit }) => queryClient.setQueryData<KitDetail>(["kit", kitId], kit),
    onError: (error, target) => {
      if (error instanceof ApiError && error.status === 409) setRefused((r) => ({ ...r, [keyOf(target)]: error.message }));
      else toast.error("Regeneration did not happen", { description: error.message });
    },
    onSettled: (_data, _error, target) =>
      setRunning((s) => {
        const next = new Set(s);
        next.delete(keyOf(target));
        return next;
      }),
  });

  const regenerate = useCallback((target: RegenerateTarget, { onSuccess }: { onSuccess?: () => void } = {}) => mutation.mutate(target, { onSuccess }), [mutation]);
  const isRunning = useCallback((target: RegenerateTarget) => running.has(keyOf(target)), [running]);
  const refusal = useCallback((target: RegenerateTarget) => refused[keyOf(target)] ?? null, [refused]);

  return { regenerate, isRunning, refusal };
}
