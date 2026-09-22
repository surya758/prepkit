"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDays: number;
  /** Whether the user has arranged days by hand, which a re-plan discards. */
  arrangedByHand: boolean;
  pending: boolean;
  /** How many cards have been practised: with none, there is nothing to lean on and the option is not offered. */
  practised: number;
  onConfirm: (days: number, adaptive: boolean) => void;
}

/**
 * Re-planning is the one edit that discards the user's own work on the schedule, so it is
 * asked for explicitly and says so. No model is involved: allocation is arithmetic.
 */
export function ReplanDialog({
  open,
  onOpenChange,
  currentDays,
  arrangedByHand,
  pending,
  practised,
  onConfirm,
}: Props) {
  const [days, setDays] = useState(currentDays);
  // On by default once there is practice to lean on: a plan made before practising is the stale one.
  const [adaptive, setAdaptive] = useState(practised > 0);
  const valid = Number.isInteger(days) && days >= 1 && days <= 365;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-plan the schedule</AlertDialogTitle>
          <AlertDialogDescription>
            The same questions are spread over the number of days you choose,
            hardest and most important first.
            {arrangedByHand && (
              <strong className="block pt-2 text-foreground">
                You have arranged days by hand. Re-planning replaces that
                arrangement.
              </strong>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replan-days">Days until the interview</Label>
            <Input
              id="replan-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-invalid={!valid}
              className="w-32"
              autoFocus
            />
          </div>
          {practised > 0 ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={adaptive}
                onCheckedChange={(checked) => setAdaptive(checked === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">
                  Lean toward what I found hard in practice
                </span>
                <span className="text-muted-foreground">
                  Questions on the requirements you rated lowest come earlier
                  and get fuller days. Ones you found easy keep their usual
                  weight. From your {practised} rated{" "}
                  {practised === 1 ? "card" : "cards"}.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              Once you have practised some cards, a re-plan can lean toward what
              you found hard.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            onClick={() => valid && onConfirm(days, adaptive && practised > 0)}
            disabled={pending || !valid}
          >
            {pending && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {arrangedByHand ? "Replace my arrangement" : "Re-plan"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
