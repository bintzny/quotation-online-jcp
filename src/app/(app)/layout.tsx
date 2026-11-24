import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { AppNav, MobileNav, type NavItem } from "@/components/app-nav";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const isAdmin = user.roles.includes("admin");

  const items: NavItem[] = [{ href: "/", label: t("nav.home"), exact: true }];
  if (isAdmin) {
    items.push({ href: "/admin/users", label: t("nav.users") });
    items.push({ href: "/admin/companies", label: t("nav.companies") });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <MobileNav items={items} />
          <Link href="/" className="min-w-0 truncate font-semibold tracking-tight">
            {t("common.appName")}
          </Link>
          <AppNav items={items} />
          <div className="ml-auto">
            <UserMenu name={user.name} email={user.email} roles={user.roles.map((r) => t(`roles.${r}`))} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
