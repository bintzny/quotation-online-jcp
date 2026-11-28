"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2Icon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HistoryIcon,
  HouseIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PackageIcon,
  SettingsIcon,
  UploadIcon,
  UserRoundSearchIcon,
  UsersIcon,
  UserXIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BrandLockup } from "@/components/brand-mark";

/** Icons are referenced by name because components cannot be passed from the server layout. */
const ICONS = {
  home: HouseIcon,
  dashboard: LayoutDashboardIcon,
  quotations: FileTextIcon,
  approvals: ClipboardCheckIcon,
  reports: ChartColumnIcon,
  customers: Building2Icon,
  products: PackageIcon,
  pendingOwners: UserRoundSearchIcon,
  dormant: UserXIcon,
  audit: HistoryIcon,
  imports: UploadIcon,
  users: UsersIcon,
  companies: LandmarkIcon,
  settings: SettingsIcon,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; exact?: boolean; badge?: number; badgeLabel?: string };
export type NavGroup = { label?: string; items: NavItem[] };
export type NavBrand = { appName: string; tagline: string };

function matches(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Only the most specific matching item is active (/customers/pending is not also /customers). */
function activeHref(pathname: string, groups: NavGroup[]) {
  return groups
    .flatMap((g) => g.items)
    .filter((i) => matches(pathname, i))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  return (
    <div className="grid gap-5">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className="grid gap-0.5">
          {group.label && (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{group.label}</p>
          )}
          {group.items.map((item) => {
            const active = item.href === current;
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-sidebar-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className={cn("size-[18px] shrink-0", active ? "text-sidebar-primary" : "text-sidebar-muted group-hover:text-white")} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[11px] font-semibold text-sidebar-primary-foreground tabular-nums"
                    aria-label={item.badgeLabel}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SidebarBody({ groups, brand, onNavigate }: { groups: NavGroup[]; brand: NavBrand; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link href="/" onClick={onNavigate} className="flex h-16 shrink-0 items-center px-4 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset">
        <BrandLockup appName={brand.appName} tagline={brand.tagline} inverted />
      </Link>
      <nav aria-label={t("mainNav")} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
        <NavList groups={groups} onNavigate={onNavigate} />
      </nav>
    </div>
  );
}

/** Fixed sidebar from the lg breakpoint up. */
export function AppSidebar({ groups, brand }: { groups: NavGroup[]; brand: NavBrand }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border lg:block">
      <SidebarBody groups={groups} brand={brand} />
    </aside>
  );
}

/** Menu button + slide-in sidebar below the lg breakpoint. */
export function MobileNav({ groups, brand }: { groups: NavGroup[]; brand: NavBrand }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className={buttonVariants({ variant: "ghost", size: "icon", className: "-ml-2 lg:hidden" })} aria-label={t("menu")}>
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground">
        <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
        <SidebarBody groups={groups} brand={brand} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
