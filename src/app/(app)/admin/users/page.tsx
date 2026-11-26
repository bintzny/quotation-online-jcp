import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { parseRoles } from "@/server/domain/roles";
import { isLocked } from "@/server/domain/lockout";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("users.title") };
}

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireRole(["admin"]);
  const t = await getTranslations();
  const { created } = await searchParams;
  const now = new Date();
  const users = await prisma.user.findMany({
    orderBy: [{ banned: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, banned: true, twoFactorEnabled: true,
      employeeCode: true, mustChangePassword: true, failedLoginCount: true, lockedUntil: true,
      company: { select: { code: true } },
    },
  });

  return (
    <div>
      {created && <FlashToast message={t("users.created")} />}
      <PageHeader
        title={t("users.title")}
        actions={
          <Link href="/admin/users/new" className={buttonVariants()}>
            <PlusIcon />
            {t("users.new")}
          </Link>
        }
      />
      {users.length === 0 ? (
        <EmptyState>{t("users.noUsers")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("users.email")}</TableHead>
                <TableHead>{t("users.roles")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("users.mainCompany")}</TableHead>
                <TableHead>{t("users.status")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("users.twoFactor")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.banned ? "opacity-60" : undefined}>
                  <TableCell>
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                      {u.name}
                    </Link>
                    {u.employeeCode && <div className="text-xs text-muted-foreground">{u.employeeCode}</div>}
                    <div className="text-xs text-muted-foreground md:hidden">{u.email}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {parseRoles(u.role).map((r) => (
                        <Badge key={r} variant={r === "sales" ? "secondary" : "default"}>{t(`roles.${r}`)}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{u.company?.code ?? t("common.none")}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.banned ? (
                        <Badge variant="outline">{t("users.deactivated")}</Badge>
                      ) : isLocked({ failedLoginCount: u.failedLoginCount, lockedUntil: u.lockedUntil }, now) ? (
                        <Badge variant="destructive">{t("users.locked")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("common.active")}</Badge>
                      )}
                      {!u.banned && u.mustChangePassword && <Badge variant="outline">{t("users.mustChange")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {u.twoFactorEnabled ? t("users.twoFactorOn") : t("users.twoFactorOff")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
