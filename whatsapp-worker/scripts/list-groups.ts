// Utilitaire ponctuel : liste les groupes WhatsApp dont le compte connecté est déjà membre,
// pour trouver le JID à mettre dans WHATSAPP_GROUP_JID. À lancer une fois la connexion Baileys
// établie (session déjà persistée dans baileys_auth_state) — ne référence pas ce module dans
// index.ts, c'est un script indépendant (npm run list-groups).
import { connectWhatsApp } from "../src/whatsapp.js";

const PHONE_NUMBER = process.env.WHATSAPP_PHONE_NUMBER;
if (!PHONE_NUMBER) {
  throw new Error("WHATSAPP_PHONE_NUMBER doit être défini dans l'environnement.");
}

async function main() {
  const sock = await connectWhatsApp(PHONE_NUMBER!);

  await new Promise<void>((resolve) => {
    sock.ev.on("connection.update", (update) => {
      if (update.connection === "open") resolve();
    });
  });

  const groups = await sock.groupFetchAllParticipating();
  console.log("Groupes trouvés :");
  for (const g of Object.values(groups)) {
    console.log(`  ${g.id}  —  ${g.subject}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Erreur :", e);
  process.exit(1);
});
