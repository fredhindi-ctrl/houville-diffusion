import { createServer } from "http";
import { connectWhatsApp, isWhatsAppConnected } from "./whatsapp.js";
import { pollAndSend, getLastPollAt } from "./queue.js";
import { supabase } from "./supabase.js";

// Process permanent (Koyeb) : connexion Baileys au numéro WhatsApp personnel, boucle de
// polling de messages_a_envoyer, endpoint /health pour UptimeRobot. Voir plan-houville.md,
// sections H et I.

const PHONE_NUMBER = process.env.WHATSAPP_PHONE_NUMBER;
if (!PHONE_NUMBER) {
  throw new Error("WHATSAPP_PHONE_NUMBER doit être défini dans l'environnement (format E.164, ex. +33612345678).");
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — largement suffisant pour un usage 1x/jour.
const STALL_THRESHOLD_MS = POLL_INTERVAL_MS * 3;
const startedAt = Date.now();

async function checkDatabase(): Promise<boolean> {
  // Ping léger : une lecture bornée, pas d'écriture, pas de comptage coûteux.
  const { error } = await supabase.from("messages_a_envoyer").select("id").limit(1);
  return !error;
}

function isWorkerAlive(): boolean {
  const lastPollAt = getLastPollAt();
  if (!lastPollAt) {
    // Pas encore de premier passage : normal juste après le démarrage, anormal après.
    return Date.now() - startedAt < STALL_THRESHOLD_MS;
  }
  return Date.now() - lastPollAt.getTime() < STALL_THRESHOLD_MS;
}

function startHealthServer() {
  const port = Number(process.env.PORT) || 3000;

  const server = createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }

    const whatsapp = isWhatsAppConnected();
    const database = await checkDatabase();
    const worker = isWorkerAlive();
    const healthy = whatsapp && database && worker;

    // Jamais un 200 avec un champ caché à false : voir plan-houville.md section I — un
    // problème réel doit vraiment déclencher l'alerte UptimeRobot.
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "error",
        whatsapp: whatsapp ? "connected" : "disconnected",
        database: database ? "ok" : "error",
        worker: worker ? "ok" : "stalled",
      })
    );
  });

  server.listen(port, () => console.log(`/health en écoute sur le port ${port}.`));
}

async function main() {
  startHealthServer();
  await connectWhatsApp(PHONE_NUMBER!);

  await pollAndSend();
  setInterval(() => {
    pollAndSend().catch((e) => console.error("Erreur pendant le polling :", e));
  }, POLL_INTERVAL_MS);
}

main().catch((e) => {
  console.error("Erreur fatale au démarrage :", e);
  process.exit(1);
});
