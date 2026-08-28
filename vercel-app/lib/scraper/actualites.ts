import * as cheerio from "cheerio";
import type { ActualiteScrapee } from "../../shared/types.js";

const BASE_URL = "http://www.houvillelabranche.fr";
const URL_LISTING = `${BASE_URL}/fr/actualites`;
// Pagination : /fr/actualites/2, /fr/actualites/3, ... (7 pages au 27/08/2026). Le cron
// quotidien n'appelle que page=1 (nouveautés toujours en haut) ; le script de backfill boucle
// sur toutes les pages via getTotalPagesActualites().
//
// ATTENTION (comportement vérifié sur comptes-rendus, présumé identique ici — même template
// de site) : une page hors limites ne renvoie probablement PAS une liste vide mais le contenu
// de la dernière page valide. Ne jamais utiliser "résultat vide" comme condition d'arrêt de
// boucle ; utiliser getTotalPagesActualites().

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function extractSiteId(href: string): number | null {
  const match = href.match(/\/fr\/actualite\/(\d+)\//);
  return match ? parseInt(match[1], 10) : null;
}

// Structure confirmée par exploration (voir plan-houville.md) :
//   #liste > div.news répétés, plus récent en premier.
//   titre + lien détail dans le premier <p> > a (contient un <b>), extrait dans p.text.
// Pas de date de publication exposée sur le site (ni listing ni détail) — on utilise
// uniquement date_ajout (date de découverte par le scraper) côté base.
export async function scrapeActualites(page: number = 1): Promise<ActualiteScrapee[]> {
  const url = page === 1 ? URL_LISTING : `${URL_LISTING}/${page}`;

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Échec du fetch de ${url} : HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  const resultats: ActualiteScrapee[] = [];

  $("#liste > div.news").each((_, el) => {
    const lienTitre = $(el).find("p").first().find("a").first();
    const href = lienTitre.attr("href");
    const titre = lienTitre.text().trim();
    const extrait = $(el).find("p.text").first().text().trim();

    if (!href || !titre) return;

    const siteId = extractSiteId(href);
    if (siteId === null) return;

    resultats.push({
      site_id: siteId,
      titre,
      url: new URL(href, BASE_URL).toString(),
      extrait: extrait || null,
    });
  });

  return resultats;
}

// Lit le nombre total de pages depuis le paginateur (#paginator a[href]) de la page 1.
// Renvoie 1 si aucun paginateur n'est trouvé (une seule page de résultats).
export async function getTotalPagesActualites(): Promise<number> {
  const response = await fetch(URL_LISTING, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Échec du fetch de ${URL_LISTING} : HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  let maxPage = 1;
  $("#paginator a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const match = href.match(/\/fr\/actualites\/(\d+)/);
    if (match) {
      maxPage = Math.max(maxPage, parseInt(match[1], 10));
    }
  });
  return maxPage;
}
