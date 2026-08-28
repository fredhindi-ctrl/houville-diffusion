import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runScrapeJob } from "../../lib/scraper/run.js";

// Déclenché 1x/jour par Vercel Cron (voir vercel.json).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Protection basique : Vercel Cron envoie un header Authorization avec CRON_SECRET.
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const resultat = await runScrapeJob();
  res.status(200).json(resultat);
}
