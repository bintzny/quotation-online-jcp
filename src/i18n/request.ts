import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, toLocale } from "./config";

// No locale in the URL: the language is a per-browser preference kept in a cookie.
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Asia/Bangkok",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
