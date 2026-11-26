import { cronAuthorized } from "@/server/cron-auth";
import { clientIp, ipConfig } from "@/server/domain/client-ip";

// One-off check on the live host (docs/deploy.md, "ตรวจ IP ผู้ใช้"): shows how the client address
// arrives through Render's proxies, so CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS can be set correctly.
// Same secret as the scheduler; without it the route does not exist.
//   curl -X POST -H "Authorization: Bearer <CRON_SECRET>" -H "X-Forwarded-For: 1.2.3.4" \
//        -H "True-Client-IP: 1.2.3.4" https://<domain>/api/ops/ip-check
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("Not found", { status: 404 });
  const h = req.headers;
  const names = ["x-forwarded-for", "true-client-ip", "cf-connecting-ip", "x-real-ip", "x-forwarded-proto"];
  const seen = Object.fromEntries(names.map((n) => [n, h.get(n)]));
  return Response.json(
    { resolved: clientIp((n) => h.get(n)), config: ipConfig(), headers: seen },
    { headers: { "Cache-Control": "no-store" } },
  );
}
