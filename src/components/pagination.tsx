import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";

/** Previous/next links that keep the other search params. */
export async function Pagination({
  page,
  pageCount,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations("common");
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonVariants({ variant: "outline" })}>{t("previous")}</Link>
      ) : <span />}
      <span className="text-muted-foreground">{t("pageOf", { page, total: pageCount })}</span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={buttonVariants({ variant: "outline" })}>{t("next")}</Link>
      ) : <span />}
    </div>
  );
}
