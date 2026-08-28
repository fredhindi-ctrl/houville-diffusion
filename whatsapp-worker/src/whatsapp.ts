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

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

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

  // Pairing code demandé une seule fois, tant que la session n'est pas encore enregistrée
  // (creds persistés dans Supabase ensuite — voir auth-state.ts).
  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(`Code d'appairage WhatsApp : ${code}`);
    console.log("Sur le téléphone : Paramètres > Appareils connectés > Lier un appareil > Lier avec le numéro de téléphone.");
  }

  return sock;
}

export function getSocket(): WASocket | null {
  return sock;
}
