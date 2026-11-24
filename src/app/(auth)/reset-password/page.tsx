import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const t = await getTranslations("auth");
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && token.length > 0 && !error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("resetTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {validToken ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <p className="text-sm text-destructive" role="alert">{t("errors.invalidToken")}</p>
            <Link href="/forgot-password" className="text-center text-sm hover:underline">
              {t("forgotTitle")}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
