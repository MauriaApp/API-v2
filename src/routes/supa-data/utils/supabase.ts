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
