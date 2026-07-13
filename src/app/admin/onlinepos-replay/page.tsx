"use client";

import { AlertTriangle, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Notice, StatusPill } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ReplayWindow = {
  id: string;
  label: string;
  fetchFrom: string;
  fetchTo: string;
  displayFrom: string;
  displayTo: string;
  apiPages?: number;
  transactionCount?: number;
  salesLineCount?: number;
  returnTransactionCount?: number;
  duplicateCount?: number;
  missingMappingCount?: number;
  failedCount?: number;
  processedCount?: number;
  ignoredCount?: number;
  expectedStockDelta?: number;
  cashRegisters?: string[];
  unmappedProducts?: string[];
  unmappedLocations?: string[];
  modifiers?: number;
  deposits?: number;
  controlErrors?: string[];
  expectedStockChanges?: Array<{ locationId: string; productId: string; quantity: number }>;
  errorSummary?: ErrorSummary[];
  errorDetails?: ReplayErrorDetail[];
  returnAudits?: ReplayReturnAudit[];
  modifierAudits?: ReplayModifierAudit[];
  stockPreview?: ReplayStockPreviewLine[];
  duplicateDetails?: ReplayDuplicateDetail[];
};

type ReplayResponse = {
  ok: boolean;
  message?: string;
  defaults?: ReplayForm;
  windows?: ReplayWindow[];
  replayRunId?: string;
  totals?: Record<string, number>;
  errorSummary?: ErrorSummary[];
  errorDetails?: ReplayErrorDetail[];
  returns?: ReplayReturnAudit[];
  returnSummary?: { verified: number; probable: number; uncertain: number };
  modifierAudit?: ReplayModifierAudit[];
  unmappedProducts?: ReplayUnmappedProduct[];
  stockPreview?: ReplayStockPreviewLine[];
  duplicateDetails?: ReplayDuplicateDetail[];
  locationMappingDebug?: {
    supabaseProjectHostOnly: string | null;
    initial: ReplayLocationMappingSnapshot;
    windows: Array<{ replayWindow: string } & ReplayLocationMappingSnapshot>;
    latest: ReplayLocationMappingSnapshot;
  };
  safety?: Record<string, boolean | string>;
};

type ReplayLocationMappingSnapshot = {
  activeApprovedMappingCount: number;
  mappingsLoaded: ReplayLocationMappingDebugRow[];
};

type ReplayLocationMappingDebugRow = {
  id: string;
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string;
  backeventLocationId: string | null;
  active: boolean;
  hasBackeventLocation: boolean;
};

type ErrorSummary = { code: string; count: number };
type ReplayErrorDetail = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  datetime: string | null;
  cashRegister: string | null;
  lineId: string | null;
  onlineposProductId: string | null;
  productName: string | null;
  quantity: number;
  amount: number;
  errorCode: string;
  message: string;
  locationDiagnostics?: {
    incomingName: string | null;
    incomingId: string | null;
    venueId: string | null;
    normalizedName: string | null;
    candidateMappingsLoaded: Array<{
      id: string;
      venueId: string | null;
      cashRegisterId: string | null;
      cashRegisterName: string;
      normalizedCashRegisterName: string;
      active: boolean;
      hasBackeventLocation: boolean;
    }>;
  } | null;
};
type ReplayReturnAudit = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  datetime: string | null;
  cashRegister: string | null;
  total: number | null;
  type: string | null;
  status: string | null;
  returnId: string | null;
  refundId: string | null;
  negativeLines: number;
  signals: string[];
  classification: string;
};
type ReplayModifierAudit = {
  replayWindow: string;
  transactionId: string | null;
  receiptNumber: string | null;
  parentLineId: string | null;
  lineId: string | null;
  productName: string | null;
  productGroupName: string | null;
  quantity: number;
  amount: number;
  isModifier: boolean;
  isZeroPrice: boolean;
  economyProduct: string | null;
  stockProduct: string | null;
  stockRelevant: boolean;
  decision: string;
};
type ReplayUnmappedProduct = {
  onlineposProductId: string | null;
  productName: string | null;
  occurrenceCount: number;
  totalQuantity: number;
  cashRegisters: string[];
  parentModifierRelation: string;
  priceLevel: { min: number | null; max: number | null };
  suggestedProductName: string | null;
};
type ReplayStockPreviewLine = {
  replayWindow: string;
  locationName: string;
  backeventProductName: string;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
  transactionId: string | null;
  lineId: string | null;
  quantityText: string;
  internalQuantity: number;
  mappingId: string | null;
  decision: string;
};
type ReplayDuplicateDetail = {
  replayWindow: string;
  key: string;
  transactionId: string | null;
  receiptNumber: string | null;
  lineId: string | null;
  productName: string | null;
  ignored: boolean;
};

