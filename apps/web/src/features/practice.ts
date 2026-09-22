"use client";

import type { Confidence, PracticeProgress } from "@prepkit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface PracticeView {
  progress: PracticeProgress;
  order: string[];
}

const key = (kitId: string) => ["practice", kitId] as const;

export function usePracticeView(kitId: string) {
  return useQuery({
    queryKey: key(kitId),
    queryFn: async ({ signal }) => (await api<{ practice: PracticeView }>(`/kits/${kitId}/practice`, { signal })).practice,
  });
}

/** Ratings are not predicted: what a rating does to progress is the server's rule, and its answer is the truth. */
export function useRateCard(kitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, confidence }: { cardId: string; confidence: Confidence }) =>
      api<{ practice: PracticeView }>(`/kits/${kitId}/practice/${cardId}`, { method: "PUT", body: { confidence } }),
    onSuccess: ({ practice }) => queryClient.setQueryData(key(kitId), practice),
    onError: (error) => toast.error("Your rating was not saved", { description: error.message }),
  });
}

export function useResetPractice(kitId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ practice: PracticeView }>(`/kits/${kitId}/practice`, { method: "DELETE" }),
    onSuccess: ({ practice }) => queryClient.setQueryData(key(kitId), practice),
    onError: (error) => toast.error("Practice could not be reset", { description: error.message }),
  });
}
