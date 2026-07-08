"use client";

import { AlertTriangle, BarChart3, CheckCircle2, PlugZap, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import type {
  OnlinePosEnvStatus,
  OnlinePosProbeAction,
  OnlinePosProbeResult,
  OnlinePosReportsEnvStatus,
  OnlinePosReportsParamMode,
  OnlinePosSaleLine,
} from "@/lib/onlinepos/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ProbeResponse = {
  env?: OnlinePosEnvStatus;
  reportsEnv?: OnlinePosReportsEnvStatus;
  result?: OnlinePosProbeResult;
  error?: string;
  debug?: {
    hasUser: boolean;
    profileRole: string | null;
    profileActive: boolean | null;
    userEmail: string | null;
  };
};

export default function OnlinePosProbePage() {
  const [env, setEnv] = useState<OnlinePosEnvStatus | null>(null);
  const [reportsEnv, setReportsEnv] = useState<OnlinePosReportsEnvStatus | null>(null);
  const [result, setResult] = useState<OnlinePosProbeResult | null>(null);
  const [reportsResult, setReportsResult] = useState<OnlinePosProbeResult | null>(null);
  const [date, setDate] = useState(getRelativeDate(0));
  const [reportsParamMode, setReportsParamMode] = useState<OnlinePosReportsParamMode>("none");
  const [busyAction, setBusyAction] = useState<OnlinePosProbeAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadEnv() {
      try {
        const response = await fetch("/api/admin/onlinepos-probe", {
          headers: await authHeaders(),
        });
        const data = (await response.json()) as ProbeResponse;

        if (mounted) {
          setEnv(data.env ?? null);
          setReportsEnv(data.reportsEnv ?? null);
          setMessage(response.ok ? null : formatApiError(data, "OnlinePOS status kunne ikke hentes."));
        }
      } catch {
        if (mounted) {
          setMessage("OnlinePOS status kunne ikke hentes.");
        }
      }
    }

    loadEnv();

    return () => {
      mounted = false;
    };
  }, []);

  async function runProbe(action: OnlinePosProbeAction) {
    setBusyAction(action);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/onlinepos-probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({ action, date, reportsParamMode }),
      });
      const data = (await response.json()) as ProbeResponse;

      setEnv(data.env ?? env);
      setReportsEnv(data.reportsEnv ?? reportsEnv);

      if (action === "reports-test" || action === "reports-sales-per-product") {
        setReportsResult(data.result ?? null);
      } else {
        setResult(data.result ?? null);
      }

      setMessage(response.ok ? data.result?.error ?? null : formatApiError(data, "OnlinePOS kald fejlede."));
    } catch {
      setMessage("OnlinePOS kald fejlede.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppShell adminOnly>
      <BackButton href="/admin" />
      <section className="my-6 rounded-[2rem] bg-soft p-6 shadow-soft lg:my-5 lg:rounded-[1.5rem] lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-ink">OnlinePOS probe</h1>
            <p className="mt-2 text-lg font-medium text-muted">Læs kun fra API før rigtig integration</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-pantone139 px-4 py-2 text-sm font-bold text-pantone140">
            <PlugZap className="h-4 w-4" aria-hidden />
            Read-only
          </span>
        </div>
        <p className="mt-4 max-w-3xl text-sm font-medium text-muted">
          Ingen import, ingen lagerbevægelser og ingen ændring af BackEvent lager. Tokens bruges kun server-side.
        </p>
      </section>

      {message ? <p className="mb-4 rounded-2xl bg-warmRed/10 p-4 text-base font-bold text-warmRed">{message}</p> : null}

      <div className="space-y-8">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <CompactPanel title="Gammel API" icon={RefreshCw}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => runProbe("connection")}
                disabled={busyAction !== null}
                className="min-h-11 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "connection" ? "Tester..." : "Test forbindelse"}
              </button>
              <button
                type="button"
                onClick={() => runProbe("latest-sales")}
                disabled={busyAction !== null}
                className="min-h-11 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "latest-sales" ? "Henter..." : "Hent salg i dag"}
              </button>
              <button
                type="button"
                onClick={() => runProbe("export-sales-fallback")}
                disabled={busyAction !== null}
                className="min-h-11 rounded-xl border border-pantone140/25 bg-macro px-4 py-2 text-sm font-bold text-pantone140 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "export-sales-fallback" ? "Henter..." : "Fallback: exportSales/v20"}
              </button>
              <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] md:col-span-2 xl:col-span-4">
                <button type="button" onClick={() => setDate(getRelativeDate(-1))} className="min-h-11 rounded-xl bg-soft px-4 py-2 text-sm font-bold text-pantone140">
                  I går
                </button>
                <button type="button" onClick={() => setDate(getRelativeDate(0))} className="min-h-11 rounded-xl bg-soft px-4 py-2 text-sm font-bold text-pantone140">
                  I dag
                </button>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="min-h-11 rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-ink"
                />
                <button
                  type="button"
                  onClick={() => runProbe("sales-by-date")}
                  disabled={busyAction !== null || !date}
                  className="min-h-11 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === "sales-by-date" ? "Henter..." : "Hent salg for dato"}
                </button>
              </div>
            </div>
          </CompactPanel>

          <CompactPanel title="Gammel API miljø" icon={env?.configured ? CheckCircle2 : AlertTriangle}>
            <div className="space-y-2 text-sm font-bold">
              <StatusRow label="OnlinePOS env" value={env?.configured ? "Konfigureret" : "Mangler"} ok={Boolean(env?.configured)} />
              <StatusRow label="Base URL" value={env?.baseUrl ?? "Ikke hentet"} ok={Boolean(env?.hasBaseUrl)} />
              <StatusRow label="Token" value={env?.hasToken ? "Sat server-side" : "Mangler"} ok={Boolean(env?.hasToken)} />
              <StatusRow label="FirmaID" value={env?.hasFirmaId ? "Sat" : "Mangler"} ok={Boolean(env?.hasFirmaId)} />
            </div>
          </CompactPanel>
        </section>

        {result ? <ProbeResult titlePrefix="Gammel API" result={result} /> : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <CompactPanel title="Reports API" icon={PlugZap}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[auto_auto_1fr]">
              <button
                type="button"
                onClick={() => runProbe("reports-test")}
                disabled={busyAction !== null}
                className="min-h-11 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "reports-test" ? "Tester..." : "Test Reports API"}
              </button>
              <button
                type="button"
                onClick={() => runProbe("reports-sales-per-product")}
                disabled={busyAction !== null}
                className="min-h-11 rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "reports-sales-per-product" ? "Henter..." : "Hent salg pr. produkt"}
              </button>
              <label className="grid gap-1 text-sm font-bold text-muted">
                Parameter mode
                <select
                  value={reportsParamMode}
                  onChange={(event) => setReportsParamMode(event.target.value as OnlinePosReportsParamMode)}
                  className="min-h-11 rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-ink"
                >
                  <option value="none">none</option>
                  <option value="from_to_iso">from/to</option>
                  <option value="startDate_endDate_iso">startDate/endDate</option>
                  <option value="dateFrom_dateTo_iso">dateFrom/dateTo</option>
                </select>
              </label>
            </div>
            <p className="mt-3 text-sm font-medium text-muted">
              Kalder GET /reports/getSalesPerProduct med Authorization: Bearer TOKEN server-side.
            </p>
          </CompactPanel>

          <CompactPanel title="Reports miljø" icon={reportsEnv?.configured ? CheckCircle2 : AlertTriangle}>
            <div className="space-y-2 text-sm font-bold">
              <StatusRow label="Reports env" value={reportsEnv?.configured ? "Konfigureret" : "Mangler"} ok={Boolean(reportsEnv?.configured)} />
              <StatusRow label="Base URL" value={reportsEnv?.baseUrl ?? "Ikke hentet"} ok={Boolean(reportsEnv?.hasBaseUrl)} />
              <StatusRow label="Bearer token" value={reportsEnv?.hasToken ? "Sat server-side" : "Mangler"} ok={Boolean(reportsEnv?.hasToken)} />
            </div>
          </CompactPanel>
        </section>

        {reportsResult ? <ProbeResult titlePrefix="Reports API" result={reportsResult} /> : null}
      </div>
    </AppShell>
  );
}

