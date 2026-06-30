"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBackEventAuth } from "@/lib/backevent/auth";

export function AuthGuard({
  children,
  adminOnly = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, isAuthenticated, isAdmin, isMock } = useBackEventAuth();
  const isPublicAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/logout");
  const authState = loading ? "loading" : isMock || isAuthenticated ? "authenticated" : "unauthenticated";

  useEffect(() => {
    if (!isPublicAuthRoute && authState === "unauthenticated") {
      router.replace("/login");
    }
  }, [authState, isPublicAuthRoute, router]);

  if (isPublicAuthRoute) {
    return <>{children}</>;
  }

  if (authState === "loading") {
    return <LoadingAccess />;
  }

  if (authState === "unauthenticated") {
    return <AccessMessage title="Du skal logge ind" href="/login" action="Gå til login" />;
  }

  if (adminOnly && !isAdmin) {
    return <AccessMessage title="Du har ikke adgang" href="/" action="Gå til Start" />;
  }

  return <>{children}</>;
}

function LoadingAccess() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="flex items-center gap-3 text-sm font-bold text-muted">
        <span className="h-3 w-3 animate-pulse rounded-full bg-pantone139" aria-hidden />
        Henter adgang...
      </div>
    </main>
  );
}

function AccessMessage({ title, href, action }: { title: string; href: string; action: string }) {
  return (
    <main className="min-h-screen px-4 py-8">
      <section className="mx-auto max-w-xl rounded-[2rem] bg-soft p-6 text-center shadow-soft">
        <h1 className="text-4xl font-bold text-ink">{title}</h1>
        <Link
          href={href}
          className="mt-6 inline-flex min-h-14 items-center rounded-2xl bg-pantone139 px-5 py-4 text-lg font-bold text-ink"
        >
          {action}
        </Link>
      </section>
    </main>
  );
}
