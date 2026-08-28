import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// Clé anon uniquement : cet endpoint est public. Lecture seule via RLS ("lecture publique",
// voir supabase/schema.sql) — jamais service_role ici.
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

interface ResultatRecherche {
  compte_rendu_id: number;
  titre: string;
  date_conseil: string;
  url: string;
  url_pdf: string;
  extrait: string;
}

// Normalisation légère et déterministe : minuscules, retrait de la ponctuation, espaces
// normalisés. Les accents, mots vides français et la racinisation sont gérés côté Postgres
// par la configuration french_unaccent (voir schema.sql) — pas dupliqué ici.
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tronquer(texte: string, maxLen: number): string {
  if (texte.length <= maxLen) return texte;
  const coupe = texte.slice(0, maxLen);
  const dernierEspace = coupe.lastIndexOf(" ");
  return (dernierEspace > 0 ? coupe.slice(0, dernierEspace) : coupe).trim() + "…";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // Confidentialité : ne jamais journaliser la requête (voir plan-houville.md).
  const queryBrute = typeof req.body?.query === "string" ? req.body.query : "";
  const requete = normaliser(queryBrute);

  if (!requete) {
    return res.status(200).json({ count: 0, results: [] });
  }

  try {
    // 1. Recherche full-text (chemin principal, déterministe, classée par ts_rank).
    const { data: ftsResultats, error: ftsError } = await supabase.rpc("recherche_fts", {
      requete,
      limite: 5,
    });
    if (ftsError) throw ftsError;

    let idsAvecExtrait: { compte_rendu_id: number; extrait: string | null }[] = ftsResultats ?? [];

    // 2. Repli pg_trgm si la recherche full-text ne trouve rien (tolère les fautes OCR) —
    // sur le dernier mot significatif de la requête.
    if (idsAvecExtrait.length === 0) {
      const mots = requete.split(" ").filter((m) => m.length > 2);
      const dernierMot = mots[mots.length - 1];
      if (dernierMot) {
        const { data: flouResultats, error: flouError } = await supabase.rpc("recherche_floue", {
          mot: dernierMot,
          limite: 5,
        });
        if (flouError) throw flouError;
        idsAvecExtrait = (flouResultats ?? []).map((r: { compte_rendu_id: number }) => ({
          compte_rendu_id: r.compte_rendu_id,
          extrait: null, // pas d'extrait ciblé disponible pour ce chemin, voir plus bas
        }));
      }
    }

    if (idsAvecExtrait.length === 0) {
      return res.status(200).json({ count: 0, results: [] });
    }

    const ids = idsAvecExtrait.map((r) => r.compte_rendu_id);
    const { data: comptesRendus, error: crError } = await supabase
      .from("comptes_rendus")
      .select("id, titre, date_conseil, url, url_pdf, comptes_rendus_texte(texte_extrait)")
      .in("id", ids);
    if (crError) throw crError;

    const extraitParId = new Map(idsAvecExtrait.map((r) => [r.compte_rendu_id, r.extrait]));

    const results: ResultatRecherche[] = (comptesRendus ?? [])
      .map((cr) => {
        const extraitCible = extraitParId.get(cr.id);
        // Chemin repli (pas d'extrait ciblé) : on affiche le début du document — dégradé
        // mais honnête, pas de fausse précision sur où le mot approximatif a été trouvé.
        const texteBrut = (cr.comptes_rendus_texte as { texte_extrait: string }[] | null)?.[0]?.texte_extrait ?? "";
        const extrait = extraitCible ?? tronquer(texteBrut, 220);

        return {
          compte_rendu_id: cr.id,
          titre: cr.titre,
          date_conseil: cr.date_conseil,
          url: cr.url,
          url_pdf: cr.url_pdf,
          extrait,
        };
      })
      // Préserve l'ordre de classement renvoyé par la recherche (ts_rank / similarité).
      .sort((a, b) => ids.indexOf(a.compte_rendu_id) - ids.indexOf(b.compte_rendu_id));

    res.status(200).json({ count: results.length, results });
  } catch {
    // Ne jamais journaliser le détail (pourrait contenir la requête). Réponse générique.
    res.status(500).json({ error: "Une erreur est survenue pendant la recherche." });
  }
}
