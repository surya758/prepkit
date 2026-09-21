import type { Metadata } from "next";
import Link from "next/link";
import { CreateKitForm } from "@/components/create-kit-form";
import { UploadCases } from "@/components/upload-cases";

export const metadata: Metadata = { title: "New kit" };

export default function NewKitPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-col gap-2">
        <Link href="/kits" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Your kits
        </Link>
        <h1 className="font-display text-4xl">New kit</h1>
        <p className="text-muted-foreground">Paste the job description. The kit is built from it and from what the company says about itself.</p>
      </div>
      <CreateKitForm />

      <section aria-labelledby="upload-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="upload-heading" className="font-display text-2xl">
          Or upload several roles
        </h2>
        <UploadCases />
      </section>
    </main>
  );
}
