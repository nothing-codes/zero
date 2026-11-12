import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://cghxjqruoqzaomhwmmpi.supabase.co";
const FALLBACK_KEY = "sb_publishable_fYkiq1WLYi24b95AxpB1ig_9kyjFzL6";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
