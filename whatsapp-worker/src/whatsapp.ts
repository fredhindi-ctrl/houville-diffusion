import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import { useSupabaseAuthState } from "./auth-state.js";

// Connexion et gestion de la session Baileys (voir plan-houville.md, section H). Pairing code
// (pas de QR à scanner) : le numéro personnel demande un code à saisir dans WhatsApp
// (Paramètres > Appareils connectés > Lier avec le numéro de téléphone).
// Diffusion à sens unique uniquement : aucun handler de message entrant, aucune réponse
// automatique aux habitants — voir plan-houville.md, section H.

let sock: WASocket | null = null;
let connected = false;

export function isWhatsAppConnected(): boolean {
  return connected;
}

export async function connectWhatsApp(phoneNumber: string): Promise<WASocket> {
  const { state, saveCreds } = await useSupabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });
  sock = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    // TEMPORAIRE (28/08/2026) : pairing code cassé par un bug Baileys non résolu en amont
    // (WhiskeySockets/Baileys#2364 — boucle "Connection Failure" au handshake Noise juste après
    // l'émission du code, reproductible identiquement sur 6.7.x et 7.0.0-rc14). QR code en
    // repli le temps qu'un correctif sorte — revoir plan-houville.md, section H.
    if (qr) {
      console.log(`QR_CODE_DATA:${qr}`);
    }

    if (connection === "open") {
      connected = true;
      console.log("WhatsApp connecté.");
    }

    if (connection === "close") {
      connected = false;
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
        ?.statusCode;
      // Avant le tout premier appairage, Baileys referme systématiquement la connexion peu après
      // avoir émis le pairing code (y compris avec un code 401/loggedOut) — ce n'est pas un vrai
      // logout tant qu'aucune session n'a jamais été enregistrée. Ne considérer "loggedOut" comme
      // définitif que si on avait déjà une session enregistrée.
      const reallyLoggedOut = statusCode === DisconnectReason.loggedOut && state.creds.registered;
      console.log(`WhatsApp déconnecté (code ${statusCode ?? "?"}).${reallyLoggedOut ? " Session invalidée — repairing nécessaire." : " Reconnexion..."}`);
      if (!reallyLoggedOut) {
        connectWhatsApp(phoneNumber).catch((e) => console.error("Échec de reconnexion :", e));
      }
    }
  });

  // Pairing code désactivé pour l'instant (voir le commentaire TEMPORAIRE plus haut) — Baileys
  // émet automatiquement un événement `qr` dans connection.update tant qu'aucun pairing code
  // n'est demandé, c'est ce flux QR qui est utilisé à la place ci-dessus. `phoneNumber` reste
  // utile pour la reconnexion automatique (voir le handler "close").

  return socket;
}

export function getSocket(): WASocket | null {
  return sock;
}
