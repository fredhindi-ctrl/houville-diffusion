import type { ActualiteScrapee, CompteRenduScrape } from "../../../shared/types";

// Voir MESSAGES.md à la racine du repo pour la conception détaillée de ces gabarits
// (testés contre de vraies données du site avant d'être figés ici).

const RAPPEL_TELEGRAM_CR = [
  "🔍 Pour rechercher un mot-clé dans les anciens comptes rendus, direction Telegram :",
  "🦉 @oedicneme_bot",
  "https://t.me/oedicneme_bot",
].join("\n");

const RAPPEL_TELEGRAM_ACTU = ["🔍 Recherche dans les comptes rendus : 🦉 @oedicneme_bot", "https://t.me/oedicneme_bot"].join(
  "\n"
);

// Formule quasi systématique des décisions actées dans les comptes rendus de conseil
// municipal : une phrase commençant par un verbe de délibération. Testé sur un vrai compte
// rendu (voir MESSAGES.md) : extraction propre, sans bruit.
const VERBES_DELIBERATION = /^[•.\s]*\b(DÉCIDE|AUTORISE|APPROUVE|ADOPTE|VOTE|ACCEPTE|REFUSE|CHARGE|DÉSIGNE|FIXE)\b/i;

const MOIS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function formatDateFrancais(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  return `${jour} ${MOIS_FR[mois - 1]} ${annee}`;
}

// Reflow le texte OCR (les retours à la ligne suivent le découpage visuel du scan, pas les
// phrases), puis extrait les phrases de décision. `max` limite la taille du message.
export function extraireTopics(texteOcr: string, max: number = 5): string[] {
  const continu = texteOcr
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const phrases = continu.split(/(?<=[.;])\s+(?=[A-ZÀ-Ÿ•.])/);

  return phrases
    .map((p) => p.replace(/^[•.\s]+/, "").trim())
    .filter((p) => VERBES_DELIBERATION.test(p))
    .slice(0, max);
}

// Tronque un extrait à `maxLen` caractères sans couper au milieu d'un mot.
function tronquer(texte: string, maxLen: number): string {
  if (texte.length <= maxLen) return texte;
  const coupe = texte.slice(0, maxLen);
  const dernierEspace = coupe.lastIndexOf(" ");
  return (dernierEspace > 0 ? coupe.slice(0, dernierEspace) : coupe).trim() + "…";
}

export function formatMessageCompteRendu(cr: CompteRenduScrape, texteOcr: string): string {
  const topics = extraireTopics(texteOcr);
  const lignes = [`📋 *COMPTE RENDU DU CONSEIL MUNICIPAL*`, `_Conseil municipal du ${formatDateFrancais(cr.date_conseil)}_`, ""];

  if (topics.length > 0) {
    lignes.push("*Points abordés :*");
    for (const topic of topics) {
      lignes.push(`• ${topic}`);
    }
    lignes.push("");
  }

  lignes.push("📄 Compte rendu complet (PDF) :", cr.url_pdf, "", RAPPEL_TELEGRAM_CR);

  return lignes.join("\n");
}

export function formatMessageActualite(actu: ActualiteScrapee): string {
  const lignes = [`📢 *Nouvelle actualité*`, "", `*${actu.titre}*`];

  // Le site renvoie parfois un extrait identique au titre — pas la peine de le répéter.
  const extraitUtile = actu.extrait && actu.extrait.trim().toLowerCase() !== actu.titre.trim().toLowerCase() ? actu.extrait.trim() : null;
  if (extraitUtile) {
    lignes.push(tronquer(extraitUtile, 200));
  }

  lignes.push("", "🔗 En savoir plus :", actu.url, "", RAPPEL_TELEGRAM_ACTU);

  return lignes.join("\n");
}
