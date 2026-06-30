"use client";

import { Download, FileArchive, History, PackageSearch, ScrollText } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import {
  exportFullBackupCsv,
  exportMovementsCsv,
  exportOpeningClosingCsv,
  exportStockCsv,
} from "@/lib/backevent/data";

const exportActions = [
  {
    title: "Eksporter lagerstatus",
    description: "Aktuelle beholdninger pr. container og vare",
    filenamePrefix: "backevent-lagerstatus",
    icon: PackageSearch,
    loadCsv: exportStockCsv,
  },
  {
    title: "Eksporter historik",
    description: "Flytninger, rettelser og svind",
    filenamePrefix: "backevent-historik",
    icon: History,
    loadCsv: exportMovementsCsv,
  },
  {
    title: "Eksporter åbning/lukning",
    description: "Gemte optællinger med varelinjer",
    filenamePrefix: "backevent-aabning-lukning",
    icon: ScrollText,
    loadCsv: exportOpeningClosingCsv,
  },
  {
    title: "Eksporter alt",
    description: "Samlet backup med lager, historik og rapport",
    filenamePrefix: "backevent-backup",
    icon: FileArchive,
    loadCsv: exportFullBackupCsv,
  },
];

export default function AdminEksportPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function handleExport(action: (typeof exportActions)[number]) {
    setBusyAction(action.title);
    setMessage(null);

    try {
      const csv = await action.loadCsv();
      downloadCsv(`${action.filenamePrefix}-${todayStamp()}.csv`, csv);
      setMessage("CSV hentet");
    } catch {
      setMessage("Eksport kunne ikke hentes lige nu.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppShell adminOnly>
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <h1 className="text-4xl font-bold text-ink">Eksport</h1>
        <p className="mt-2 text-lg font-medium text-muted">Hent CSV til kontrol og backup</p>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-lg font-bold text-pantone140">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {exportActions.map((action) => (
          <article key={action.title} className="rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
            <div className="mb-4 flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pantone139 text-pantone140 lg:h-11 lg:w-11 lg:rounded-xl">
                <action.icon className="h-7 w-7 lg:h-5 lg:w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-xl font-bold text-ink">{action.title}</h2>
                <p className="mt-1 text-base font-medium text-muted">{action.description}</p>
              </div>
            </div>
            <PrimaryButton onClick={() => handleExport(action)} disabled={busyAction !== null}>
              <span className="inline-flex items-center justify-center gap-2">
                <Download className="h-5 w-5" aria-hidden />
                {busyAction === action.title ? "Henter..." : action.title}
              </span>
            </PrimaryButton>
          </article>
        ))}
      </div>
    </AppShell>
  );
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}