function ProbeResult({ titlePrefix, result }: { titlePrefix: string; result: OnlinePosProbeResult }) {
  return (
    <>
      <CompactPanel title={`${titlePrefix} svar summary`} icon={BarChart3}>
        <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <SummaryItem label="Endpoint" value={result.endpoint} wide />
          <SummaryItem label="Unix from" value={result.unixRange ? String(result.unixRange.from) : "-"} />
          <SummaryItem label="Unix to" value={result.unixRange ? String(result.unixRange.to) : "-"} />
          <SummaryItem label="Status" value={`${result.status} ${result.statusText}`} />
          <SummaryItem label="Svar type" value={`${result.summary.responseType} / ${result.summary.topLevelType}`} />
          <SummaryItem label="Linjer fundet" value={String(result.summary.lineCount)} />
          <SummaryItem label="Content-Type" value={result.contentType ?? "-"} />
          <SummaryItem label="Bar/sted felter" value={result.summary.hasDepartmentFields ? "Ja" : "Nej"} />
          <SummaryItem label="Pagination" value={result.summary.hasPaginationInfo ? "Fundet" : "Ikke fundet"} />
          <SummaryItem label="Første felter" value={result.summary.firstKeys.join(", ") || "-"} wide />
          <SummaryItem label="OK" value={result.ok ? "Ja" : "Nej"} />
        </div>
        {result.summary.paginationInfo ? (
          <pre className="mt-4 max-h-40 overflow-auto rounded-2xl bg-soft p-3 text-xs font-medium text-muted">
            {JSON.stringify(result.summary.paginationInfo, null, 2)}
          </pre>
        ) : null}
      </CompactPanel>

      <CompactPanel title={`${titlePrefix} første 20 rækker`} icon={BarChart3}>
        {result.lines.length > 0 ? (
          <SaleLinesTable lines={result.lines} />
        ) : (
          <p className="text-sm font-medium text-muted">Ingen salgslinjer fundet i svaret.</p>
        )}
      </CompactPanel>

      <section className="grid gap-4 xl:grid-cols-2">
        <DistinctList title={`${titlePrefix} afdelinger/barer fundet`} items={result.distinctDepartments} />
        <DistinctList title={`${titlePrefix} produkter fundet`} items={result.distinctProducts} />
      </section>

      <CompactPanel title={`${titlePrefix} råt svar preview`} icon={BarChart3}>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-soft p-3 text-xs font-medium text-muted">
          {result.summary.rawPreview || "Tomt svar"}
        </pre>
      </CompactPanel>
    </>
  );
}

