import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasRoleAtLeast, type BackEventRole } from "./permissions";

export type BackEventApiAuth =
  | {
      ok: true;
      accessToken: string | null;
      supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>> | null;
      userId: string;
      userEmail: string | null;
      profileRole: string | null;
      profileActive: boolean | null;
    }
  | {
      ok: false;
      status: 401 | 403;
      message: string;
      debug: {
        hasUser: boolean;
        userEmail: string | null;
        profileRole: string | null;
        profileActive: boolean | null;
      };
    };

export async function requireBackEventRole(request: Request, minimumRole: BackEventRole): Promise<BackEventApiAuth> {
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      accessToken: null,
      supabase: null,
      userId: "mock-user",
      userEmail: "mock@backevent.local",
      profileRole: "ejer",
      profileActive: true,
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message: "Du skal være logget ind",
      debug: {
        hasUser: false,
        userEmail: null,
        profileRole: null,
        profileActive: null,
      },
    };
  }

  const supabase = createSupabaseServerClient(accessToken);

  if (!supabase) {
    return {
      ok: false,
      status: 401,
      message: "Du skal være logget ind",
      debug: {
        hasUser: false,
        userEmail: null,
        profileRole: null,
        profileActive: null,
      },
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      ok: false,
      status: 401,
      message: "Du skal være logget ind",
      debug: {
        hasUser: Boolean(user),
        userEmail: user?.email ?? null,
        profileRole: null,
        profileActive: null,
      },
    };
  }

  const { data: profile } = await supabase.from("backevent_profiles").select("role,active").eq("id", user.id).maybeSingle();

  if (!profile?.active || !hasRoleAtLeast(profile.role, minimumRole)) {
    return {
      ok: false,
      status: 403,
      message: minimumRole === "ejer" ? "Kun ejer kan gøre dette" : "Du har ikke adgang",
      debug: {
        hasUser: true,
        userEmail: user.email ?? null,
        profileRole: profile?.role ?? null,
        profileActive: profile?.active ?? null,
      },
    };
  }

  return {
    ok: true,
    accessToken,
    supabase,
    userId: user.id,
    userEmail: user.email ?? null,
    profileRole: profile.role ?? null,
    profileActive: profile.active ?? null,
  };
}
