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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDays: number;
  /** Whether the user has arranged days by hand, which a re-plan discards. */
  arrangedByHand: boolean;
  pending: boolean;
  onConfirm: (days: number) => void;
}

/**
 * Re-planning is the one edit that discards the user's own work on the schedule, so it is
 * asked for explicitly and says so. No model is involved: allocation is arithmetic.
 */
export function ReplanDialog({ open, onOpenChange, currentDays, arrangedByHand, pending, onConfirm }: Props) {
  const [days, setDays] = useState(currentDays);
  const valid = Number.isInteger(days) && days >= 1 && days <= 365;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-plan the schedule</AlertDialogTitle>
          <AlertDialogDescription>
            The same questions are spread over the number of days you choose, hardest and most important first.
            {arrangedByHand && <strong className="block pt-2 text-foreground">You have arranged days by hand. Re-planning replaces that arrangement.</strong>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="replan-days">Days until the interview</Label>
          <Input id="replan-days" type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-invalid={!valid} className="w-32" autoFocus />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button onClick={() => valid && onConfirm(days)} disabled={pending || !valid}>
            {pending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {arrangedByHand ? "Replace my arrangement" : "Re-plan"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
