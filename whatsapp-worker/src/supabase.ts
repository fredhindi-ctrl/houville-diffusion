import { createClient } from "@supabase/supabase-js";

// Client Supabase local à whatsapp-worker (voir vercel-app/lib/supabase.ts pour l'explication
// du pourquoi pas dans shared/). service_role : whatsapp-worker n'est jamais exposé
// publiquement (worker interne, /health mis à part), légitime pour cette clé.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans l'environnement.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
