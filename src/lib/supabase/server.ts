import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./is-configured";

export function createSupabaseServerClient(accessToken?: string) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
