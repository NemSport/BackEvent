"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { hasPermission, isOwnerRole, isResponsibleRole, normalizeRole, type BackEventPermissionKey, type BackEventRole } from "./permissions";
export type { BackEventPermissionKey, BackEventRole } from "./permissions";

export type BackEventProfile = {
  id: string;
  fullName: string | null;
  email: string | null;
  role: BackEventRole;
  active: boolean;
  permissions: BackEventPermissionKey[];
  isMock: boolean;
};

const mockProfile: BackEventProfile = {
  id: "mock-user",
  fullName: "Mock mode",
  email: null,
  role: "ejer",
  active: true,
  permissions: [],
  isMock: true,
};

export function isMockMode() {
  return !isSupabaseConfigured();
}

export async function getCurrentProfile(): Promise<BackEventProfile | null> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockProfile;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [{ data }, permissionsResponse] = await Promise.all([
    supabase
    .from("backevent_profiles")
    .select("id,full_name,role,active")
    .eq("id", user.id)
      .single(),
    supabase.from("backevent_profile_permissions").select("permission_key,enabled").eq("profile_id", user.id).eq("enabled", true),
  ]);

  return {
    id: user.id,
    fullName: data?.full_name ?? user.email ?? null,
    email: user.email ?? null,
    role: normalizeRole(data?.role),
    active: data?.active ?? true,
    permissions: (permissionsResponse.data ?? []).map((row) => row.permission_key as BackEventPermissionKey),
    isMock: false,
  };
}

export async function getCurrentActorName() {
  const profile = await getCurrentProfile();
  return profile?.fullName || profile?.email || "Ukendt";
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return mockProfile;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  return getCurrentProfile();
}

export async function getCurrentUser() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return user;
}

export async function signUpWithPassword(fullName: string, email: string, password: string) {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return { profile: mockProfile, needsEmailConfirmation: false };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    throw error;
  }

  if (data.user && data.session) {
    const { error: profileError } = await supabase
      .from("backevent_profiles")
      .upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: "frivillig",
        active: true,
      })
      .select("id")
      .maybeSingle();

    if (profileError) {
      console.warn("BackEvent profile upsert skipped", profileError);
    }
  }

  return {
    profile: data.session ? await getCurrentProfile() : null,
    needsEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function signOut() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    throw error;
  }
}

export function useBackEventAuth() {
  const mockMode = isMockMode();
  const [profile, setProfile] = useState<BackEventProfile | null>(mockMode ? mockProfile : null);
  const [loading, setLoading] = useState(!mockMode);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let mounted = true;
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }
    const client = supabase;

    async function loadProfile() {
      try {
        const currentUser = await getCurrentUser();
        const currentProfile = await getCurrentProfile();

        if (mounted) {
          setUser(currentUser);
          setProfile(currentProfile);
          setLoading(false);
        }
      } catch {
        if (mounted) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    }

    loadProfile();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        if (!session?.user) {
          if (mounted) {
            setUser(null);
            setProfile(null);
            setLoading(false);
          }
          return;
        }

        loadProfile();
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    profile,
    user,
    loading,
    isMock: isMockMode(),
    isAdmin: isResponsibleRole(profile?.role),
    isResponsible: isResponsibleRole(profile?.role),
    isOwner: isOwnerRole(profile?.role),
    can: (permission: BackEventPermissionKey) => hasPermission(profile?.role, profile?.permissions, permission),
    isAuthenticated: Boolean(profile),
  };
}
