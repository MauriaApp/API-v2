import { createClient, SupabaseClient } from "@supabase/supabase-js";

import dotenv from "dotenv";
dotenv.config();

export const pfpUrl =
    "https://vjueuqojbmhwwryhxqwn.supabase.co/storage/v1/object/public/pfp/";

/**
 * Lazy client : on ne lève l'erreur "env manquantes" qu'au premier appel d'une
 * route supa-data, pas au démarrage. Ça permet de lancer l'API en local (routes
 * Aurion / lacatho / crous) sans credentials Supabase.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (client) return client;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error(
            "Missing required environment variables: SUPABASE_URL and SUPABASE_KEY"
        );
    }

    client = createClient(supabaseUrl, supabaseKey);
    return client;
}

// Tables holding personal data (e.g. colles_students) sit behind RLS with no
// anon policy: the anon/publishable key above can't read them by design, and
// no RLS policy could safely change that (it's the same key for everyone who
// has it). Only the private service_role key — never client-exposed, always
// bypasses RLS — is allowed to read them.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const supabaseAdmin =
    supabaseUrl && supabaseServiceKey
        ? createClient(supabaseUrl, supabaseServiceKey)
        : null;
