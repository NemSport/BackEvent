"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AuthGuard } from "@/components/backevent/auth-guard";
import { getLocations } from "@/lib/backevent/data";
import type { Location } from "@/lib/backevent/types";

export default function PrintQrPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );

  useEffect(() => {
    getLocations().then(setLocations).catch(() => setLocations([]));
  }, []);

  return (
    <AuthGuard requiredRole="ejer">
      <main className="min-h-screen bg-macro p-6 text-ink print:p-0">
        <style jsx global>{`
          @media print {
            body {
              background: #ffffff;
            }
            .qr-page {
              break-after: page;
            }
          }
        `}</style>
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 print:mb-4">
            <h1 className="text-4xl font-bold">BackEvent QR-oversigt</h1>
            <p className="mt-2 text-lg font-medium text-muted">Scan koden ved containeren og vælg handling.</p>
          </header>
          <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
            {locations.map((location) => {
              const url = `${origin}/sted/${location.id}`;
              return (
                <section key={location.id} className="qr-page rounded-[1.5rem] border border-line bg-macro p-6 text-center shadow-sm print:shadow-none">
                  <h2 className="text-3xl font-bold text-ink">{location.name}</h2>
                  <p className="mt-2 text-base font-bold text-muted">Scan for at åbne BackEvent for dette sted</p>
                  <div className="mt-6 flex justify-center">
                    {origin ? <QRCodeSVG value={url} size={260} /> : <div className="h-64 w-64 bg-soft" />}
                  </div>
                  <p className="mt-5 break-all text-sm font-bold text-muted">{url}</p>
                </section>
              );
            })}
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