type ReplayForm = {
  date: string;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  overlapMinutes: number;
  venue?: string | null;
};

const defaultForm: ReplayForm = {
  date: "2025-07-17",
  startTime: "17:00",
  endTime: "17:50",
  intervalMinutes: 10,
  overlapMinutes: 2,
};

export default function OnlinePosReplayPage() {
  const [form, setForm] = useState(defaultForm);
  const [cashRegister, setCashRegister] = useState("");
  const [mode, setMode] = useState<"dry-run" | "test-run">("dry-run");
  const [confirmation, setConfirmation] = useState("");
  const [replayRunId, setReplayRunId] = useState(() => crypto.randomUUID());
  const [windows, setWindows] = useState<ReplayWindow[]>([]);
  const [totals, setTotals] = useState<Record<string, number> | null>(null);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [previousResult, setPreviousResult] = useState<ReplayResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDefaults = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-replay", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const data = (await response.json()) as ReplayResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Replay er ikke tilgængelig");
      setForm({ ...defaultForm, ...(data.defaults ?? {}) });
      setWindows(data.windows ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay kunne ikke hentes");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDefaults(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDefaults]);

  async function runReplay() {
    try {
      setRunning(true);
      setError(null);
      setMessage(null);
      setTotals(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-replay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...form,
          cashRegister: cashRegister || null,
          mode,
          confirmation,
          replayRunId,
        }),
      });
      const data = (await response.json()) as ReplayResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Replay fejlede");
      setPreviousResult(result);
      setResult(data);
      setWindows(data.windows ?? []);
      setTotals(data.totals ?? null);
      setMessage(mode === "dry-run" ? "Dry-run er gennemført uden lagerændringer." : "Replay er kørt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay fejlede");
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="OnlinePOS replay" subtitle="Historisk dry-run af 10-minutters sync før markedet" />

      {message ? <Notice tone="success" className="mb-4">{message}</Notice> : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
            <RefreshCw className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Replay setup</h2>
            <p className="text-sm font-medium text-muted">Standard: 17.07.2025 kl. 17:00-17:50 med 2 minutters overlap.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-6">
          <Field label="Dato"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="field" /></Field>
          <Field label="Start"><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="field" /></Field>
          <Field label="Slut"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="field" /></Field>
          <Field label="Interval"><input value={form.intervalMinutes} onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) || 10 })} className="field" inputMode="numeric" /></Field>
          <Field label="Overlap"><input value={form.overlapMinutes} onChange={(e) => setForm({ ...form, overlapMinutes: Number(e.target.value) || 0 })} className="field" inputMode="numeric" /></Field>
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "test-run")} className="field">
              <option value="dry-run">Dry-run</option>
              <option value="test-run">Test-run</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
          <Field label="Venue">
            <input
              value={form.venue ?? ""}
              onChange={(e) => setForm({ ...form, venue: e.target.value || null })}
              className="field"
              placeholder="Fra ONLINEPOS_VENUE_ID"
            />
          </Field>
          <Field label="Cash register/lokation">
            <input value={cashRegister} onChange={(e) => setCashRegister(e.target.value)} className="field" placeholder="Valgfri" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Replay run id">
            <input value={replayRunId} onChange={(e) => setReplayRunId(e.target.value)} className="field" />
          </Field>
        </div>
        {mode === "test-run" ? (
          <Notice tone="pending" className="mt-3">
            Test-run kræver bekræftelsen KØR HISTORISK TEST. Dry-run ændrer ikke lager.
            <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="field mt-2" placeholder="KØR HISTORISK TEST" />
          </Notice>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={runReplay} disabled={running}>
            <Play className="h-4 w-4" aria-hidden />{running ? "Kører..." : "Kør replay"}
          </Button>
          <Button type="button" tone="secondary" onClick={() => setReplayRunId(crypto.randomUUID())}>Nyt replay id</Button>
        </div>
      </section>

      {totals ? (
        <section className="mb-5 grid gap-3 md:grid-cols-6">
          <Metric label="Unikke transaktioner" value={totals.uniqueTransactionCount ?? 0} />
          <Metric label="Unikke linjer" value={totals.uniqueLineCount ?? 0} />
          <Metric label="Behandlet" value={totals.processedCount ?? 0} />
          <Metric label="Dubletter" value={totals.duplicateCount ?? 0} />
          <Metric label="Manglende mappings" value={totals.missingMappingCount ?? 0} />
          <Metric label="Forventet lagertræk" value={totals.expectedStockDelta ?? 0} />
        </section>
      ) : null}

      {result && previousResult ? <Comparison current={result} previous={previousResult} /> : null}
      {result?.locationMappingDebug ? <LocationMappingDebug result={result} /> : null}
      {result?.errorSummary?.length ? <ErrorOverview result={result} /> : null}
      {result?.errorDetails?.some((item) => item.locationDiagnostics) ? <LocationDiagnosticsOverview result={result} /> : null}
      {result?.returns?.length ? <ReturnOverview result={result} /> : null}
      {result?.modifierAudit?.length ? <ModifierOverview rows={result.modifierAudit} /> : null}
      {result?.unmappedProducts?.length ? <UnmappedProducts rows={result.unmappedProducts} /> : null}
      {result?.stockPreview?.length ? <StockPreview rows={result.stockPreview} /> : null}
      {result?.duplicateDetails?.length ? <DuplicateOverview rows={result.duplicateDetails} /> : null}

      <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Tidslinje</h2>
          <StatusPill tone="info">{windows.length} vinduer</StatusPill>
        </div>
        <div className="space-y-3">
          {windows.map((window) => (
            <article key={window.id} className="rounded-xl border border-line bg-soft/40 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-ink">{window.label}</h3>
                <p className="text-xs font-bold text-muted">{formatDate(window.fetchFrom)} - {formatDate(window.fetchTo)}</p>
              </div>
              <div className="grid gap-2 text-sm md:grid-cols-6">
                <Mini label="API-sider" value={window.apiPages ?? "-"} />
                <Mini label="Transaktioner" value={window.transactionCount ?? "-"} />
                <Mini label="Linjer" value={window.salesLineCount ?? "-"} />
                <Mini label="Returer" value={window.returnTransactionCount ?? "-"} />
                <Mini label="Dubletter" value={window.duplicateCount ?? "-"} />
                <Mini label="Fejl" value={window.failedCount ?? "-"} />
              </div>
              {window.cashRegisters?.length ? <p className="mt-2 text-xs font-bold text-muted">Kasser: {window.cashRegisters.join(", ")}</p> : null}
              {window.unmappedProducts?.length ? <Notice tone="pending" className="mt-2">Umappede produkter: {window.unmappedProducts.slice(0, 8).join(", ")}</Notice> : null}
              {window.unmappedLocations?.length ? <Notice tone="danger" className="mt-2">Umappede lokationer: {window.unmappedLocations.join(", ")}</Notice> : null}
              {window.modifiers || window.deposits ? <p className="mt-2 text-xs font-bold text-muted">Modifiers: {window.modifiers ?? 0} · Pant/gebyr: {window.deposits ?? 0}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <Notice tone="pending" className="mt-5">
        <span className="inline-flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" aria-hidden />Oprydning</span>
        <span className="mt-1 block">Dry-run opretter ingen data. Test-run data skal ryddes pr. replay_run_id og kun med source = historical_replay.</span>
      </Notice>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-muted">{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-line bg-macro p-3"><p className="text-xs font-bold uppercase text-muted">{label}</p><p className="text-xl font-bold text-ink">{formatNumber(value)}</p></div>;
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return <div><span className="block text-xs font-bold uppercase text-muted">{label}</span><span className="font-bold text-ink">{typeof value === "number" ? formatNumber(value) : value}</span></div>;
}

function Comparison({ current, previous }: { current: ReplayResponse; previous: ReplayResponse }) {
  const rows = [
    ["Fejl", previous.totals?.errorCount ?? 0, current.totals?.errorCount ?? 0],
    ["Umappede produkter", previous.unmappedProducts?.length ?? 0, current.unmappedProducts?.length ?? 0],
    ["Umappede lokationer", countLocationErrors(previous), countLocationErrors(current)],
    ["Klare lagerlinjer", previous.stockPreview?.length ?? 0, current.stockPreview?.length ?? 0],
    ["Usikre returer", previous.returnSummary?.uncertain ?? 0, current.returnSummary?.uncertain ?? 0],
  ] as const;
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Sammenligning med forrige dry-run</h2>
      <div className="grid gap-2 md:grid-cols-5">
        {rows.map(([label, before, after]) => (
          <Metric key={label} label={`${label}: ${before} →`} value={after} />
        ))}
      </div>
    </section>
  );
}

function LocationMappingDebug({ result }: { result: ReplayResponse }) {
  const latest = result.locationMappingDebug?.latest;
  if (!latest) return null;
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Lokationsmapping runtime</h2>
      <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold text-muted">
        <StatusPill tone="info">Supabase: {result.locationMappingDebug?.supabaseProjectHostOnly ?? "-"}</StatusPill>
        <StatusPill tone="success">Aktive mappings: {latest.activeApprovedMappingCount}</StatusPill>
        <StatusPill tone="info">Rækker hentet: {latest.mappingsLoaded.length}</StatusPill>
      </div>
      <CompactTable
        headers={["Eksternt navn", "Norm", "ID", "Venue", "Aktiv", "BackEvent ID"]}
        rows={latest.mappingsLoaded.slice(0, 80).map((mapping) => [
          mapping.cashRegisterName,
          mapping.normalizedCashRegisterName || "-",
          mapping.cashRegisterId ?? "-",
          mapping.venueId ?? "-",
          mapping.active ? "ja" : "nej",
          mapping.backeventLocationId ?? "-",
        ])}
      />
    </section>
  );
}

function LocationDiagnosticsOverview({ result }: { result: ReplayResponse }) {
  const rows = (result.errorDetails ?? []).filter((item) => item.locationDiagnostics).slice(0, 80);
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Lokationsfejl diagnostik</h2>
      <CompactTable
        headers={["Vindue", "Kasse", "Incoming ID", "Venue", "Norm", "Kandidater"]}
        rows={rows.map((item) => [
          item.replayWindow,
          item.locationDiagnostics?.incomingName ?? item.cashRegister ?? "-",
          item.locationDiagnostics?.incomingId ?? "-",
          item.locationDiagnostics?.venueId ?? "-",
          item.locationDiagnostics?.normalizedName ?? "-",
          formatLocationDiagnostics(item.locationDiagnostics),
        ])}
      />
    </section>
  );
}

function ErrorOverview({ result }: { result: ReplayResponse }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Fejloversigt</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {result.errorSummary?.map((item) => <StatusPill key={item.code} tone="danger">{item.code}: {item.count}</StatusPill>)}
      </div>
      <CompactTable
        headers={["Vindue", "Kode", "Kasse", "Produkt", "Bon", "Antal", "Beløb", "Besked"]}
        rows={(result.errorDetails ?? []).slice(0, 80).map((item) => [
          item.replayWindow,
          item.errorCode,
          item.cashRegister ?? "-",
          item.productName ?? "-",
          item.receiptNumber ?? item.transactionId ?? "-",
          formatNumber(item.quantity),
          formatMoney(item.amount),
          item.message,
        ])}
      />
    </section>
  );
}

function ReturnOverview({ result }: { result: ReplayResponse }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Returklassifikation</h2>
      <p className="mb-3 text-sm font-bold text-muted">
        Verificeret: {result.returnSummary?.verified ?? 0} · Sandsynlig: {result.returnSummary?.probable ?? 0} · Usikker: {result.returnSummary?.uncertain ?? 0}
      </p>
      <CompactTable
        headers={["Vindue", "Klassifikation", "Kasse", "Bon", "Tid", "Total", "Signal"]}
        rows={(result.returns ?? []).slice(0, 80).map((item) => [
          item.replayWindow,
          item.classification,
          item.cashRegister ?? "-",
          item.receiptNumber ?? item.transactionId ?? "-",
          formatDateTime(item.datetime),
          formatMoney(item.total ?? 0),
          item.signals.join(", "),
        ])}
      />
    </section>
  );
}