function SaleLinesTable({ lines }: { lines: OnlinePosSaleLine[] }) {
  const columns: Array<{ key: keyof OnlinePosSaleLine; label: string }> = [
    { key: "datetime", label: "Tid" },
    { key: "productid", label: "ProductID" },
    { key: "productname", label: "Vare" },
    { key: "department", label: "Afdeling" },
    { key: "count", label: "Antal" },
    { key: "price", label: "Pris" },
    { key: "firmaid", label: "FirmaID" },
    { key: "orderid", label: "OrderID" },
    { key: "orderlineid", label: "OrderLineID" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th key={column.key} className="py-2 pr-3">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.orderid ?? "line"}-${line.orderlineid ?? index}`} className="border-b border-line/70 last:border-0">
              {columns.map((column) => (
                <td key={column.key} className="py-2 pr-3 text-muted">
                  {formatCell(line[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistinctList({ title, items }: { title: string; items: string[] }) {
  return (
    <CompactPanel title={title} icon={PackageIcon}>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="rounded-full bg-soft px-3 py-1 text-sm font-bold text-pantone140">
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm font-medium text-muted">Ingen data endnu.</p>
      )}
    </CompactPanel>
  );
}

function CompactPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-xl font-bold text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className={ok ? "text-green-800" : "text-warmRed"}>{value}</span>
    </div>
  );
}

function SummaryItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-2xl bg-soft px-3 py-2 ${wide ? "md:col-span-2" : ""}`}>
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return {};
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function getRelativeDate(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function formatCell(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatApiError(data: ProbeResponse, fallback: string) {
  const message = data.error ?? fallback;

  if (!data.debug) {
    return message;
  }

  return `${message} Debug: hasUser=${data.debug.hasUser}, profileRole=${data.debug.profileRole ?? "null"}, profileActive=${
    data.debug.profileActive ?? "null"
  }, userEmail=${data.debug.userEmail ?? "null"}`;
}

const PackageIcon = BarChart3;
