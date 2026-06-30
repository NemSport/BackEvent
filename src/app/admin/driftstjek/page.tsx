"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { getOperationalChecklist } from "@/lib/backevent/data";
import type { OperationalChecklistItem } from "@/lib/backevent/types";

export default function AdminDriftstjekPage() {
  const [items, setItems] = useState<OperationalChecklistItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const overallStatus = useMemo(() => getOverallStatus(items), [items]);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const checklist = await getOperationalChecklist();
        if (mounted) {
          setItems(checklist);
        }
      } catch {
        if (mounted) {
          setMessage("Driftstjek kunne ikke hentes lige nu.");
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  function handleResetClick() {
    if (confirmation !== "NULSTIL") {
      setResetMessage("Skriv NULSTIL for at fortsætte.");
      return;
    }

    setResetMessage("Reset er ikke aktiv endnu. TODO: lav sikker admin-RPC med audit før markedet.");
  }

  return (
    <AppShell adminOnly>
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <h1 className="text-4xl font-bold text-ink">Driftstjek</h1>
        <p className="mt-2 text-lg font-medium text-muted">Kontrol før rigtig brug</p>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 p-4 text-lg font-bold text-warmRed">{message}</p> : null}

      <article className="mb-6 rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className={overallStatus === "Klar" ? "text-pantone140" : overallStatus === "Fejl" ? "text-warmRed" : "text-pantone140"}>
            {overallStatus === "Klar" ? <CheckCircle2 className="h-10 w-10" aria-hidden /> : <AlertTriangle className="h-10 w-10" aria-hidden />}
          </span>
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-muted">Status</p>
            <h2 className="text-3xl font-bold text-ink">{overallStatus}</h2>
          </div>
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <ChecklistCard key={item.label} item={item} />
        ))}
      </div>

      <section className="mt-10 rounded-[1.75rem] border border-warmRed/20 bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
        <div className="mb-4 flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-warmRed/10 text-warmRed">
            <ShieldAlert className="h-7 w-7" aria-hidden />
          </span>
          <div>
            <h2 className="text-2xl font-bold text-ink">Pre-event reset</h2>
            <p className="mt-1 text-base font-medium text-muted">
              Sikker nulstilling er markeret som TODO. Der slettes ikke data fra denne knap endnu.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ResetInfo text="Nulstil flytninger/historik?" />
          <ResetInfo text="Nulstil åbning/lukning?" />
          <ResetInfo text="Behold produkter/containere" />
          <ResetInfo text="Behold aktuelle lagerbalancer eller sæt startlager manuelt" />
        </div>

        <label className="mt-5 block">
          <span className="text-base font-bold text-ink">Skriv NULSTIL</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-2xl border border-line px-4 py-2 text-lg font-bold outline-none focus:border-pantone140"
          />
        </label>

        {resetMessage ? <p className="mt-4 rounded-2xl bg-soft p-4 text-base font-bold text-pantone140">{resetMessage}</p> : null}

        <div className="mt-4 max-w-sm">
          <PrimaryButton onClick={handleResetClick} disabled={confirmation !== "NULSTIL"} className="bg-warmRed text-white hover:bg-warmRed/90">
            Nulstil
          </PrimaryButton>
        </div>
      </section>
    </AppShell>
  );
}

function ChecklistCard({ item }: { item: OperationalChecklistItem }) {
  const isError = item.status === "Fejl";
  const needsCheck = item.status === "Tjek kræves";

  return (
    <article className="rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft lg:rounded-[1.5rem] lg:p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
            isError ? "bg-warmRed/10 text-warmRed" : needsCheck ? "bg-pantone139/30 text-pantone140" : "bg-green-50 text-green-700"
          }`}
        >
          {isError || needsCheck ? <AlertTriangle className="h-5 w-5" aria-hidden /> : <ClipboardCheck className="h-5 w-5" aria-hidden />}
        </span>
        <div>
          <h2 className="text-xl font-bold text-ink">{item.label}</h2>
          <p className="text-sm font-bold text-pantone140">{item.status}</p>
        </div>
      </div>
      <p className="text-base font-medium text-muted">{item.detail}</p>
    </article>
  );
}

function ResetInfo({ text }: { text: string }) {
  return <p className="rounded-2xl bg-soft px-4 py-3 text-base font-bold text-ink">{text}</p>;
}

function getOverallStatus(items: OperationalChecklistItem[]) {
  if (items.some((item) => item.status === "Fejl")) {
    return "Fejl";
  }

  if (items.some((item) => item.status === "Tjek kræves")) {
    return "Tjek kræves";
  }

  return "Klar";
}
