import { supabase } from "../supabase.js";
import { scrapeActualites } from "./actualites.js";
import { scrapeComptesRendus } from "./comptes-rendus.js";
import { extractPdfText } from "./pdf.js";
import { formatMessageActualite, formatMessageCompteRendu } from "./whatsapp-templates.js";
import { checkWhatsappWorkerHealth } from "./whatsapp-health.js";
import { sendAlertEmail } from "./alerte.js";

export interface ResultatScrape {
  comptesRendus: { scannes: number; nouveaux: number };
  actualites: { scannees: number; nouvelles: number };
  erreurs: string[];
}

// Job quotidien : ne lit que la page 1 de chaque listing (les nouveautés apparaissent toujours
// en haut — voir lib/scraper/comptes-rendus.ts et actualites.ts). Le backfill historique
// (scripts/backfill.ts) est un job séparé, à lancer une seule fois à la main.
export async function runScrapeJob(): Promise<ResultatScrape> {
  const resultat: ResultatScrape = {
    comptesRendus: { scannes: 0, nouveaux: 0 },
    actualites: { scannees: 0, nouvelles: 0 },
    erreurs: [],
  };

  try {
    const items = await scrapeComptesRendus(1);
    resultat.comptesRendus.scannes = items.length;

    const { data: existants, error: errExistants } = await supabase.from("comptes_rendus").select("site_id");
    if (errExistants) throw new Error(`lecture comptes_rendus : ${errExistants.message}`);
    const siteIdsExistants = new Set((existants ?? []).map((r) => r.site_id));

    for (const cr of items) {
      if (siteIdsExistants.has(cr.site_id)) continue;

      try {
        const texteOcr = await extractPdfText(cr.url_pdf);

        const { data: inserted, error: errInsert } = await supabase
          .from("comptes_rendus")
          .insert({ site_id: cr.site_id, titre: cr.titre, url: cr.url, url_pdf: cr.url_pdf, date_conseil: cr.date_conseil })
          .select()
          .single();
        if (errInsert || !inserted) throw new Error(errInsert?.message ?? "insertion comptes_rendus échouée");

        const { error: errTexte } = await supabase
          .from("comptes_rendus_texte")
          .insert({ compte_rendu_id: inserted.id, texte_extrait: texteOcr });
        if (errTexte) throw new Error(errTexte.message);

        const { error: errMessage } = await supabase
          .from("messages_a_envoyer")
          .insert({ contenu: formatMessageCompteRendu(cr, texteOcr) });
        if (errMessage) throw new Error(errMessage.message);

        resultat.comptesRendus.nouveaux++;
      } catch (e) {
        resultat.erreurs.push(`compte-rendu ${cr.site_id} : ${(e as Error).message}`);
      }
    }
  } catch (e) {
    resultat.erreurs.push(`scraping comptes-rendus : ${(e as Error).message}`);
  }

  try {
    const items = await scrapeActualites(1);
    resultat.actualites.scannees = items.length;

    const { data: existantes, error: errExistantes } = await supabase.from("actualites").select("site_id, titre");
    if (errExistantes) throw new Error(`lecture actualites : ${errExistantes.message}`);
    const titresExistants = new Map((existantes ?? []).map((r) => [r.site_id, r.titre as string]));

    for (const actu of items) {
      const titreConnu = titresExistants.get(actu.site_id);
      if (titreConnu === actu.titre) continue;

      // La mairie réutilise parfois une ancienne actualité (même site_id) en changeant son
      // titre et son contenu : on la traite alors comme une nouvelle publication.
      if (titreConnu !== undefined) {
        try {
          const { error: errUpdate } = await supabase
            .from("actualites")
            .update({ titre: actu.titre, url: actu.url, extrait: actu.extrait })
            .eq("site_id", actu.site_id);
          if (errUpdate) throw new Error(errUpdate.message);

          const { error: errMessage } = await supabase
            .from("messages_a_envoyer")
            .insert({ contenu: formatMessageActualite(actu) });
          if (errMessage) throw new Error(errMessage.message);

          resultat.actualites.nouvelles++;
        } catch (e) {
          resultat.erreurs.push(`actualité modifiée ${actu.site_id} : ${(e as Error).message}`);
        }
        continue;
      }

      try {
        const { error: errInsert } = await supabase
          .from("actualites")
          .insert({ site_id: actu.site_id, titre: actu.titre, url: actu.url, extrait: actu.extrait });
        if (errInsert) throw new Error(errInsert.message);

        const { error: errMessage } = await supabase
          .from("messages_a_envoyer")
          .insert({ contenu: formatMessageActualite(actu) });
        if (errMessage) throw new Error(errMessage.message);

        resultat.actualites.nouvelles++;
      } catch (e) {
        resultat.erreurs.push(`actualité ${actu.site_id} : ${(e as Error).message}`);
      }
    }
  } catch (e) {
    resultat.erreurs.push(`scraping actualités : ${(e as Error).message}`);
  }

  // Vérification quotidienne indépendante d'UptimeRobot (voir whatsapp-health.ts) — jamais
  // bloquante pour le job de scrape lui-même.
  try {
    await checkWhatsappWorkerHealth();
  } catch (e) {
    resultat.erreurs.push(`vérification whatsapp-worker : ${(e as Error).message}`);
  }

  await enregistrerEtat(resultat);

  return resultat;
}

// Une page de listing vide = la structure du site a probablement changé (le scraper ne
// reconnaît plus rien) : c'est traité comme une erreur.
function anomalies(r: ResultatScrape): string[] {
  const liste = [...r.erreurs];
  if (r.comptesRendus.scannes === 0) liste.push("aucun compte rendu trouvé sur le site (structure modifiée ?)");
  if (r.actualites.scannees === 0) liste.push("aucune actualité trouvée sur le site (structure modifiée ?)");
  return liste;
}

// Enregistre le passage dans etat_jobs (lu par /api/health, surveillé par UptimeRobot) et
// envoie un email immédiat en cas d'anomalie.
async function enregistrerEtat(r: ResultatScrape): Promise<void> {
  const problemes = anomalies(r);
  const maintenant = new Date().toISOString();

  const ligne: Record<string, unknown> = { nom: "scrape", dernier_passage: maintenant, erreurs: problemes };
  if (problemes.length === 0) ligne.dernier_succes = maintenant;

  const { error } = await supabase.from("etat_jobs").upsert(ligne);
  if (error) problemes.push(`écriture etat_jobs : ${error.message}`);

  if (problemes.length > 0) {
    await sendAlertEmail(
      "⚠️ Houville : le scraper quotidien a rencontré un problème",
      "Le scrape du site de Houville-la-Branche ne s'est pas déroulé normalement.\n" +
        "Des actualités ou comptes rendus risquent de ne pas être diffusés sur WhatsApp.\n\n" +
        problemes.map((p) => `• ${p}`).join("\n") +
        `\n\nRésultat : ${JSON.stringify({ comptesRendus: r.comptesRendus, actualites: r.actualites })}`,
    );
  }
}
