"use client";

import { useTranslations } from "next-intl";
import { LogOutIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { hardNavigate } from "@/lib/hard-navigate";

export function SignOutButton(props: Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const t = useTranslations("common");
  return (
    <Button
      {...props}
      onClick={async () => {
        await authClient.signOut();
        hardNavigate("/login");
      }}
    >
      <LogOutIcon />
      {t("logout")}
    </Button>
  );
}
