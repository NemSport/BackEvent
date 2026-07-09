"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getAdminSetupStatus } from "@/lib/backevent/data";
import type { AdminSetupStatus } from "@/lib/backevent/types";

const links = [
  { href: "/admin/produkter", label: "Gå til produkter" },
  { href: "/admin/containere", label: "Gå til steder" },
  { href: "/admin/eksport", label: "Gå til eksport" },
  { href: "/admin/driftstjek", label: "Gå til driftstjek" },
];

export default function AdminSetupPage() {
  const [status, setStatus] = useState<AdminSetupStatus | null>(null);

  useEffect(() => {
    getAdminSetupStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <AppShell requiredRole="ejer">
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <h1 className="text-4xl font-bold text-ink">Setup</h1>
        <p className="mt-2 text-lg font-medium text-muted">Kontrol før markedet</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Produkter" value={status?.productCount} />
        <Metric title="Containere" value={status?.locationCount} />
        <Metric title="Lagerlinjer" value={status?.stockBalanceCount} />
        <Metric title="Flytninger" value={status?.movementCount} />
        <Metric title="Åbninger/lukninger" value={status?.openingClosingCount} />
        <Metric title="Supabase" value={status?.supabaseConnected ? "Connected" : "Mock mode"} />
        <Metric title="Auth" value={status?.authStatus ?? "-"} />
        <Metric title="RLS" value={status?.rlsStatus ?? "unknown"} />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="min-h-14 rounded-2xl bg-pantone139 px-5 py-4 text-center text-lg font-bold text-ink shadow-soft md:min-h-11 md:px-4 md:py-2.5 md:text-base">
            {link.label}
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

function Metric({ title, value }: { title: string; value?: string | number }) {
  return (
    <article className="rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-3xl font-bold text-pantone140">{value ?? "-"}</p>
    </article>
  );
}
