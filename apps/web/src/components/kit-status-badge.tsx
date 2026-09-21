import { LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { KitStatus } from "@/lib/kits";

const LOOK: Record<KitStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-muted-foreground" },
  running: { label: "Generating", className: "bg-accent text-accent-foreground" },
  ready: { label: "Ready", className: "bg-success text-success-foreground" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
};

// The word carries the meaning; colour and the spinner only reinforce it.
export function KitStatusBadge({ status }: { status: KitStatus }) {
  const { label, className } = LOOK[status];
  return (
    <Badge variant="secondary" className={`border-transparent ${className}`}>
      {status === "running" && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {label}
    </Badge>
  );
}
