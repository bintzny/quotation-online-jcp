import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/session";
import { requires2FA } from "@/server/domain/roles";
import { SetupTwoFactor } from "./setup-two-factor";

export default async function SetupTwoFactorPage() {
  const user = await requireUser({ allowOnboarding: true });
  if (user.mustChangePassword) redirect("/change-password");
  if (user.twoFactorEnabled) redirect("/");
  const t = await getTranslations("auth");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setup2faTitle")}</CardTitle>
        {requires2FA(user.roles.join(",")) && <CardDescription>{t("setup2faForced")}</CardDescription>}
      </CardHeader>
      <CardContent>
        <SetupTwoFactor />
      </CardContent>
    </Card>
  );
}
