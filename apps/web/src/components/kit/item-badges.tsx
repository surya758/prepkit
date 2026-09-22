import type { ItemMeta } from "@prepkit/core";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { badgesFor } from "@/lib/item-meta";
import type { Badge as BadgeKind } from "@/lib/item-meta";

const LOOK: Record<BadgeKind, { label: string; className: string; title: string }> = {
  generated: { label: "Generated", className: "bg-muted text-muted-foreground", title: "Written by the model. Regenerating may replace it." },
  edited: { label: "Edited", className: "bg-accent text-accent-foreground", title: "You changed this. Regenerating keeps it." },
  yours: { label: "Yours", className: "bg-primary/15 text-primary", title: "You wrote this. Regenerating keeps it." },
  pinned: { label: "Pinned", className: "bg-warning text-warning-foreground", title: "Pinned. Regenerating keeps it." },
};

export function ItemBadges({ item }: { item: ItemMeta }) {
  return (
    <>
      {badgesFor(item).map((kind) => (
        <Badge key={kind} variant="secondary" title={LOOK[kind].title} className={`border-transparent ${LOOK[kind].className}`}>
          {kind === "pinned" && <Pin aria-hidden="true" />}
          {LOOK[kind].label}
        </Badge>
      ))}
    </>
  );
}
