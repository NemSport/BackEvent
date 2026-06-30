"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { LocationCard } from "@/components/backevent/location-card";
import { getLocations } from "@/lib/backevent/data";
import type { Location } from "@/lib/backevent/types";

export default function StederPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const loadedLocations = await getLocations();

        if (mounted) {
          setLocations(loadedLocations);
        }
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente stederne lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AppShell>
      <div className="mb-5">
        <BackButton />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Hvor er du?</h1>
        <p className="mt-2 text-lg font-medium text-muted">Vælg stedet du arbejder ved</p>
      </section>
      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {locations.map((location) => (
          <LocationCard key={location.id} location={location} href="/lagerstatus" />
        ))}
      </div>
    </AppShell>
  );
}
