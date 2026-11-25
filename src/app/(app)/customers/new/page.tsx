import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { isManager } from "@/server/domain/customers";
import { listAssignableOwners } from "@/server/services/customers";
import { createCustomerAction } from "@/server/actions/customers";
import { PageHeader } from "@/components/page-header";
import { CustomerForm } from "../customer-form";

export default async function NewCustomerPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const manager = isManager({ id: user.id, roles: user.roles });
  const owners = manager ? (await listAssignableOwners()).map((o) => ({ id: o.id, name: o.name })) : undefined;
  const ownerMode = manager ? "pick" : user.roles.includes("sales") ? "self" : "none";

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("customers.new")} backHref="/customers" backLabel={t("customers.title")} />
      <CustomerForm action={createCustomerAction} owners={owners} ownerMode={ownerMode} />
    </div>
  );
}
