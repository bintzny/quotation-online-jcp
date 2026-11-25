import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { parseRoles } from "@/server/domain/roles";
import { isLocked } from "@/server/domain/lockout";
import { updateUserAction } from "@/server/actions/users";
import { PageHeader } from "@/components/page-header";
import { UserForm } from "../user-form";
import { UserAccountActions } from "./account-actions";
import { TransferAll } from "./transfer-all";
import { listAssignableOwners } from "@/server/services/customers";
import { OPEN_QUOTATION_STATUSES } from "@/server/domain/dormant";

export default async function EditUserPage({ params }: PageProps<"/admin/users/[id]">) {
  const admin = await requireRole(["admin"]);
  const { id } = await params;
  const t = await getTranslations();
  const [user, companies] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: { extraCompanies: { select: { companyId: true } } },
    }),
    prisma.company.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, nameTh: true } }),
  ]);
  if (!user) notFound();
  const [customerCount, openQuotations, owners] = await Promise.all([
    prisma.customer.count({ where: { ownerId: user.id } }),
    prisma.quotation.count({ where: { ownerId: user.id, status: { in: [...OPEN_QUOTATION_STATUSES] } } }),
    listAssignableOwners(),
  ]);

  const locked = isLocked({ failedLoginCount: user.failedLoginCount, lockedUntil: user.lockedUntil }, new Date());

  return (
    <div className="grid max-w-3xl gap-8">
      <PageHeader title={t("users.editTitle")} backHref="/admin/users" backLabel={t("users.title")} />
      <UserForm
        action={updateUserAction.bind(null, user.id)}
        companies={companies}
        initial={{
          name: user.name,
          email: user.email,
          phone: user.phone ?? "",
          employeeCode: user.employeeCode ?? "",
          roles: parseRoles(user.role),
          companyId: user.companyId ?? "",
          extraCompanyIds: user.extraCompanies.map((c) => c.companyId),
        }}
      />
      {user.id !== admin.id && (
        <UserAccountActions userId={user.id} banned={!!user.banned} locked={locked} isSelf={false} />
      )}
      {(customerCount > 0 || openQuotations > 0) && (
        <TransferAll userId={user.id} customers={customerCount} openQuotations={openQuotations} owners={owners.map((o) => ({ id: o.id, name: o.name }))} />
      )}
    </div>
  );
}
