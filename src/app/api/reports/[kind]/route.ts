import { getFormatter, getTranslations } from "next-intl/server";
import { prisma } from "@/server/db";
import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { buildExport, xlsxHeaders, type ExportSheet } from "@/server/excel";
import { bangkokDate, displayNumber } from "@/server/domain/numbering";
import { canManageTransfers } from "@/server/domain/dormant";
import { canCreateQuotation } from "@/server/domain/quotations";
import {
  canSeeSalesNumbers, dayKey, lineValueSatang, MAX_EXPORT_LINES, MAX_EXPORT_ROWS, netUnitPriceBaht, parseReportFilter, seesAllSales, type ReportFilter,
} from "@/server/domain/reports";
import { reportRows, wonLines } from "@/server/services/reports";
import { listDormant } from "@/server/services/dormant";
import { getDormantMonths } from "@/server/settings";

// Excel exports. Every kind goes through the same filter parser as the report page, so a
// salesperson can only ever export their own quotations and customers.

const baht = (satang: number) => satang / 100;
/** A timestamp as its Bangkok calendar date (Excel shows the UTC-midnight date as that day). */
const day = (d: Date | null | undefined) => (d ? bangkokDate(d) : null);

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(req: Request, ctx: RouteContext<"/api/reports/[kind]">) {
  const user = await getCurrentUser();
  if (!user || onboardingRedirect(user)) return notFound();
  const viewer = { id: user.id, roles: user.roles };
  const { kind } = await ctx.params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const t = await getTranslations("reports");
  const tq = await getTranslations("quotations.status");
  const printed = t("export.printedAt", { date: (await getFormatter()).dateTime(new Date(), { dateStyle: "medium", timeStyle: "short" }) });

  if (kind === "quotations" || kind === "won-lines") {
    if (!canSeeSalesNumbers(viewer)) return notFound();
    const f = parseReportFilter(viewer, sp);
    const title = [kind === "quotations" ? t("export.quotationsTitle") : t("export.wonTitle"), await describe(f, viewer, t, kind === "won-lines"), printed];
    if (kind === "quotations") return quotationsExport(f, title, t, tq);
    return wonExport(f, title, t);
  }

  if (kind === "dormant") {
    const manager = canManageTransfers(viewer);
    if (!manager && !canCreateQuotation(viewer)) return notFound();
    const view = sp.view === "lost" ? "lost" : "dormant";
    const ID = /^[A-Za-z0-9_-]{1,64}$/;
    const ownerId = manager ? (sp.owner && ID.test(sp.owner) ? sp.owner : undefined) : user.id;
    const companyId = sp.company && ID.test(sp.company) ? sp.company : undefined;
    const months = await getDormantMonths();
    const rows = await listDormant({ months, scope: view, ownerId, companyId, take: MAX_EXPORT_ROWS + 1 });
    if (rows.length > MAX_EXPORT_ROWS) return tooMany(t);
    // Purchase values come from quotations: not for admin-only users (same rule as the page).
    const showPurchases = !manager || user.roles.includes("executive");
    const td = await getTranslations("dormant");
    const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { code: true } }) : null;
    const owner = ownerId ? await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }) : null;
    const sheet: ExportSheet = {
      name: view === "lost" ? t("export.lostSheet") : t("export.dormantSheet"),
      title: [
        view === "lost" ? t("export.lostTitle") : t("export.dormantTitle", { months }),
        [owner ? t("export.owner", { name: owner.name }) : t("export.allOwners"), company ? t("export.company", { code: company.code }) : t("export.allCompanies")].join(" · "),
        printed,
      ],
      columns: [
        { header: t("col.customer"), key: "name", width: 36 },
        { header: t("col.taxId"), key: "taxId", width: 16 },
        { header: t("col.branch"), key: "branch", width: 9 },
        { header: t("col.owner"), key: "owner", width: 22 },
        { header: t("col.lastPurchase"), key: "lastPurchase", width: 13, type: "date" },
        { header: t("col.daysWithout"), key: "days", width: 10, type: "int" },
        ...(showPurchases ? [{ header: t("col.previousPurchases"), key: "purchases", width: 16, type: "money" as const }] : []),
        { header: t("col.openQuotations"), key: "open", width: 10, type: "int" },
        { header: t("col.lastContact"), key: "lastContact", width: 13, type: "date" },
        { header: t("col.contactedSince"), key: "contacted", width: 12 },
        ...(view === "lost"
          ? [{ header: t("col.lostReason"), key: "lostReason", width: 22 }, { header: t("col.lostNote"), key: "lostNote", width: 30 }, { header: t("col.lostAt"), key: "lostAt", width: 13, type: "date" as const }]
          : [{ header: t("col.snoozedUntil"), key: "snoozed", width: 13, type: "date" as const }]),
      ],
      rows: rows.map((r) => ({
        name: r.name, taxId: r.taxId, branch: r.branchCode, owner: r.ownerName ?? "-",
        lastPurchase: r.lastPurchaseDate, days: r.days, purchases: baht(r.purchasesSatang), open: r.openQuotations,
        lastContact: r.lastContact, contacted: r.contactedSinceInactive ? t("yes") : t("no"),
        lostReason: r.lostReason ? td(`lostReasons.${r.lostReason}`) : null, lostNote: r.lostNote, lostAt: day(r.lostAt), snoozed: r.snoozedUntil,
      })),
    };
    const buf = await buildExport([sheet], { totalLabel: t("export.total") });
    return new Response(new Uint8Array(buf), { headers: xlsxHeaders(`${sheet.name}-${dayKey(bangkokDate(new Date()))}.xlsx`) });
  }

  return notFound();
}

