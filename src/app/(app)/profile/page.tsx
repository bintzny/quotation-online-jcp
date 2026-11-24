import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/session";
import { requires2FA } from "@/server/domain/roles";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfilePage() {
  const user = await requireUser();
  const t = await getTranslations();
  const mandatory = requires2FA(user.roles.join(","));

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title={t("profile.title")} />
      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <p className="text-base font-medium">{user.name}</p>
          <p className="text-muted-foreground">{user.email}</p>
          <div className="flex flex-wrap gap-1">
            {user.roles.map((r) => <Badge key={r} variant="secondary">{t(`roles.${r}`)}</Badge>)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.security")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("auth.changePasswordTitle")}</span>
            <Link href="/change-password" className={buttonVariants({ variant: "outline" })}>
              {t("auth.changePasswordButton")}
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-0.5">
              <span>{t("profile.twoFactorStatus")}</span>
              {mandatory && <span className="text-xs text-muted-foreground">{t("profile.required2fa")}</span>}
            </div>
            {user.twoFactorEnabled ? (
              <Badge>{t("users.twoFactorOn")}</Badge>
            ) : (
              <Link href="/setup-2fa" className={buttonVariants({ variant: "outline" })}>
                {t("profile.enable2fa")}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