function ModifierOverview({ rows }: { rows: ReplayModifierAudit[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Modifier- og 0-pris-audit</h2>
      <CompactTable
        headers={["Vindue", "Linje", "Parent", "Produkt", "Beløb", "Økonomi", "Lager", "Beslutning"]}
        rows={rows.slice(0, 80).map((item) => [
          item.replayWindow,
          item.lineId ?? "-",
          item.parentLineId ?? "-",
          item.productName ?? "-",
          formatMoney(item.amount),
          item.economyProduct ?? "-",
          item.stockRelevant ? item.stockProduct ?? "Kræver mapping" : "Ikke lager",
          item.decision,
        ])}
      />
    </section>
  );
}

function UnmappedProducts({ rows }: { rows: ReplayUnmappedProduct[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Umappede produkter</h2>
      <CompactTable
        headers={["ID", "Navn", "Antal", "Quantity", "Kasser", "Relation", "Pris", "Forslag"]}
        rows={rows.slice(0, 100).map((item) => [
          item.onlineposProductId ?? "-",
          item.productName ?? "-",
          item.occurrenceCount,
          formatNumber(item.totalQuantity),
          item.cashRegisters.join(", ") || "-",
          item.parentModifierRelation || "-",
          `${formatMoney(item.priceLevel.min ?? 0)}-${formatMoney(item.priceLevel.max ?? 0)}`,
          item.suggestedProductName ?? "-",
        ])}
      />
    </section>
  );
}

function StockPreview({ rows }: { rows: ReplayStockPreviewLine[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Forventet lagerpåvirkning</h2>
      <CompactTable
        headers={["Vindue", "Lokation", "BackEvent-vare", "OnlinePOS", "Mængde", "Intern", "Mapping", "Status"]}
        rows={rows.slice(0, 120).map((item) => [
          item.replayWindow,
          item.locationName,
          item.backeventProductName,
          item.onlineposProductName ?? item.onlineposProductId ?? "-",
          item.quantityText,
          formatNumber(item.internalQuantity),
          item.mappingId ?? "-",
          item.decision,
        ])}
      />
    </section>
  );
}

function DuplicateOverview({ rows }: { rows: ReplayDuplicateDetail[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Overlap og idempotens</h2>
      <CompactTable
        headers={["Vindue", "Key", "Bon", "Linje", "Produkt", "Status"]}
        rows={rows.slice(0, 80).map((item) => [
          item.replayWindow,
          item.key,
          item.receiptNumber ?? item.transactionId ?? "-",
          item.lineId ?? "-",
          item.productName ?? "-",
          item.ignored ? "Dublet ignoreret" : "Fundet",
        ])}
      />
    </section>
  );
}

function CompactTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="hidden bg-soft/60 px-3 py-2 text-xs font-bold uppercase text-muted md:grid" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
        {headers.map((header) => <span key={header}>{header}</span>)}
      </div>
      <div className="divide-y divide-line">
        {rows.map((row, index) => (
          <div key={index} className="grid gap-2 px-3 py-2 text-sm md:items-center" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}>
            {row.map((cell, cellIndex) => (
              <span key={cellIndex} className="min-w-0 break-words font-medium text-ink md:text-xs">{cell}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

function formatNumber(value: number) {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 2 });
}

function formatMoney(value: number) {
  return `${value.toLocaleString("da-DK", { maximumFractionDigits: 2 })} kr.`;
}

function formatLocationDiagnostics(diagnostics: ReplayErrorDetail["locationDiagnostics"]) {
  if (!diagnostics) return "-";
  const candidates = diagnostics.candidateMappingsLoaded;
  if (candidates.length === 0) {
    return `Ingen kandidater · incoming=${diagnostics.incomingName ?? "-"} · id=${diagnostics.incomingId ?? "-"} · venue=${diagnostics.venueId ?? "-"} · norm=${diagnostics.normalizedName ?? "-"}`;
  }
  return candidates
    .map((candidate) => `${candidate.cashRegisterName} · norm=${candidate.normalizedCashRegisterName || "-"} · id=${candidate.cashRegisterId ?? "-"} · venue=${candidate.venueId ?? "-"} · aktiv=${candidate.active ? "ja" : "nej"} · BE=${candidate.hasBackeventLocation ? "ja" : "nej"}`)
    .join(" | ");
}

function countLocationErrors(result: ReplayResponse) {
  return result.errorDetails?.filter((item) => item.errorCode === "LOCATION_MAPPING_MISSING").length ?? 0;
}
