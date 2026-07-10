"use client";

import Link from "next/link";
import { Copy, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getLocations } from "@/lib/backevent/data";
import type { Location } from "@/lib/backevent/types";

export default function AdminQrPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const origin = useBrowserOrigin();

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
          setMessage("Vi kunne ikke hente QR-links lige nu. Prøv igen om lidt.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  async function copyLink(location: Location) {
    const url = `${origin}/qr/flyt/${location.id}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(location.id);
  }

  return (
    <AppShell requiredRole="ejer">
      <div className="mb-5">
        <BackButton href="/admin" />
      </div>
      <section className="mb-6 rounded-[2rem] bg-soft p-6 shadow-soft">
        <h1 className="text-4xl font-bold text-ink">QR-koder</h1>
        <p className="mt-2 text-lg font-medium text-muted">Direkte links til hver container og bar</p>
      </section>

      <Link
        href="/admin/print/qr"
        className="mb-6 inline-flex min-h-14 items-center gap-2 rounded-2xl bg-pantone139 px-5 py-4 text-lg font-bold text-ink shadow-soft"
      >
        <Printer className="h-5 w-5" aria-hidden />
        Print QR-oversigt
      </Link>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {locations.map((location) => {
          const url = `${origin}/qr/flyt/${location.id}`;
          return (
            <article key={location.id} className="rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft">
              <div className="flex gap-4">
                <div className="rounded-2xl bg-macro p-2">
                  {origin ? <QRCodeSVG value={url} size={112} /> : <div className="h-28 w-28 rounded-xl bg-soft" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold text-ink">{location.name}</h2>
                  <p className="mt-2 break-all text-sm font-bold text-muted">{url}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={`/qr/flyt/${location.id}`}
                      className="inline-flex min-h-11 items-center rounded-2xl border border-line bg-macro px-4 py-2 text-base font-bold text-pantone140"
                    >
                      Åbn link
                    </Link>
                    <button
                      type="button"
                      onClick={() => copyLink(location)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-pantone139 px-4 py-2 text-base font-bold text-ink"
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                      {copiedId === location.id ? "Kopieret" : "Kopier link"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}

function useBrowserOrigin() {
  return useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );
}
