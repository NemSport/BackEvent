import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasRoleAtLeast, isOwnerRole } from "./permissions";
import { canTreatReceiptControl } from "./return-control-contract";

export type ReturnAccess =
  | {
      ok: true;
      supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>> | null;
      userId: string;
      userEmail: string | null;
      profileRole: string | null;
      isOwner: boolean;
      canControl: boolean;
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
        financeGroup: boolean;
      };
    };

export async function requireReturnAccess(request: Request): Promise<ReturnAccess> {
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      supabase: null,
      userId: "mock-user",
      userEmail: "mock@backevent.local",
      profileRole: "ejer",
      isOwner: true,
      canControl: true,
    };
  }

  const accessToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return denied(401, "Du skal være logget ind", false, null, null, null, false);
  }

  const supabase = createSupabaseServerClient(accessToken);
  if (!supabase) {
    return denied(401, "Du skal være logget ind", false, null, null, null, false);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser(accessToken);

  if (!user) {
    return denied(401, "Du skal være logget ind", false, null, null, null, false);
  }

  const { data: profile } = await supabase.from("backevent_profiles").select("role,active").eq("id", user.id).maybeSingle();
  const financeGroup = await isFinanceGroupMember(supabase, user.id);
  const active = profile?.active === true;
  const role = profile?.role ?? null;
  const canRead = active && (hasRoleAtLeast(role, "ansvarlig") || financeGroup);

  if (!canRead) {
    return denied(403, "Du har ikke adgang", true, user.email ?? null, role, profile?.active ?? null, financeGroup);
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    userEmail: user.email ?? null,
    profileRole: role,
    isOwner: isOwnerRole(role),
    canControl: canTreatReceiptControl(isOwnerRole(role), financeGroup),
  };
}


async function isFinanceGroupMember(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  const { data } = await supabase
    .from("backevent_member_group_members")
    .select("group_id, backevent_member_groups!inner(name,active)")
    .eq("profile_id", userId)
    .eq("backevent_member_groups.active", true)
    .ilike("backevent_member_groups.name", "Økonomiansvarlige")
    .limit(1);

  return Boolean(data?.length);
}

function denied(
  status: 401 | 403,
  message: string,
  hasUser: boolean,
  userEmail: string | null,
  profileRole: string | null,
  profileActive: boolean | null,
  financeGroup: boolean,
): ReturnAccess {
  return {
    ok: false,
    status,
    message,
    debug: { hasUser, userEmail, profileRole, profileActive, financeGroup },
  };
}
