import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  // The form reads ?next= from the address, which Next.js asks to have inside a Suspense boundary.
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
