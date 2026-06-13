import type { Bindings } from "../env";

export async function sendEmail(
  env: Bindings,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "AIS Management <noreply@ais.worke.net>", to, subject, html }),
  });
}
