import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase.js";

// Surveillé par UptimeRobot. Renvoie 503 si le dernier scrape réussi date de plus de 26 h
// (cron arrêté, ou en erreur chaque jour). Si le déploiement lui-même est cassé, cette route
// renvoie 404 : UptimeRobot alerte aussi.
const DELAI_MAX_MS = 26 * 60 * 60 * 1000;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  const { data, error } = await supabase
    .from("etat_jobs")
    .select("dernier_passage, dernier_succes, erreurs")
    .eq("nom", "scrape")
    .maybeSingle();

  if (error) return res.status(503).json({ status: "erreur", detail: error.message });
  if (!data?.dernier_succes) return res.status(503).json({ status: "jamais_reussi", ...data });

  const age = Date.now() - new Date(data.dernier_succes).getTime();
  const ok = age <= DELAI_MAX_MS;
  return res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "scrape_en_retard", ...data });
}
