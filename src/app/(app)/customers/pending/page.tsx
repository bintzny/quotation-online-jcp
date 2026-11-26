import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { listAssignableOwners } from "@/server/services/customers";
import { PageHeader } from "@/components/page-header";
import { OwnerForm } from "../[id]/owner-form";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/lib/page-param";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("customers.pendingTitle") };
}

const PER_PAGE = 50;

export default async function PendingOwnersPage({ searchParams }: PageProps<"/customers/pending">) {
  await requireRole(["executive", "admin"]);
  const t = await getTranslations();
  const page = parsePage((await searchParams).page);
  const [total, customers, owners] = await Promise.all([
    prisma.customer.count({ where: { status: "PENDING_OWNER" } }),
    prisma.customer.findMany({
      where: { status: "PENDING_OWNER" },
      orderBy: { name: "asc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, name: true, taxId: true, branchCode: true, ownerId: true,
        ownerCandidates: { select: { userId: true, user: { select: { name: true } } } },
        expressCodes: { select: { code: true, company: { select: { code: true } } } },
      },
    }),
    listAssignableOwners(),
  ]);
  const ownerOptions = owners.map((o) => ({ id: o.id, name: o.name }));

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("customers.pendingTitle")} />
      <p className="mb-2 text-sm text-muted-foreground">{t("customers.pendingHint")}</p>
      <p className="mb-6 text-xs text-muted-foreground">{t("common.resultCount", { count: total })}</p>
      {customers.length === 0 ? (
        <EmptyState>{t("customers.noPending")}</EmptyState>
      ) : (
        <ul className="grid gap-4">
          {customers.map((c) => (
            <li key={c.id} className="grid gap-3 rounded-xl border p-4 bg-card">
              <div className="grid gap-0.5">
                <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <span className="text-xs text-muted-foreground">
                  {[c.taxId, c.expressCodes.map((x) => `${x.company.code} ${x.code}`).join(", ")].filter(Boolean).join(" · ")}
                </span>
                <span className="text-sm">
                  {t("customers.candidates")}: {c.ownerCandidates.map((x) => x.user.name).join(", ")}
                </span>
              </div>
              <OwnerForm
                customerId={c.id}
                owners={ownerOptions}
                currentOwnerId={c.ownerId}
                pending
                candidateIds={c.ownerCandidates.map((x) => x.userId)}
              />
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PER_PAGE))} basePath="/customers/pending" params={{}} />
    </div>
  );
}
