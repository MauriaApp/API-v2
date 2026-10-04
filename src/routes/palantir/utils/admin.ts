/**
 * The admin gate for Palantir's people data: who may read teachers and
 * student rosters through /palantir/people.
 *
 * The app has no accounts of its own — a user IS their Aurion email — so
 * the list is a Supabase table of emails (see scripts/palantir-admins-
 * schema.sql), readable only through the service key like the colles
 * roster. The route still verifies the caller's password against Aurion:
 * the email alone would be trivially forgeable.
 */

import { getSupabaseAdmin } from "../../supa-data/utils/supabase";

/** Admins rarely change; a short cache keeps the table read off the hot path. */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { emails: Set<string>; at: number } | null = null;

export async function isAdminEmail(email: string): Promise<boolean> {
    const now = Date.now();
    if (!cache || now - cache.at > CACHE_TTL_MS) {
        const supabaseAdmin = getSupabaseAdmin();
        // Fail closed: an unreachable Supabase or a missing table means
        // nobody is admin, never that everybody is.
        if (!supabaseAdmin) return false;
        const { data, error } = await supabaseAdmin
            .from("palantir_admins")
            .select("email");
        if (error || !data) return false;
        cache = {
            emails: new Set(
                data
                    .map((row) => (row.email ?? "").toLowerCase())
                    .filter(Boolean)
            ),
            at: now,
        };
    }
    return cache.emails.has(email.toLowerCase());
}
