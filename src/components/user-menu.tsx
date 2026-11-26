"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserIcon, LogOutIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { hardNavigate } from "@/lib/hard-navigate";

export function UserMenu({ name, email, roles }: { name: string; email: string; roles: string[] }) {
  const t = useTranslations("common");
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: "ghost", size: "default", className: "h-11 gap-2.5 px-1.5 md:h-11 sm:pr-3" })}
        aria-label={t("profile")}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground ring-1 ring-primary/15">
          {initial}
        </span>
        <span className="hidden min-w-0 text-left leading-tight sm:grid">
          <span className="max-w-44 truncate text-sm font-medium">{name}</span>
          <span className="max-w-44 truncate text-xs font-normal text-muted-foreground">{roles.join(", ")}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="grid gap-0.5">
              <span className="truncate font-medium text-foreground">{name}</span>
              <span className="truncate text-xs font-normal">{email}</span>
              <span className="text-xs font-normal">{roles.join(", ")}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />}>
          <UserIcon />
          {t("profile")}
        </DropdownMenuItem>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <span className="text-muted-foreground">{t("language")}</span>
          <LocaleSwitcher />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            hardNavigate("/login");
          }}
        >
          <LogOutIcon />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
