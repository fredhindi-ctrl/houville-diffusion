import { getSocket, isWhatsAppConnected } from "./whatsapp.js";
import { supabase } from "./supabase.js";

// Poll messages_a_envoyer (statut=en_attente), poste dans le groupe WhatsApp, marque comme
// envoyé. Diffusion à sens unique uniquement (voir plan-houville.md, section H) : aucune
// lecture de message entrant ici, juste l'envoi des messages générés par vercel-app.

// Volontairement lu à chaque appel (pas figé au chargement du module) : au tout premier
// démarrage, on ne connaît pas encore le JID du groupe cible (il faut d'abord se connecter
// pour lister les groupes existants, voir scripts/list-groups.ts) — le worker doit pouvoir
// démarrer et se connecter sans planter avant que cette variable soit renseignée.
function getGroupJid(): string | undefined {
  return process.env.WHATSAPP_GROUP_JID;
}

// Timestamp du dernier passage de la boucle, quel que soit le résultat — utilisé par /health
// (section I du plan) pour détecter une boucle de polling bloquée.
let lastPollAt: Date | null = null;

export function getLastPollAt(): Date | null {
  return lastPollAt;
}

export async function pollAndSend(): Promise<void> {
  lastPollAt = new Date();

  if (!isWhatsAppConnected()) {
    console.log("Polling ignoré : WhatsApp non connecté pour l'instant.");
    return;
  }
  const groupJid = getGroupJid();
  if (!groupJid) {
    console.log("Polling ignoré : WHATSAPP_GROUP_JID pas encore configuré.");
    return;
  }
  const sock = getSocket();
  if (!sock) return;

  const { data: messages, error } = await supabase
    .from("messages_a_envoyer")
    .select("id, contenu")
    .eq("statut", "en_attente")
    .order("date_creation", { ascending: true });

  if (error) {
    console.error("Lecture messages_a_envoyer échouée :", error.message);
    return;
  }
  if (!messages || messages.length === 0) return;

  for (const message of messages) {
    try {
      await sock.sendMessage(groupJid, { text: message.contenu });

      const { error: errUpdate } = await supabase
        .from("messages_a_envoyer")
        .update({ statut: "envoye", date_envoi: new Date().toISOString() })
        .eq("id", message.id);
      if (errUpdate) {
        console.error(`Message ${message.id} envoyé mais marquage échoué :`, errUpdate.message);
      } else {
        console.log(`Message ${message.id} envoyé et marqué.`);
      }
    } catch (e) {
      // Message laissé en_attente : sera retenté au prochain passage.
      console.error(`Échec d'envoi du message ${message.id} :`, (e as Error).message);
    }
  }
}
