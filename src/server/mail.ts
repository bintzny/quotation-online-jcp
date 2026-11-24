import "server-only";

// Placeholder mailer for M0. Real delivery (Resend, per-company sender domain) arrives in M3.
// In development the message is printed to the server console so links can be followed.

export type MailMessage = { to: string; subject: string; text: string };

export async function sendMail(msg: MailMessage): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    // Fail loudly rather than silently dropping mail in production before M3 is done.
    throw new Error("Email delivery is not configured yet");
  }
  console.log(`\n[mail] to=${msg.to}\n[mail] subject=${msg.subject}\n${msg.text}\n`);
}
