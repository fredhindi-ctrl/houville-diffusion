// Process permanent Render : connexion Baileys au numéro WhatsApp personnel,
// puis boucle de polling de messages_a_envoyer (voir queue.ts).
// TODO (étape 5-6 du plan) :
//   1. connexion Baileys (pairing code, pas de QR à scanner)
//   2. persistance de la session (à vérifier si le disque Render gratuit est persistant
//      entre redéploiements — sinon stocker les credentials ailleurs)
//   3. boucle : poll messages_a_envoyer (statut=en_attente) toutes les X minutes,
//      poster dans le groupe, marquer comme envoyé
async function main() {
  throw new Error("TODO: connexion Baileys non encore implémentée");
}

main();
