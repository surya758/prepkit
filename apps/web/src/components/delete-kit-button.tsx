"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteKit } from "@/lib/kits";

interface Props {
  kitId: string;
  title: string;
  /** True from the moment the delete is sent; back to false only if it fails. */
  onDeleting: (deleting: boolean) => void;
}

export function DeleteKitButton({ kitId, title, onDeleting }: Props) {
  const router = useRouter();
  const remove = useDeleteKit(kitId, { onDeleted: () => router.replace("/kits"), onFailed: () => onDeleting(false) });
  // Controlled, so the dialog stays open while the delete is on its way and can show a failure.
  const [open, setOpen] = useState(false);

  function confirm() {
    onDeleting(true);
    remove.mutate();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (remove.isPending) return;
        if (next) remove.reset();
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this kit?</AlertDialogTitle>
          <AlertDialogDescription>
            “{title}”, everything you edited in it and your practice progress will be deleted. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.error && (
          <p role="alert" className="text-sm text-destructive">
            {remove.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Delete kit
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
