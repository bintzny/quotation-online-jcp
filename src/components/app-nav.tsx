"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { MenuIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type NavItem = { href: string; label: string; exact?: boolean };

function matches(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Only the most specific matching item is active (/customers/pending is not also /customers). */
function activeHref(pathname: string, items: NavItem[]) {
  return items.filter((i) => matches(pathname, i)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** Horizontal links from the lg breakpoint up. */
export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname, items);
  return (
    <nav className="hidden min-w-0 items-center gap-1 lg:flex">
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Menu button + side sheet below the lg breakpoint. */
export function MobileNav({ items }: { items: NavItem[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const current = activeHref(pathname, items);
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className={buttonVariants({ variant: "ghost", size: "icon", className: "size-10 lg:hidden" })} aria-label={t("menu")}>
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>{t("menu")}</SheetTitle>
        </SheetHeader>
        <nav className="grid gap-1 px-4">
          {items.map((item) => {
            const active = item.href === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-3 text-base transition-colors",
                  active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
