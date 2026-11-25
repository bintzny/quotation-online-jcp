"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcwIcon } from "lucide-react";
import { reactivateCustomerAction } from "@/server/actions/followups";
import { Button } from "@/components/ui/button";
import { FormStatus } from "@/components/form-status";

/** A lost customer buying again: back to normal (its owner only). */
export function ReactivateButton({ customerId }: { customerId: string }) {
  const t = useTranslations("dormant");
  const tc = useTranslations("common");
  const [state, action, pending] = useActionState(reactivateCustomerAction.bind(null, customerId), undefined);
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" variant="outline" className="w-full sm:w-fit" disabled={pending}>
        <RotateCcwIcon />
        {pending ? tc("loading") : t("reactivate")}
      </Button>
      <FormStatus state={state} />
    </form>
  );
}
