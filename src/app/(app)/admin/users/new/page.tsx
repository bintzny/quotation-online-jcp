import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { createUserAction } from "@/server/actions/users";
import { PageHeader } from "@/components/page-header";
import { UserForm } from "../user-form";

export default async function NewUserPage() {
  await requireRole(["admin"]);
  const t = await getTranslations();
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, nameTh: true },
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("users.new")} backHref="/admin/users" backLabel={t("users.title")} />
      <UserForm action={createUserAction} companies={companies} withPassword />
    </div>
  );
}
