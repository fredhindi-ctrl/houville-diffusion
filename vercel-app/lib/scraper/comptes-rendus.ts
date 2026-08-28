import * as cheerio from "cheerio";
import type { CompteRenduScrape } from "../../../shared/types";

const BASE_URL = "http://www.houvillelabranche.fr";
const URL_LISTING = `${BASE_URL}/fr/comptes-rendus`;
// Pagination : /fr/comptes-rendus/2, /fr/comptes-rendus/3, ... (3 pages au 27/08/2026,
// historique jusqu'à février 2016). Le cron quotidien n'appelle que page=1 (nouveautés
// toujours en haut) ; le script de backfill (scripts/backfill.ts) boucle sur toutes les pages.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseDateConseil(texte: string): string {
  // "20/08/2026" -> "2026-08-20"
  const [jour, mois, annee] = texte.trim().split("/");
  return `${annee}-${mois}-${jour}`;
}

function extractSiteId(href: string): number | null {
  const match = href.match(/\/fr\/compte-rendu\/(\d+)\//);
  return match ? parseInt(match[1], 10) : null;
}

// Structure confirmée par exploration (voir plan-houville.md) :
//   table.lastreports > tbody > tr, une ligne par compte rendu, plus récent en premier.
//   td[0] = date (DD/MM/YYYY), td[1] = titre + lien détail (/fr/compte-rendu/{id}/{slug}),
//   td[2] = lien PDF direct (cdn1_4.reseaudespetitescommunes.fr).
// La page détail n'apporte rien de plus que le listing — pas besoin de la visiter.
//
// ATTENTION (vérifié empiriquement) : une page hors limites (ex. page=99) ne renvoie PAS une
// liste vide — le site renvoie le contenu de la dernière page valide. Ne jamais utiliser
// "résultat vide" comme condition d'arrêt de boucle ; utiliser getTotalPagesComptesRendus().
export async function scrapeComptesRendus(page: number = 1): Promise<CompteRenduScrape[]> {
  const url = page === 1 ? URL_LISTING : `${URL_LISTING}/${page}`;

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Échec du fetch de ${url} : HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  const resultats: CompteRenduScrape[] = [];

  $("table.lastreports tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    const dateTexte = $(cells[0]).text().trim();
    const lienTitre = $(cells[1]).find("a").first();
    const href = lienTitre.attr("href");
    const titre = lienTitre.text().trim();
    const hrefPdf = $(cells[2]).find("a").attr("href");

    if (!href || !hrefPdf || !dateTexte) return;

    const siteId = extractSiteId(href);
    if (siteId === null) return;

    resultats.push({
      site_id: siteId,
      titre,
      url: new URL(href, BASE_URL).toString(),
      url_pdf: hrefPdf,
      date_conseil: parseDateConseil(dateTexte),
    });
  });

  return resultats;
}

// Lit le nombre total de pages depuis le paginateur (#paginator a[href]) de la page 1.
// Renvoie 1 si aucun paginateur n'est trouvé (une seule page de résultats).
export async function getTotalPagesComptesRendus(): Promise<number> {
  const response = await fetch(URL_LISTING, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Échec du fetch de ${URL_LISTING} : HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  let maxPage = 1;
  $("#paginator a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const match = href.match(/\/fr\/comptes-rendus\/(\d+)/);
    if (match) {
      maxPage = Math.max(maxPage, parseInt(match[1], 10));
    }
  });
  return maxPage;
}