type T = Awaited<ReturnType<typeof getTranslations<"reports">>>;

function tooMany(t: T) {
  return new Response(t("export.tooMany", { max: MAX_EXPORT_ROWS.toLocaleString("en-US") }), {
    status: 413, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** "Period … · salesperson … · company …" for the title rows. */
/** The won-lines export always uses the date won and ignores the status filter, so its title says so. */
async function describe(f: ReportFilter, viewer: { id: string; roles: readonly string[] }, t: T, won: boolean): Promise<string> {
  const [owner, company, customer] = await Promise.all([
    f.ownerId ? prisma.user.findUnique({ where: { id: f.ownerId }, select: { name: true } }) : null,
    f.companyId ? prisma.company.findUnique({ where: { id: f.companyId }, select: { code: true } }) : null,
    f.customerId ? prisma.customer.findUnique({ where: { id: f.customerId }, select: { name: true } }) : null,
  ]);
  const parts = [
    won ? t("export.periodWon", { from: dayKey(f.fromDay), to: dayKey(f.toDay) }) : t("export.period", { basis: t(`basis.${f.basis}`), from: dayKey(f.fromDay), to: dayKey(f.toDay) }),
    owner ? t("export.owner", { name: owner.name }) : seesAllSales(viewer as never) ? t("export.allOwners") : "",
    company ? t("export.company", { code: company.code }) : t("export.allCompanies"),
    customer ? t("export.customer", { name: customer.name }) : "",
    f.customerQuery ? t("export.customerQuery", { q: f.customerQuery }) : "",
    f.status && !won ? t("export.status", { status: (await getTranslations("quotations.status"))(f.status) }) : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

async function quotationsExport(f: ReportFilter, title: string[], t: T, tq: (k: string) => string) {
  const data = await reportRows(f, { take: MAX_EXPORT_ROWS + 1 });
  if (data.rows.length > MAX_EXPORT_ROWS) return tooMany(t);
  const tl = await getTranslations("followups.lostReasons");
  const sheet: ExportSheet = {
    name: t("export.quotationsSheet"),
    title,
    columns: [
      { header: t("col.number"), key: "number", width: 22 },
      { header: t("col.company"), key: "company", width: 8 },
      { header: t("col.status"), key: "status", width: 14 },
      { header: t("col.issueDate"), key: "issueDate", width: 12, type: "date" },
      { header: t("col.firstSent"), key: "firstSent", width: 12, type: "date" },
      { header: t("col.closedOn"), key: "closedOn", width: 12, type: "date" },
      { header: t("col.customer"), key: "customer", width: 34 },
      { header: t("col.taxId"), key: "taxId", width: 16 },
      { header: t("col.branch"), key: "branch", width: 9 },
      { header: t("col.owner"), key: "owner", width: 22 },
      { header: t("col.beforeVat"), key: "beforeVat", width: 16, type: "money", total: true },
      { header: t("col.vat"), key: "vat", width: 13, type: "money", total: true },
      { header: t("col.total"), key: "total", width: 16, type: "money", total: true },
      { header: t("col.lostReason"), key: "lostReason", width: 22 },
      { header: t("col.po"), key: "po", width: 16 },
    ],
    rows: data.rows.map((r) => ({
      number: displayNumber(r.number, r.revision), company: r.company.code, status: tq(r.status),
      issueDate: r.issueDate, firstSent: day(r.firstSentAt), closedOn: day(r.closedOn),
      customer: r.customerName, taxId: r.customerTaxId, branch: r.customerBranchCode, owner: r.owner.name,
      beforeVat: baht(r.afterDiscountSatang), vat: baht(r.vatSatang), total: baht(r.totalSatang),
      lostReason: r.lostReason ? tl(r.lostReason) : null, po: r.poNumber,
    })),
  };
  const buf = await buildExport([sheet], { totalLabel: t("export.total") });
  return new Response(new Uint8Array(buf), { headers: xlsxHeaders(`${t("export.quotationsFile")}-${dayKey(f.fromDay)}_${dayKey(f.toDay)}.xlsx`) });
}

async function wonExport(f: ReportFilter, title: string[], t: T) {
  const won = await wonLines(f, MAX_EXPORT_ROWS + 1);
  if (won.length > MAX_EXPORT_ROWS || won.reduce((n, q) => n + q.items.length, 0) > MAX_EXPORT_LINES) return tooMany(t);
  const lines: Record<string, unknown>[] = [];
  const perQuotation: Record<string, unknown>[] = [];
  for (const q of won) {
    const expressCode = q.customer.expressCodes.find((c) => c.companyId === q.companyId)?.code ?? null;
    let sum = 0;
    for (const it of q.items) {
      const value = lineValueSatang(it);
      sum += value;
      lines.push({
        wonOn: day(q.closedAt), company: q.company.code, number: displayNumber(q.number, q.revision), po: q.poNumber, poDate: q.poDate,
        expressCode, customer: q.customerName, taxId: q.customerTaxId, branch: q.customerBranchCode, owner: q.owner.name,
        line: it.position + 1, code: it.productCode, name: it.name, qty: it.quantityMilli / 1000, unit: it.unit,
        unitPrice: netUnitPriceBaht(value, it.quantityMilli), value: baht(value),
      });
    }
    const beforeVat = Number(q.afterDiscountSatang);
    perQuotation.push({
      wonOn: day(q.closedAt), company: q.company.code, number: displayNumber(q.number, q.revision), po: q.poNumber,
      expressCode, customer: q.customerName, owner: q.owner.name,
      beforeVat: baht(beforeVat), vat: baht(Number(q.vatSatang)), total: baht(Number(q.totalSatang)),
      check: sum === beforeVat ? t("export.checkOk") : t("export.checkDiff", { diff: baht(sum - beforeVat).toFixed(2) }),
    });
  }
  const buf = await buildExport([
    {
      name: t("export.wonLinesSheet"),
      title,
      columns: [
        { header: t("col.wonOn"), key: "wonOn", width: 12, type: "date" },
        { header: t("col.company"), key: "company", width: 8 },
        { header: t("col.number"), key: "number", width: 22 },
        { header: t("col.po"), key: "po", width: 16 },
        { header: t("col.poDate"), key: "poDate", width: 12, type: "date" },
        { header: t("col.expressCode"), key: "expressCode", width: 14 },
        { header: t("col.customer"), key: "customer", width: 34 },
        { header: t("col.taxId"), key: "taxId", width: 16 },
        { header: t("col.branch"), key: "branch", width: 9 },
        { header: t("col.owner"), key: "owner", width: 20 },
        { header: t("col.line"), key: "line", width: 6, type: "int" },
        { header: t("col.productCode"), key: "code", width: 16 },
        { header: t("col.productName"), key: "name", width: 36 },
        { header: t("col.qty"), key: "qty", width: 10, type: "qty" },
        { header: t("col.unit"), key: "unit", width: 8 },
        { header: t("col.netUnitPrice"), key: "unitPrice", width: 14, type: "price" },
        { header: t("col.lineValue"), key: "value", width: 16, type: "money", total: true },
      ],
      rows: lines,
    },
    {
      name: t("export.wonSummarySheet"),
      title,
      columns: [
        { header: t("col.wonOn"), key: "wonOn", width: 12, type: "date" },
        { header: t("col.company"), key: "company", width: 8 },
        { header: t("col.number"), key: "number", width: 22 },
        { header: t("col.po"), key: "po", width: 16 },
        { header: t("col.expressCode"), key: "expressCode", width: 14 },
        { header: t("col.customer"), key: "customer", width: 34 },
        { header: t("col.owner"), key: "owner", width: 20 },
        { header: t("col.beforeVat"), key: "beforeVat", width: 16, type: "money", total: true },
        { header: t("col.vat"), key: "vat", width: 13, type: "money", total: true },
        { header: t("col.total"), key: "total", width: 16, type: "money", total: true },
        { header: t("col.check"), key: "check", width: 18 },
      ],
      rows: perQuotation,
    },
  ], { totalLabel: t("export.total") });
  return new Response(new Uint8Array(buf), { headers: xlsxHeaders(`${t("export.wonFile")}-${dayKey(f.fromDay)}_${dayKey(f.toDay)}.xlsx`) });
}
