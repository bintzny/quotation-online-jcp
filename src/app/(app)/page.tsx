import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { FlashToast } from "@/components/flash-toast";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const company = user.companyId
    ? await prisma.company.findUnique({ where: { id: user.companyId }, select: { nameTh: true, code: true } })
    : null;
  const { passwordChanged } = await searchParams;

  return (
    <div className="grid gap-6">
      {passwordChanged && <FlashToast message={t("auth.passwordChanged")} />}
      <h1 className="text-2xl font-semibold tracking-tight">{t("home.welcome", { name: user.name })}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("home.yourRoles")}</CardTitle>
          <CardDescription>{user.roles.map((r) => t(`roles.${r}`)).join(", ")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">{t("home.yourCompany")}: </span>
            {company ? `${company.nameTh} (${company.code})` : t("common.none")}
          </p>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t("home.comingSoon")}</p>
    </div>
  );
}
