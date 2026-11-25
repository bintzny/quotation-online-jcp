import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BellIcon } from "lucide-react";
import { requireUser } from "@/server/session";
import { unreadCount } from "@/server/notifications";
import { pendingApprovalCount } from "@/server/services/approvals";
import { pendingTransferCount } from "@/server/services/transfers";
import { AppNav, MobileNav, type NavItem } from "@/components/app-nav";
import { UserMenu } from "@/components/user-menu";
import { buttonVariants } from "@/components/ui/button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const isAdmin = user.roles.includes("admin");
  const isExecutive = user.roles.includes("executive");
  const isManager = isAdmin || isExecutive;
  const seesQuotations = user.roles.includes("sales") || isExecutive;
  const [unread, pendingApprovals, pendingTransfers] = await Promise.all([
    unreadCount(user.id),
    isExecutive ? pendingApprovalCount() : Promise.resolve(0),
    isManager ? pendingTransferCount() : Promise.resolve(0),
  ]);

  const items: NavItem[] = [
    { href: "/", label: t("nav.home"), exact: true },
    ...(isExecutive ? [{ href: "/approvals", label: pendingApprovals > 0 ? t("nav.approvalsCount", { count: pendingApprovals }) : t("nav.approvals") }] : []),
    ...(seesQuotations ? [{ href: "/quotations", label: t("nav.quotations") }] : []),
    { href: "/customers", label: t("nav.customers"), exact: false },
    { href: "/products", label: t("nav.products") },
  ];
  if (isManager) {
    items.push({ href: "/customers/pending", label: t("nav.pendingOwners") });
    items.push({ href: "/customers/dormant", label: pendingTransfers > 0 ? t("nav.dormantRequests", { count: pendingTransfers }) : t("nav.dormant") });
  } else if (seesQuotations) {
    items.push({ href: "/customers/dormant", label: t("nav.dormant") });
  }
  if (isAdmin) {
    items.push({ href: "/admin/import", label: t("nav.imports") });
    items.push({ href: "/admin/users", label: t("nav.users") });
    items.push({ href: "/admin/companies", label: t("nav.companies") });
    items.push({ href: "/admin/settings", label: t("nav.settings") });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 lg:gap-4">
          <MobileNav items={items} />
          <Link href="/" className="min-w-0 truncate font-semibold tracking-tight">
            {t("common.appName")}
          </Link>
          <AppNav items={items} />
          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/notifications"
              className={buttonVariants({ variant: "ghost", size: "icon", className: "relative size-10" })}
              aria-label={unread > 0 ? t("notifications.bellUnread", { count: unread }) : t("notifications.title")}
            >
              <BellIcon className="size-5" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <UserMenu name={user.name} email={user.email} roles={user.roles.map((r) => t(`roles.${r}`))} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
