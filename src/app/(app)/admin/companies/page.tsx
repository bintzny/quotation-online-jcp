import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/session";
import { PageHeader } from "@/components/page-header";
import { FlashToast } from "@/components/flash-toast";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("companies.title") };
}

export default async function CompaniesPage({ searchParams }: PageProps<"/admin/companies">) {
  await requireRole(["admin"]);
  const t = await getTranslations();
  const { created } = await searchParams;
  const companies = await prisma.company.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { users: true } } },
  });

  return (
    <div>
      {created && <FlashToast message={t("companies.created")} />}
      <PageHeader
        title={t("companies.title")}
        actions={
          <Link href="/admin/companies/new" className={buttonVariants()}>
            <PlusIcon />
            {t("companies.new")}
          </Link>
        }
      />
      {companies.length === 0 ? (
        <EmptyState>{t("companies.noCompanies")}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("companies.code")}</TableHead>
                <TableHead>{t("companies.nameTh")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("companies.taxId")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("companies.senderEmail")}</TableHead>
                <TableHead>{t("users.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>
                    <Link href={`/admin/companies/${c.id}`} className="font-medium hover:underline">{c.nameTh}</Link>
                    {c.nameEn && <div className="text-xs text-muted-foreground">{c.nameEn}</div>}
                  </TableCell>
                  <TableCell className="hidden font-mono md:table-cell">{c.taxId}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.senderEmail ?? t("common.none")}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? "secondary" : "outline"}>
                      {c.active ? t("common.active") : t("common.inactive")}
                    </Badge>
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
