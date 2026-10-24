// Envoi d'un email d'alerte via Resend (EMAIL_TO). Ne lève jamais d'exception : une alerte
// qui échoue ne doit pas faire planter le cron.
export async function sendAlertEmail(sujet: string, texte: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  if (!apiKey || !to) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Œdicnème <onboarding@resend.dev>",
        to: [to],
        subject: sujet,
        text: texte,
      }),
    });
  } catch {
    // rien de plus à faire
  }
}
