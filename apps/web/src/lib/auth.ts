"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isUnauthenticated } from "./api";

export interface User {
  id: string;
  email: string;
}

export interface Credentials {
  email: string;
  password: string;
}

const ME = ["me"] as const;

/** The signed-in user, or null. "Not signed in" is an answer here, not an error. */
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async ({ signal }) => {
      try {
        return (await api<{ user: User }>("/auth/me", { signal })).user;
      } catch (error) {
        if (isUnauthenticated(error)) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useSignIn(mode: "login" | "register") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) => api<{ user: User }>(`/auth/${mode}`, { method: "POST", body: credentials }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME, user),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    // Whatever one account loaded must not be shown to the next person at this browser.
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME, null);
    },
  });
}

/** Only ever send people to a path inside this app, never to a URL someone put in ?next=. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/kits";
}
