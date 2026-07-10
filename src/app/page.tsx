"use client";

import Link from "next/link";
import { DoorClosed, DoorOpen, History, MapPin, PackageSearch, Repeat, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AuthGuard } from "@/components/backevent/auth-guard";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { hasRoleAtLeast, type BackEventRole } from "@/lib/backevent/permissions";

const volunteerActions = [
  {
    href: "/flyt",
    title: "Flyt varer",
    description: "Send kasser videre",
    icon: Repeat,
    minRole: "frivillig",
  },
  {
    href: "/aabning",
    title: "Åbn",
    description: "Tæl ved start",
    icon: DoorOpen,
    minRole: "frivillig",
  },
  {
    href: "/lukning",
    title: "Luk",
    description: "Gem tal ved lukning",
    icon: DoorClosed,
    minRole: "frivillig",
  },
  {
    href: "/steder",
    title: "Sted",
    description: "Åbn direkte link",
    icon: MapPin,
    minRole: "frivillig",
  },
  {
    href: "/lagerstatus",
    title: "Lager",
    description: "Se beholdning",
    icon: PackageSearch,
    minRole: "ansvarlig",
  },
  {
    href: "/historik",
    title: "Historik",
    description: "Seneste handlinger",
    icon: History,
    minRole: "ansvarlig",
  },
] satisfies Array<{ href: string; title: string; description: string; icon: LucideIcon; minRole: BackEventRole }>;

export default function VolunteerHomePage() {
  const { isAdmin, isMock, profile } = useBackEventAuth();
  const visibleActions = volunteerActions.filter((action) => hasRoleAtLeast(profile?.role, action.minRole));

  return (
    <AuthGuard>
      <main className="min-h-screen px-4 py-5 sm:px-6 lg:py-6">
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-4xl flex-col lg:min-h-0">
          <header className="rounded-3xl bg-pantone139 px-5 py-6 text-ink shadow-soft sm:px-7 sm:py-8 lg:rounded-2xl lg:px-6 lg:py-5">
            <p className="text-4xl font-bold leading-tight sm:text-5xl lg:text-4xl">BackEvent</p>
            <p className="mt-2 text-lg font-medium text-pantone140 lg:text-base">Backend for events, barer og beholdning</p>
            {isMock ? <p className="mt-3 inline-flex rounded-full bg-macro px-3 py-1 text-sm font-bold text-pantone140">Mock mode</p> : null}
          </header>

          <section className="flex flex-1 flex-col justify-center py-7 sm:py-9 lg:justify-start lg:py-7">
            <div className="mb-6">
              <h1 className="text-4xl font-bold text-ink sm:text-5xl lg:text-4xl">Hvad skal du?</h1>
              <p className="mt-2 text-lg font-medium text-muted lg:text-base">Vælg den opgave du står med lige nu</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:gap-4">
              {visibleActions.map((action, index) => (
                <VolunteerActionCard key={action.href} {...action} primary={index === 0} />
              ))}
            </div>

            {isAdmin ? (
              <Link
                href="/admin"
                className="mt-5 flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-macro p-3 shadow-sm transition hover:border-pantone139 focus:outline-none focus:ring-2 focus:ring-pantone139/60"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-soft text-pantone140">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-base font-bold text-ink">Ansvarlig?</span>
                  <span className="block text-sm font-medium text-muted">Gå til admin-overblik</span>
                </span>
              </Link>
            ) : null}
          </section>
        </div>
      </main>
    </AuthGuard>
  );
}

function VolunteerActionCard({
  href,
  title,
  description,
  icon: Icon,
  primary = false,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-28 items-center gap-3 rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus:ring-2 focus:ring-pantone139/60 lg:min-h-24 lg:px-4 lg:py-3 ${
        primary ? "border-pantone139 bg-pantone139/85" : "border-line bg-macro hover:border-pantone139"
      }`}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-pantone140 lg:h-10 lg:w-10 ${primary ? "bg-macro/70" : "bg-pantone139/35"}`}>
        <Icon className="h-6 w-6 lg:h-5 lg:w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-xl font-bold text-ink lg:text-base">{title}</span>
        <span className="mt-0.5 block text-base font-medium text-muted lg:text-sm">{description}</span>
      </span>
    </Link>
  );
}
