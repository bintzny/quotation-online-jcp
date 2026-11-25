"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** A button that asks once more before an action that is hard to undo (e.g. moving customers). */
export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "default",
  className,
}: {
  label: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "default" | "outline";
  className?: string;
}) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{tc("close")}</DialogClose>
            <Button type="button" onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
