"use client";

import { LoaderCircle } from "lucide-react";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  /**
   * Where focus goes when the dialog closes, as a selector list; the first match wins. Radix
   * puts it back on the element that had it before, which is right unless confirming removed
   * that element (Start over disappears once there is nothing to start over).
   */
  focusOnClose?: string;
  onConfirm: () => void;
}

/** A yes/no for something that cannot be undone. Focus starts on the safe choice; Escape cancels. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel = "Keep it", pending = false, error, focusOnClose, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!focusOnClose) return;
          event.preventDefault();
          document.querySelector<HTMLElement>(focusOnClose)?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
