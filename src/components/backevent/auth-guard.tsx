"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { hasRoleAtLeast, type BackEventRole } from "@/lib/backevent/permissions";
import { PushOnboardingPrompt } from "./push-onboarding";
import { ButtonLink, Card } from "./ui";

export function AuthGuard({
  children,
  adminOnly = false,
  requiredRole,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  requiredRole?: BackEventRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, isAuthenticated, isMock, profile } = useBackEventAuth();
  const isPublicAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/logout");
  const authState = loading ? "loading" : isMock || isAuthenticated ? "authenticated" : "unauthenticated";
  const minimumRole = requiredRole ?? (adminOnly ? "ansvarlig" : "frivillig");

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

  if (!hasRoleAtLeast(profile?.role, minimumRole)) {
    return <AccessMessage title="Du har ikke adgang" href="/" action="Gå til Start" />;
  }

  return (
    <>
      {children}
      <PushOnboardingPrompt />
    </>
  );
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
      <section className="mx-auto max-w-xl">
        <Card className="border-transparent bg-soft p-6 text-center shadow-soft">
          <h1 className="text-3xl font-bold text-ink">{title}</h1>
          <ButtonLink href={href} tone="primary" className="mt-6 w-auto">
            {action}
          </ButtonLink>
        </Card>
      </section>
    </main>
  );
}
