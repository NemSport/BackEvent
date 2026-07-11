"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export async function getBrowserAccessToken() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
