import { supabase } from "../lib/supabase";
import { getTotalPagesActualites, scrapeActualites } from "../lib/scraper/actualites";
import { getTotalPagesComptesRendus, scrapeComptesRendus } from "../lib/scraper/comptes-rendus";
import { extractPdfText } from "../lib/scraper/pdf";

// Backfill historique — à lancer UNE SEULE FOIS, à la main (npm run backfill), pas via le cron.
//
// IMPORTANT : n'écrit JAMAIS dans messages_a_envoyer. Le backfill est silencieux — aucune
// diffusion WhatsApp de l'historique. Seul le cron quotidien, à partir de son premier passage
// (une fois le backfill terminé), génère des messages pour les vraies nouveautés.
//
// Idempotent : si un item échoue (ex. throttle OCR.space), il n'est pas inséré en base, donc
// un second lancement du script le retente sans dupliquer ce qui a déjà réussi (dédup par
// site_id contre ce qui est déjà en base).

async function backfillComptesRendus() {
  const totalPages = await getTotalPagesComptesRendus();
  console.log(`Comptes rendus : ${totalPages} page(s) à parcourir`);

  const { data: existants, error: errExistants } = await supabase.from("comptes_rendus").select("site_id");
  if (errExistants) throw new Error(`Lecture comptes_rendus échouée : ${errExistants.message}`);
  const siteIdsExistants = new Set((existants ?? []).map((r) => r.site_id));

  let ajoutes = 0;
  let echecs = 0;

  for (let page = 1; page <= totalPages; page++) {
    const items = await scrapeComptesRendus(page);
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

        siteIdsExistants.add(cr.site_id);
        ajoutes++;
        console.log(`  + [${cr.date_conseil}] ${cr.titre} (${texteOcr.length} caractères OCR)`);
      } catch (e) {
        echecs++;
        console.error(`  ! échec compte rendu ${cr.site_id} (${cr.titre}) : ${(e as Error).message}`);
      }
    }
  }

  console.log(`Comptes rendus : ${ajoutes} ajouté(s), ${echecs} échec(s).`);
}

async function backfillActualites() {
  const totalPages = await getTotalPagesActualites();
  console.log(`Actualités : ${totalPages} page(s) à parcourir`);

  const { data: existantes, error: errExistantes } = await supabase.from("actualites").select("site_id");
  if (errExistantes) throw new Error(`Lecture actualites échouée : ${errExistantes.message}`);
  const siteIdsExistants = new Set((existantes ?? []).map((r) => r.site_id));

  let ajoutees = 0;
  let echecs = 0;

  for (let page = 1; page <= totalPages; page++) {
    const items = await scrapeActualites(page);
    for (const actu of items) {
      if (siteIdsExistants.has(actu.site_id)) continue;

      const { error } = await supabase
        .from("actualites")
        .insert({ site_id: actu.site_id, titre: actu.titre, url: actu.url, extrait: actu.extrait });
      if (error) {
        echecs++;
        console.error(`  ! échec actualité ${actu.site_id} (${actu.titre}) : ${error.message}`);
        continue;
      }

      siteIdsExistants.add(actu.site_id);
      ajoutees++;
      console.log(`  + ${actu.titre}`);
    }
  }

  console.log(`Actualités : ${ajoutees} ajoutée(s), ${echecs} échec(s).`);
}

async function backfill() {
  await backfillComptesRendus();
  await backfillActualites();
}

backfill();
