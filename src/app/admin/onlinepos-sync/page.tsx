"use client";

import { AlertTriangle, CheckCircle2, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Notice, StatusPill } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SyncRun = {
  id: string;
  status: string;
  datetimeFrom: string;
  datetimeTo: string;
  fetchedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  missingMappingCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type SyncLine = {
  id: string;
  productName: string | null;
  productGroupName: string | null;
  cashRegisterName: string | null;
  lineType: string;
  mappingStatus: string | null;
  mappingAction: string | null;
  status: string;
  errorReason: string | null;
  quantitySold: number;
  stockDelta: number;
  stockDeltaText?: string;
  createdAt: string;
};

type SyncStatusResponse = {
  ok: boolean;
  mode?: "mock" | "supabase";
  latestRun?: SyncRun | null;
  recentRuns?: SyncRun[];
  recentLines?: SyncLine[];
  message?: string;
};

type SyncRunResponse = SyncStatusResponse & Partial<SyncRun> & {
  runId?: string;
  status?: string;
  fetchedCount?: number;
  processedCount?: number;
  ignoredCount?: number;
  failedCount?: number;
  missingMappingCount?: number;
  duplicateCount?: number;
  lines?: unknown[];
};

export default function OnlinePosSyncPage() {
  const [latestRun, setLatestRun] = useState<SyncRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<SyncRun[]>([]);
  const [recentLines, setRecentLines] = useState<SyncLine[]>([]);
  const [fromLocal, setFromLocal] = useState(defaultFromLocal());
  const [toLocal, setToLocal] = useState(defaultToLocal());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncRunResponse | null>(null);

  const summary = useMemo(() => latestRun ?? lastResult, [latestRun, lastResult]);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-sync", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as SyncStatusResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke hente OnlinePOS-sync");
      }

      setLatestRun(data.latestRun ?? null);
      setRecentRuns(data.recentRuns ?? []);
      setRecentLines(data.recentLines ?? []);
      setMessage(data.mode === "mock" ? data.message ?? "Mock mode" : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kunne ikke hente OnlinePOS-sync.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  async function runSync() {
    if (!window.confirm("Vil du genkøre OnlinePOS-sync for den valgte periode? Samme transaktionslinjer behandles ikke igen.")) {
      return;
    }

    try {
      setRunning(true);
      setError(null);
      setMessage(null);
      setLastResult(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          datetimeFrom: new Date(fromLocal).toISOString(),
          datetimeTo: new Date(toLocal).toISOString(),
        }),
      });
      const data = (await response.json()) as SyncRunResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "OnlinePOS-sync fejlede");
      }

      setLastResult(data);
      setMessage("OnlinePOS-sync er kørt.");
      await loadStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OnlinePOS-sync fejlede.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="OnlinePOS-sync" subtitle="Automatisk lagertræk med sikker genkørsel" />

      {message ? <Notice tone="success" className="mb-4">{message}</Notice> : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <section className="mb-6 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Seneste sync</h2>
            <p className="text-sm font-medium text-muted">{latestRun ? new Date(latestRun.startedAt).toLocaleString("da-DK") : "Ingen sync endnu"}</p>
          </div>
          <button type="button" onClick={loadStatus} className="inline-flex items-center gap-2 rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-ink">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Opdater
          </button>
        </div>

        {loading ? (
          <p className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Henter status...</p>
        ) : summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Metric label="Hentet" value={summary.fetchedCount ?? 0} />
            <Metric label="Behandlet" value={summary.processedCount ?? 0} tone="success" />
            <Metric label="Ignoreret" value={summary.ignoredCount ?? 0} />
            <Metric label="Fejlet" value={summary.failedCount ?? 0} tone={(summary.failedCount ?? 0) > 0 ? "danger" : "neutral"} />
            <Metric label="Manglende mappings" value={summary.missingMappingCount ?? 0} tone={(summary.missingMappingCount ?? 0) > 0 ? "danger" : "neutral"} />
            <Metric label="Dobbelt" value={summary.duplicateCount ?? 0} />
          </div>
        ) : (
          <p className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Ingen OnlinePOS-sync er kørt endnu.</p>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
            <Play className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Manuel genkørsel</h2>
            <p className="text-sm font-medium text-muted">Samme transaktionslinje kan kun påvirke lager én gang.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink">Fra</span>
            <input
              type="datetime-local"
              value={fromLocal}
              onChange={(event) => setFromLocal(event.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-ink">Til</span>
            <input
              type="datetime-local"
              value={toLocal}
              onChange={(event) => setToLocal(event.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
            />
          </label>
          <Button type="button" onClick={runSync} disabled={running}>
            {running ? "Kører..." : "Kør sync"}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Seneste linjer</h2>
          <StatusPill tone={recentLines.some((line) => line.status === "failed") ? "danger" : "success"}>
            {recentLines.length} linjer
          </StatusPill>
        </div>
        {recentLines.length === 0 ? (
          <p className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Ingen linjer endnu.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="hidden grid-cols-[1.3fr_1fr_.75fr_.75fr_1.2fr_1.4fr] gap-2 bg-soft px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted md:grid">
              <span>Vare</span>
              <span>Bar</span>
              <span>Type</span>
              <span>Status</span>
              <span>Lagertræk</span>
              <span>Årsag</span>
            </div>
            <div className="divide-y divide-line">
              {recentLines.map((line) => (
                <div key={line.id} className="grid gap-1 px-3 py-2 text-sm md:grid-cols-[1.3fr_1fr_.75fr_.75fr_1.2fr_1.4fr] md:gap-2">
                  <span className="font-bold text-ink">{line.productName ?? "Ukendt vare"}</span>
                  <span className="text-muted">{line.cashRegisterName ?? "-"}</span>
                  <span className="text-muted">{lineTypeLabel(line.lineType)}</span>
                  <span className={line.status === "failed" ? "font-bold text-warmRed" : line.status === "processed" ? "font-bold text-ok" : "font-bold text-muted"}>
                    {statusLabel(line.status)}
                  </span>
                  <span className="text-muted">{line.stockDeltaText ?? formatNumber(line.quantitySold)}</span>
                  <span className="text-muted">{line.errorReason ?? "-"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {recentRuns.length > 1 ? (
        <section className="mt-6 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
          <h2 className="mb-3 text-lg font-bold text-ink">Tidligere kørsler</h2>
          <div className="space-y-2">
            {recentRuns.slice(1).map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2 text-sm font-bold">
                <span>{new Date(run.startedAt).toLocaleString("da-DK")}</span>
                <span className="text-muted">Hentet {run.fetchedCount} · Behandlet {run.processedCount} · Fejlet {run.failedCount}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "success" | "danger" }) {
  const Icon = tone === "danger" ? AlertTriangle : CheckCircle2;
  return (
    <div className="rounded-xl bg-soft px-3 py-3">
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${tone === "danger" ? "text-warmRed" : tone === "success" ? "text-ok" : "text-muted"}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <p className="text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "processed") return "Behandlet";
  if (status === "failed") return "Fejlet";
  if (status === "ignored") return "Ignoreret";
  return status;
}

function lineTypeLabel(lineType: string) {
  if (lineType === "modifier_stock_item") return "Modifier";
  if (lineType === "deposit_fee") return "Pant/gebyr";
  if (lineType === "deposit_return") return "Pant retur";
  if (lineType === "container_product") return "Container";
  if (lineType === "stock_item") return "Vare";
  return "Ukendt";
}

function defaultFromLocal() {
  const date = new Date(Date.now() - 60 * 60 * 1000);
  return toLocalInputValue(date);
}

function defaultToLocal() {
  return toLocalInputValue(new Date());
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 }).format(value);
}

async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? null;
}
