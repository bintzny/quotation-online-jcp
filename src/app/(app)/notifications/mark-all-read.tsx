"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheckIcon } from "lucide-react";
import { markAllNotificationsReadAction } from "@/server/actions/approvals";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => { await markAllNotificationsReadAction(); router.refresh(); })}>
      <CheckCheckIcon />
      {t("markAllRead")}
    </Button>
  );
}
