import { supabase } from "../supabase.js";
import { scrapeActualites } from "./actualites.js";
import { scrapeComptesRendus } from "./comptes-rendus.js";
import { extractPdfText } from "./pdf.js";
import { formatMessageActualite, formatMessageCompteRendu } from "./whatsapp-templates.js";

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

    const { data: existantes, error: errExistantes } = await supabase.from("actualites").select("site_id");
    if (errExistantes) throw new Error(`lecture actualites : ${errExistantes.message}`);
    const siteIdsExistants = new Set((existantes ?? []).map((r) => r.site_id));

    for (const actu of items) {
      if (siteIdsExistants.has(actu.site_id)) continue;

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

  return resultat;
}
