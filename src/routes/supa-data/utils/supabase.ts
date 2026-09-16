import { createClient } from "@supabase/supabase-js";

import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        "Missing required environment variables: SUPABASE_URL and SUPABASE_KEY"
    );
}

export const pfpUrl =
    "https://vjueuqojbmhwwryhxqwn.supabase.co/storage/v1/object/public/pfp/";

export const supabase = createClient(supabaseUrl, supabaseKey);

// Tables holding personal data (e.g. colles_students) sit behind RLS with no
// anon policy: the anon/publishable key above can't read them by design, and
// no RLS policy could safely change that (it's the same key for everyone who
// has it). Only the private service_role key — never client-exposed, always
// bypasses RLS — is allowed to read them.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;
