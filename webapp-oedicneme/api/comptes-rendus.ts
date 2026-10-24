import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// GET /api/comptes-rendus -> tous les comptes rendus (date + lien PDF), du plus récent au plus ancien.
// Clé anon uniquement, lecture seule via RLS ("lecture publique", voir supabase/schema.sql).
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  try {
    const { data, error } = await supabase
      .from("comptes_rendus")
      .select("date_conseil, url_pdf")
      .order("date_conseil", { ascending: false });
    if (error) throw error;
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({ results: data ?? [] });
  } catch {
    return res.status(500).json({ error: "Une erreur est survenue." });
  }
}
