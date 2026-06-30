"use client";

import Link from "next/link";
import { DoorClosed, DoorOpen, History, MapPin, PackageSearch, Repeat, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AuthGuard } from "@/components/backevent/auth-guard";
import { useBackEventAuth } from "@/lib/backevent/auth";

const volunteerActions = [
  {
    href: "/flyt",
    title: "Flyt varer",
    description: "Send kasser videre",
    icon: Repeat,
  },
  {
    href: "/lagerstatus",
    title: "Se lagerstatus",
    description: "Se hvad der er på lager",
    icon: PackageSearch,
  },
  {
    href: "/aabning",
    title: "Åbn container/bar",
    description: "Tæl lageret ved start",
    icon: DoorOpen,
  },
  {
    href: "/lukning",
    title: "Luk container/bar",
    description: "Gem tal ved lukning",
    icon: DoorClosed,
  },
  {
    href: "/historik",
    title: "Historik",
    description: "Se seneste handlinger",
    icon: History,
  },
  {
    href: "/steder",
    title: "Container/bar links",
    description: "Åbn direkte ved et sted",
    icon: MapPin,
  },
];

export default function VolunteerHomePage() {
  const { isAdmin, isMock } = useBackEventAuth();

  return (
    <AuthGuard>
      <main className="min-h-screen px-4 py-5 sm:px-6 lg:py-6">
        <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-4xl flex-col lg:min-h-0">
          <header className="rounded-[2rem] bg-pantone139 px-5 py-7 text-ink shadow-soft sm:px-8 sm:py-9 lg:rounded-[1.5rem] lg:px-6 lg:py-5">
            <p className="text-4xl font-bold leading-tight sm:text-5xl lg:text-4xl">BackEvent</p>
            <p className="mt-2 text-lg font-medium text-pantone140 lg:text-base">Backend for events, barer og beholdning</p>
            {isMock ? <p className="mt-3 inline-flex rounded-full bg-macro px-3 py-1 text-sm font-bold text-pantone140">Mock mode</p> : null}
          </header>

          <section className="flex flex-1 flex-col justify-center py-8 sm:py-10 lg:justify-start lg:py-8">
            <div className="mb-6">
              <h1 className="text-4xl font-bold text-ink sm:text-5xl lg:text-4xl">Hvad skal du?</h1>
              <p className="mt-2 text-lg font-medium text-muted lg:text-base">Vælg den opgave du står med lige nu</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:gap-5">
              {volunteerActions.map((action) => (
                <VolunteerActionCard key={action.href} {...action} />
              ))}
            </div>

            {isAdmin ? (
              <Link
                href="/admin"
                className="mt-6 flex min-h-20 items-center gap-4 rounded-[1.5rem] border border-line bg-macro p-4 shadow-sm transition hover:border-pantone139"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-soft text-pantone140">
                  <ShieldCheck className="h-6 w-6" aria-hidden />
                </span>
                <span>
                  <span className="block text-lg font-bold text-ink">Ansvarlig?</span>
                  <span className="block text-base font-medium text-muted">Gå til admin-overblik</span>
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
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-36 items-center gap-4 rounded-[1.75rem] bg-macro p-5 shadow-soft transition hover:-translate-y-0.5 hover:bg-soft lg:min-h-28 lg:p-4"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-pantone139 text-pantone140 lg:h-12 lg:w-12 lg:rounded-2xl">
        <Icon className="h-8 w-8 lg:h-6 lg:w-6" aria-hidden />
      </span>
      <span>
        <span className="block text-2xl font-bold text-ink lg:text-xl">{title}</span>
        <span className="mt-1 block text-lg font-medium text-muted lg:text-base">{description}</span>
      </span>
    </Link>
  );
}
