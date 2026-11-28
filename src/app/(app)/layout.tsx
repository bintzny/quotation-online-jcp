import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BellIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { unreadCount } from "@/server/notifications";
import { pendingApprovalCount } from "@/server/services/approvals";
import { pendingTransferCount } from "@/server/services/transfers";
import { AppSidebar, MobileNav, type NavGroup, type NavItem } from "@/components/app-nav";
import { BrandMark } from "@/components/brand-mark";
import { UserMenu } from "@/components/user-menu";
import { buttonVariants } from "@/components/ui/button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const isAdmin = user.roles.includes("admin");
  const isExecutive = user.roles.includes("executive");
  const isManager = isAdmin || isExecutive;
  const isSales = user.roles.includes("sales");
  const seesQuotations = isSales || isExecutive;
  const [unread, pendingApprovals, pendingTransfers] = await Promise.all([
    unreadCount(user.id),
    isExecutive ? pendingApprovalCount() : Promise.resolve(0),
    isManager ? pendingTransferCount() : Promise.resolve(0),
  ]);
  const pending = (count: number) => (count > 0 ? t("nav.pendingCount", { count }) : undefined);

  const overview: NavItem[] = [
    { href: "/", label: t("nav.home"), icon: "home", exact: true },
    ...(seesQuotations ? [{ href: "/dashboard", label: t("nav.dashboard"), icon: "dashboard" } as NavItem] : []),
  ];
  const sales: NavItem[] = [
    ...(seesQuotations ? [{ href: "/quotations", label: t("nav.quotations"), icon: "quotations" } as NavItem] : []),
    ...(isExecutive
      ? [{ href: "/approvals", label: t("nav.approvals"), icon: "approvals", badge: pendingApprovals, badgeLabel: pending(pendingApprovals) } as NavItem]
      : []),
    ...(seesQuotations ? [{ href: "/reports", label: t("nav.reports"), icon: "reports" } as NavItem] : []),
  ];
  const customers: NavItem[] = [
    { href: "/customers", label: t("nav.customers"), icon: "customers" },
    { href: "/products", label: t("nav.products"), icon: "products" },
  ];
  if (isManager) customers.push({ href: "/customers/pending", label: t("nav.pendingOwners"), icon: "pendingOwners" });
  if (isManager || seesQuotations) {
    customers.push({
      href: "/customers/dormant",
      label: t("nav.dormant"),
      icon: "dormant",
      ...(isManager ? { badge: pendingTransfers, badgeLabel: pending(pendingTransfers) } : {}),
    });
  }
  const manage: NavItem[] = [];
  if (isManager) manage.push({ href: "/audit", label: t("nav.audit"), icon: "audit" });
  if (isAdmin) {
    manage.push({ href: "/admin/import", label: t("nav.imports"), icon: "imports" });
    manage.push({ href: "/admin/users", label: t("nav.users"), icon: "users" });
    manage.push({ href: "/admin/companies", label: t("nav.companies"), icon: "companies" });
    manage.push({ href: "/admin/settings", label: t("nav.settings"), icon: "settings" });
  }

  const groups: NavGroup[] = [
    { items: overview },
    ...(sales.length ? [{ label: t("nav.groupSales"), items: sales }] : []),
    { label: t("nav.groupCustomers"), items: customers },
    ...(manage.length ? [{ label: isAdmin ? t("nav.groupSystem") : t("nav.groupManage"), items: manage }] : []),
  ];
  const brand = { appName: t("common.appName"), tagline: t("common.brandTagline") };

  return (
    <div className="min-h-dvh">
      <AppSidebar groups={groups} brand={brand} />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur supports-backdrop-filter:bg-card/80">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6 lg:h-16 lg:px-8">
            <MobileNav groups={groups} brand={brand} />
            <Link href="/" className="flex min-w-0 items-center gap-2 lg:hidden" aria-label={t("common.appName")}>
              <BrandMark className="size-8 rounded-md [&>span]:text-xs" />
              <span className="truncate text-sm font-semibold">{t("common.appName")}</span>
            </Link>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <Link
                href="/notifications"
                className={buttonVariants({ variant: "ghost", size: "icon", className: "relative size-10 text-muted-foreground hover:text-foreground" })}
                aria-label={unread > 0 ? t("notifications.bellUnread", { count: unread }) : t("notifications.title")}
              >
                <BellIcon className="size-5" />
                {unread > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-card">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
              <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
              <UserMenu name={user.name} email={user.email} roles={user.roles.map((r) => t(`roles.${r}`))} />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
