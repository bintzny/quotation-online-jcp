import "server-only";
import { randomBytes } from "node:crypto";
import { putObject } from "@/server/storage";

// Outgoing email.
// - RESEND_API_KEY set: sent through Resend (each sender domain must be verified there, SPF/DKIM).
// - Development without a key: written to storage/outbox/ (JSON + attachments) and logged.
// - Production without a key: fails loudly instead of silently dropping mail.

export type MailAttachment = { filename: string; content: Buffer };
export type MailMessage = {
  to: string | string[];
  cc?: string[];
  from?: string; // "Name <address>"; defaults to MAIL_FROM for system mail
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  idempotencyKey?: string; // the email service sends a message with the same key only once
};

/** "ACME Co., Ltd." + address → a From header with no way to inject other headers. */
export function formatFrom(name: string, address: string): string {
  const cleanName = name.replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (/[\r\n<>,"\s]/.test(address)) throw new Error("Bad sender address");
  return cleanName ? `"${cleanName}" <${address}>` : address;
}

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export async function sendMail(msg: MailMessage): Promise<{ id: string | null }> {
  const from = msg.from ?? process.env.MAIL_FROM;
  const key = process.env.RESEND_API_KEY;
  for (const h of [msg.subject, msg.replyTo ?? "", ...list(msg.to), ...list(msg.cc)]) {
    if (/[\r\n]/.test(h)) throw new Error("Line break in an email header");
  }

  if (key) {
    if (!from) throw new Error("MAIL_FROM is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: list(msg.to),
        cc: msg.cc?.length ? msg.cc : undefined,
        reply_to: msg.replyTo,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) throw new Error(`Email service error ${res.status}: ${body?.message ?? "unknown"}`);
    return { id: body?.id ?? null };
  }

  if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured (RESEND_API_KEY)");

  // development outbox
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const files: string[] = [];
  for (const a of msg.attachments ?? []) {
    const k = `outbox/${stamp}-${files.length + 1}.pdf`;
    await putObject(k, a.content);
    files.push(`${a.filename} → storage/${k}`);
  }
  await putObject(`outbox/${stamp}.json`, Buffer.from(JSON.stringify({ ...msg, from, attachments: files }, null, 2)));
  console.log(`\n[mail] (development outbox) to=${list(msg.to).join(", ")} subject=${msg.subject}\n[mail] saved storage/outbox/${stamp}.json\n${msg.text}\n`);
  return { id: null };
}
