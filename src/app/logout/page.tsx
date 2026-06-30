"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LogoutPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;
    const timeoutId = setTimeout(() => {
      router.replace("/login");
    }, 2000);

    async function logout() {
      try {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
          if (signOutError) {
            throw signOutError;
          }
        }

        clearAuthStorage();
        clearTimeout(timeoutId);
        router.replace("/login");
      } catch (caughtError) {
        console.error("BackEvent logout failed", caughtError);
        clearAuthStorage();
        setError("Kunne ikke logge ud");
        clearTimeout(timeoutId);
        setTimeout(() => router.replace("/login"), 1000);
      }
    }

    logout();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-md rounded-[2rem] bg-macro p-6 text-center shadow-soft">
        <h1 className="text-3xl font-bold text-ink">{error ?? "Logger ud..."}</h1>
        <Link
          href="/login"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl border border-line bg-macro px-5 py-3 text-base font-bold text-pantone140"
        >
          Gå til login
        </Link>
      </section>
    </main>
  );
}

function clearAuthStorage() {
  if (typeof window === "undefined") {
    return;
  }

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith("sb-") || key?.includes("supabase")) {
        storage.removeItem(key);
      }
    }
  }
}
