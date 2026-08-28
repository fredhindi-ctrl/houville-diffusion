import { createClient } from "@supabase/supabase-js";

// Client Supabase local à vercel-app (pas dans shared/ : shared/ n'a pas son propre
// node_modules, donc un import d'une dépendance externe depuis là ne se résout pas au
// runtime — vérifié empiriquement en faisant tourner scripts/backfill.ts). webapp-oedicneme
// et whatsapp-worker ont chacun leur propre client équivalent.
//
// service_role : accès total, contourne RLS — vercel-app n'est jamais exposé publiquement
// (cron privé), c'est le seul contexte légitime pour cette clé côté scraper.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans l'environnement.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
