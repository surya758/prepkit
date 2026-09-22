"use client";

import type { Kit, KitMeta } from "@prepkit/core";
import { Check, TriangleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefSection } from "./brief-section";
import { QuestionsSection } from "./questions-section";
import { RoleSection } from "./role-section";

const SECTIONS = [
  { id: "brief", label: "Brief" },
  { id: "role", label: "Role" },
  { id: "questions", label: "Questions" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function KitView({ kitId, kit, meta }: { kitId: string; kit: Kit; meta: KitMeta | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The open section lives in the address, so a reload, the Back button and a shared link all keep it.
  const requested = params.get("tab");
  const section: SectionId = SECTIONS.some((s) => s.id === requested) ? (requested as SectionId) : "brief";

  const total = kit.role.requirements.length;
  const uncovered = kit.coverage.uncovered_requirement_ids.length;

  return (
    <div className="flex flex-col gap-6">
      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${uncovered === 0 ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}>
            {uncovered === 0 ? <Check className="size-4" aria-hidden="true" /> : <TriangleAlert className="size-4" aria-hidden="true" />}
            {total - uncovered} of {total} requirements covered
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
            {kit.coverage.passes} coverage {kit.coverage.passes === 1 ? "pass" : "passes"}
          </span>
        </div>
      )}

      <Tabs value={section} onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}>
        <TabsList>
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="brief" className="pt-4">
          <BriefSection kit={kit} />
        </TabsContent>
        <TabsContent value="role" className="pt-4">
          <RoleSection kit={kit} />
        </TabsContent>
        <TabsContent value="questions" className="pt-4">
          <QuestionsSection kitId={kitId} kit={kit} meta={meta} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
