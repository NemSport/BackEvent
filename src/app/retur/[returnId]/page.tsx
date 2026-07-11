"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton, PrimaryButton } from "@/components/backevent/buttons";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";

type ReturnDetail = {
  id: string;
  receipt_number: string | null;
  onlinepos_transaction_id: string | null;
  onlinepos_returned_at: string | null;
  created_at: string;
  total_amount: number;
  processing_status: string;
  control_status: string;
  control_reasons: string[];
  suspicion_flags: string[];
  locationName: string;
};

type ReturnLine = {
  id: string;
  product_description: string;
  returned_quantity: number;
  unit: string | null;
  line_amount: number;
  return_handling: string;
  processing_status: string;
  error_message: string | null;
  calculated_stock_quantity: number;
};

type HistoryLine = {
  id: string;
  action: string;
  actor_name: string | null;
  created_at: string;
  error_message: string | null;
};

type DetailResponse = {
  ok?: boolean;
  message?: string;
  canControl?: boolean;
  return?: ReturnDetail;
  lines?: ReturnLine[];
  history?: HistoryLine[];
};

export default function ReturDetailPage() {
  const params = useParams<{ returnId: string }>();
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  async function load() {
    const token = await getBrowserAccessToken();
    const response = await fetch(`/api/returns/${params.returnId}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    const json = (await response.json().catch(() => null)) as DetailResponse | null;
    setData(json ?? { ok: false, message: "Retur kunne ikke hentes" });
  }

  useEffect(() => {
    let mounted = true;
    async function loadInitial() {
      const token = await getBrowserAccessToken();
      const response = await fetch(`/api/returns/${params.returnId}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = (await response.json().catch(() => null)) as DetailResponse | null;
      if (mounted) {
        setData(json ?? { ok: false, message: "Retur kunne ikke hentes" });
      }
    }
    loadInitial();
    return () => {
      mounted = false;
    };
  }, [params.returnId]);

  async function action(path: "review" | "reprocess", body: Record<string, unknown> = {}) {
    setLoadingAction(path);
    const token = await getBrowserAccessToken();
    const response = await fetch(`/api/returns/${params.returnId}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    setLoadingAction(null);
    if (!json?.ok) {
      setMessage(json?.message ?? "Handlingen fejlede");
      return;
    }
    setMessage("Gemt");
    await load();
  }

  const item = data?.return;

  return (
    <AppShell>
      <BackButton href="/retur" />
      {!data?.ok ? (
        <section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft">
          <h1 className="text-3xl font-bold text-ink">Retur</h1>
          <p className="mt-2 text-base font-bold text-warmRed">{data?.message ?? "Henter retur..."}</p>
        </section>
      ) : null}

      {item ? (
        <>
          <section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-ink">Retur {item.receipt_number ? `#${item.receipt_number}` : ""}</h1>
                <p className="mt-2 text-base font-bold text-muted">{item.locationName} · {formatDate(item.onlinepos_returned_at ?? item.created_at)}</p>
                <p className="mt-1 text-sm font-bold text-muted">OnlinePOS: {item.onlinepos_transaction_id ?? "Mangler"}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-muted">Beløb</p>
                <p className="text-2xl font-bold text-ink">{Math.abs(Number(item.total_amount ?? 0)).toLocaleString("da-DK", { maximumFractionDigits: 2 })} kr.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge label={statusLabel(item.processing_status)} tone={item.processing_status === "processed" ? "success" : item.processing_status === "processing_failed" ? "critical" : "warning"} />
              <Badge label={item.control_status === "open" ? "Kontrol åben" : item.control_status === "reviewed" ? "Kontrolleret" : "Ingen kontrol"} tone={item.control_status === "open" ? "critical" : "neutral"} />
            </div>
          </section>

          {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-sm font-bold text-pantone140">{message}</p> : null}

          {item.control_reasons.length > 0 || item.suspicion_flags.length > 0 ? (
            <section className="mb-5 rounded-[1.5rem] border border-warmRed/30 bg-macro p-4 shadow-sm">
              <h2 className="text-lg font-bold text-warmRed">Kontrolårsager</h2>
              <ul className="mt-2 space-y-1 text-sm font-bold text-ink">
                {[...item.control_reasons, ...item.suspicion_flags].map((reason) => <li key={reason}>• {reason}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
            <div className="border-b border-line bg-soft px-4 py-3">
              <h2 className="text-lg font-bold text-ink">Linjer</h2>
            </div>
            <div className="divide-y divide-line">
              {(data.lines ?? []).map((line) => (
                <article key={line.id} className="grid gap-2 px-4 py-3 text-sm font-medium text-ink md:grid-cols-[1fr_0.45fr_0.5fr_0.65fr_0.7fr] md:items-center">
                  <div>
                    <p className="font-bold">{line.product_description}</p>
                    <p className="text-xs font-bold text-muted">{lineCategory(line)}</p>
                    {line.error_message ? <p className="text-xs font-bold text-warmRed">{line.error_message}</p> : null}
                  </div>
                  <span>{formatQty(line.returned_quantity, line.unit)}</span>
                  <span>{Math.abs(line.line_amount).toLocaleString("da-DK", { maximumFractionDigits: 2 })} kr.</span>
                  <span>{handlingLabel(line.return_handling)}</span>
                  <span className="font-bold text-pantone140">{statusLabel(line.processing_status)}</span>
                </article>
              ))}
            </div>
          </section>

          {data.canControl ? (
            <section className="mt-5 rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
              <h2 className="text-lg font-bold text-ink">Ejerkontrol</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                <PrimaryButton onClick={() => action("review", { action: "reviewed" })} disabled={loadingAction !== null}>{loadingAction === "review" ? "Gemmer..." : "Marker kontrolleret"}</PrimaryButton>
                <button type="button" onClick={() => action("review", { action: "reopen" })} disabled={loadingAction !== null} className="min-h-11 rounded-2xl border border-line px-4 py-2 font-bold text-pantone140">Genåbn</button>
                <button type="button" onClick={() => action("reprocess")} disabled={loadingAction !== null} className="min-h-11 rounded-2xl bg-soft px-4 py-2 font-bold text-pantone140">Behandl igen</button>
                <button type="button" onClick={() => router.push("/retur/kontrol")} className="min-h-11 rounded-2xl bg-soft px-4 py-2 font-bold text-pantone140">Åben kontrol</button>
              </div>
            </section>
          ) : null}

          <section className="mt-5 rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
            <h2 className="text-lg font-bold text-ink">Historik</h2>
            <div className="mt-3 space-y-2">
              {(data.history ?? []).map((entry) => (
                <div key={entry.id} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-ink">
                  {historyLabel(entry.action)} · {formatDate(entry.created_at)}
                  {entry.actor_name ? <span className="text-muted"> · {entry.actor_name}</span> : null}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "critical" | "neutral" }) {
  const className = tone === "success" ? "bg-green-100 text-green-800" : tone === "critical" ? "bg-warmRed text-macro" : tone === "warning" ? "bg-pantone139 text-ink" : "bg-soft text-muted";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>{label}</span>;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    registered: "Registreret",
    processing: "Behandles",
    processed: "Behandlet",
    requires_review: "Kræver kontrol",
    processing_failed: "Fejlet",
    duplicate: "Dublet",
    returned_to_stock: "Tilbage på lager",
    waste_registered: "Svind registreret",
    no_stock_effect: "Ingen lagerpåvirkning",
    failed: "Fejlet",
  };
  return labels[status] ?? status;
}

function handlingLabel(value: string) {
  if (value === "waste") return "Svind";
  if (value === "return_to_stock") return "Til lager";
  if (value === "no_stock_effect") return "Ingen lager";
  return "Manuel kontrol";
}

function lineCategory(line: ReturnLine) {
  if (line.return_handling === "waste") return "Svind";
  if (line.return_handling === "return_to_stock") return `Lagt tilbage på lager: ${formatQty(line.calculated_stock_quantity, line.unit)}`;
  if (line.return_handling === "no_stock_effect") return "Pant/krus/gebyr eller ingen lagerpåvirkning";
  return "Kræver manuel kontrol";
}

function historyLabel(value: string) {
  if (value === "registered") return "Registreret";
  if (value === "return_to_stock") return "Lagt tilbage på lager";
  if (value === "waste_registered") return "Svind registreret";
  if (value === "marked_reviewed") return "Markeret kontrolleret";
  if (value === "reopened") return "Genåbnet";
  if (value === "reprocessed") return "Behandlet igen";
  return value;
}

function formatQty(quantity: number, unit: string | null) {
  return `${quantity.toLocaleString("da-DK", { maximumFractionDigits: 2 })} ${unit ?? "stk"}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : "ukendt";
}
