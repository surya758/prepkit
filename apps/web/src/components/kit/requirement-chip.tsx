"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NumberedRequirement } from "@/lib/requirements";

interface Props {
  /** The requirement's id in the kit; shown only if the kit no longer has it. */
  id: string;
  requirement: NumberedRequirement | undefined;
  /** Given, the chip is a toggle: pressed means the item covers this requirement. */
  pressed?: boolean;
  onToggle?: () => void;
}

/**
 * A requirement named by its number on the Role tab, the whole of it in a tooltip (on hover, and
 * on focus for the keyboard). On a card it is a label; in an editor it is a toggle.
 */
export function RequirementChip({ id, requirement, pressed, onToggle }: Props) {
  const label = requirement ? String(requirement.number) : id;
  const text = requirement?.text ?? "A requirement this kit no longer has";
  const className = `inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-xs ${pressed ? "border-primary bg-accent text-accent-foreground" : "text-muted-foreground"}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onToggle ? (
          <button type="button" aria-pressed={pressed} aria-label={`Requirement ${label}: ${text}`} onClick={onToggle} className={className}>
            {label}
          </button>
        ) : (
          <span tabIndex={0} aria-label={`Requirement ${label}: ${text}`} className={className}>
            {label}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
