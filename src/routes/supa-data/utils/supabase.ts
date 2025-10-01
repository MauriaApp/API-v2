import { createClient } from '@supabase/supabase-js';

import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing required environment variables: SUPABASE_URL and SUPABASE_KEY'
  );
}

export const pfpUrl =
  'https://vjueuqojbmhwwryhxqwn.supabase.co/storage/v1/object/public/pfp/';

export const supabase = createClient(supabaseUrl, supabaseKey);
