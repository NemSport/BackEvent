"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import {
  getLocations,
  getMissingOpeningClosing,
  getOpeningClosingOverview,
} from "@/lib/backevent/data";
import type { Location, MissingOpeningClosing, OpeningClosingLocationOverview } from "@/lib/backevent/types";

export default function AdminAabningLukningPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [overview, setOverview] = useState<OpeningClosingLocationOverview[]>([]);
  const [missing, setMissing] = useState<MissingOpeningClosing[]>([]);
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [loadedLocations, loadedOverview, loadedMissing] = await Promise.all([
          getLocations(),
          getOpeningClosingOverview(date || undefined),
          getMissingOpeningClosing(date || undefined),
        ]);

        if (!mounted) {
          return;
        }

        setLocations(loadedLocations);
        setOverview(loadedOverview);
        setMissing(loadedMissing);
      } catch {
        if (mounted) {
          setMessage("Vi kunne ikke hente åbning/lukning lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [date]);

  return (
    <AppShell adminOnly>
      <div className="mb-5">
        <BackButton href="/admin" />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">Åbning/lukning</h1>
        <p className="mt-2 text-lg font-medium text-muted">Se hvilke steder der er åbnet og lukket</p>
      </section>

      <section className="mb-6 rounded-[2rem] border border-line bg-macro p-5 shadow-soft">
        <label className="block">
          <span className="text-lg font-bold text-ink">Dato</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-macro px-4 py-3 text-lg font-bold text-ink outline-none focus:border-pantone140 sm:max-w-xs"
          />
        </label>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {overview.map((item) => {
          const location = locations.find((entry) => entry.id === item.locationId);
          const missingItem = missing.find((entry) => entry.locationId === item.locationId);
          const statusCopy = getStatusCopy(item.status, missingItem);

          return (
            <article key={item.locationId} className="rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-ink">{location?.name}</h2>
                  <p className={`mt-2 text-base font-bold ${statusCopy.urgent ? "text-warmRed" : "text-pantone140"}`}>
                    {statusCopy.label}
                  </p>
                </div>
                <Link
                  href={`/admin/rapport?location=${item.locationId}${date ? `&date=${date}` : ""}`}
                  className="inline-flex min-h-11 items-center rounded-2xl border border-line bg-macro px-4 py-2 text-base font-bold text-pantone140"
                >
                  Detaljer
                </Link>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <StatusBox
                  title="Seneste åbning"
                  value={item.latestOpening ? formatDate(item.latestOpening.createdAt) : "Mangler åbning"}
                  name={item.latestOpening?.createdBy}
                  urgent={!item.latestOpening}
                />
                <StatusBox
                  title="Seneste lukning"
                  value={item.latestClosing ? formatDate(item.latestClosing.createdAt) : "Mangler lukning"}
                  name={item.latestClosing?.createdBy}
                  urgent={!item.latestClosing}
                />
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}

function StatusBox({
  title,
  value,
  name,
  urgent = false,
}: {
  title: string;
  value: string;
  name?: string;
  urgent?: boolean;
}) {
  return (
    <div className={`rounded-3xl p-4 ${urgent ? "bg-warmRed/10" : "bg-soft"}`}>
      <p className="text-sm font-bold uppercase tracking-wide text-pantone140">{title}</p>
      <p className={`mt-1 text-lg font-bold ${urgent ? "text-warmRed" : "text-ink"}`}>{value}</p>
      {name ? <p className="mt-1 text-sm font-bold text-muted">{name}</p> : null}
    </div>
  );
}

function getStatusCopy(
  status: OpeningClosingLocationOverview["status"],
  missing?: MissingOpeningClosing,
) {
  if (missing?.missingOpening) {
    return { label: "Mangler åbning", urgent: true };
  }

  if (missing?.missingClosing) {
    return { label: "Mangler lukning", urgent: true };
  }

  if (status === "closed") {
    return { label: "Lukket", urgent: false };
  }

  if (status === "opened") {
    return { label: "Åbnet", urgent: false };
  }

  if (status === "missing_closing") {
    return { label: "Mangler lukning", urgent: true };
  }

  return { label: "Ikke startet", urgent: true };
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}
