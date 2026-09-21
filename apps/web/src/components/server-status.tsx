"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PATIENCE_MS = 1_500;

/**
 * Free hosting puts the API to sleep when nobody is using it, and the first request can take
 * most of a minute. Without this, that minute looks like a broken sign-in button. The page asks
 * for /api/health as soon as it opens — which is also what wakes the server — and says what is
 * happening if the answer is slow.
 */
export function ServerStatus() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api<{ status: string }>("/health", { signal }),
    retry: true,
    retryDelay: 3_000,
    staleTime: Infinity,
  });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (health.isSuccess) return;
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [health.isSuccess]);

  if (health.isSuccess || !slow) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-warning-foreground">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Waking the server. It sleeps when idle, and this can take up to a minute.
    </div>
  );
}
