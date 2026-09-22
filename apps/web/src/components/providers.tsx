"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useState } from "react";
import { ApiError, isUnauthenticated } from "@/lib/api";

export function createQueryClient(): QueryClient {
  // A session can end at any moment: it expires, or the user signs out in another tab. Whichever
  // request discovers that marks the user as signed out, and the signed-in layout — the one
  // place that decides where people are sent — takes them to the sign-in page.
  const onError = (error: unknown) => {
    if (isUnauthenticated(error)) client.setQueryData(["me"], null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // Asking again does not fix a request the server understood and refused.
        retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
  return client;
}

const loadMotionFeatures = () => import("@/lib/motion-features").then((module) => module.default);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {/* reducedMotion="user": for anyone who has asked their system for less motion, movement
            is dropped everywhere at once and only fades remain — no component has to remember.
            strict: only the slim `m` components are allowed, so the full library cannot slip in. */}
        <MotionConfig reducedMotion="user">
          <LazyMotion features={loadMotionFeatures} strict>
            {children}
            <Toaster position="bottom-center" />
          </LazyMotion>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
