import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowOnboarding: true });
  const t = await getTranslations("auth");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("changePasswordTitle")}</CardTitle>
        {user.mustChangePassword && <CardDescription>{t("changePasswordForced")}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ChangePasswordForm />
      </CardContent>
    </Card>
  );
}
