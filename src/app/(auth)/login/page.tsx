import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
