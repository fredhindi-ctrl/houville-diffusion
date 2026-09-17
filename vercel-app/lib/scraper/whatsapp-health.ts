// Vérification quotidienne (appelée depuis le cron scrape.ts) que whatsapp-worker répond
// correctement — défense en profondeur en plus d'UptimeRobot (qui vérifie toutes les 5 min,
// voir plan-houville.md). N'envoie une alerte que si le worker est réellement en panne, jamais
// de mail "tout va bien" au quotidien.

interface HealthResponse {
  status: string;
  whatsapp: string;
  database: string;
  worker: string;
}

export async function checkWhatsappWorkerHealth(): Promise<void> {
  const url = process.env.WHATSAPP_WORKER_HEALTH_URL;
  if (!url) return; // pas configuré, ne bloque jamais le scrape pour autant

  let enPanne = false;
  let detail = "";

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await response.json().catch(() => null)) as HealthResponse | null;
    if (!response.ok || !data || data.whatsapp !== "connected") {
      enPanne = true;
      detail = data ? JSON.stringify(data) : `HTTP ${response.status}`;
    }
  } catch (e) {
    enPanne = true;
    detail = `injoignable : ${(e as Error).message}`;
  }

  if (enPanne) {
    await sendAlertEmail(detail);
  }
}

async function sendAlertEmail(detail: string): Promise<void> {
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
        subject: "⚠️ whatsapp-worker semble en panne",
        text:
          "Vérification quotidienne (scraper Vercel) : whatsapp-worker ne répond pas correctement.\n\n" +
          `Détail : ${detail}\n\n` +
          "UptimeRobot devrait aussi avoir alerté si c'est le cas depuis un moment — ceci est une " +
          "double vérification indépendante.",
      }),
    });
  } catch {
    // Rien de plus à faire si même l'alerte échoue — ne doit jamais faire planter le cron.
  }
}
