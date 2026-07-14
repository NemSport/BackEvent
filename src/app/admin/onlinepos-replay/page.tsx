"use client";

import { AlertTriangle, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Notice, StatusPill } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  historicalReplayConfirmationText,
  historicalReplayProductionConfirmationText,
  isReplayConfirmationMatch,
} from "@/lib/onlinepos/historical-replay-core";

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
  ignoredSummary?: IgnoredSummary[];
  ignoredDetails?: ReplayIgnoredDetail[];
  returnAudits?: ReplayReturnAudit[];
  modifierAudits?: ReplayModifierAudit[];
  stockPreview?: ReplayStockPreviewLine[];
  duplicateDetails?: ReplayDuplicateDetail[];
};

type ReplayResponse = {
  ok: boolean;
  mode?: "dry-run" | "test-run" | "replay";
  __inputKey?: string;
  __stale?: boolean;
  staleDryRun?: boolean;
  message?: string;
  defaults?: ReplayForm;
  windows?: ReplayWindow[];
  replayRunId?: string;
  totals?: Record<string, number>;
  errorSummary?: ErrorSummary[];
  errorDetails?: ReplayErrorDetail[];
  ignoredSummary?: IgnoredSummary[];
  ignoredDetails?: ReplayIgnoredDetail[];
  returns?: ReplayReturnAudit[];
  returnSummary?: { verified: number; saleWithDepositReturn: number; uncertain: number };
  modifierAudit?: ReplayModifierAudit[];
  unmappedProducts?: ReplayUnmappedProduct[];
  blockingIssueGroups?: ReplayBlockingIssueGroup[];
  stockPreview?: ReplayStockPreviewLine[];
  duplicateDetails?: ReplayDuplicateDetail[];
  testRun?: {
    enabled: boolean;
    blockingErrors: ReplayErrorDetail[];
    blockingErrorSummary: ErrorSummary[];
  };
  testRunPlan?: {
    safeLineCount: number;
    actualStockChangeCount: number;
    ignoredLineCount: number;
    manualReviewReceiptCount: number;
    manualReviewLineCount: number;
    mappingSkippedLineCount: number;
    economicControlCount: number;
    wouldCreateControlMessageCount: number;
    technicalErrorCount: number;
    manualReviews: Array<{
      replayKey: string;
      receiptNumber: string | null;
      transactionId: string | null;
      reason: string;
      signals: string[];
      lineCount: number;
      wouldCreateControlMessage: true;
    }>;
  };
  applyResult?: {
    runId: string;
    status: string;
    processedCount: number;
    ignoredCount: number;
    failedCount: number;
    missingMappingCount: number;
    duplicateCount: number;
  };
  actualStockChanges?: ReplayStockPreviewLine[];
  testRunResult?: {
    safelyProcessedCount: number;
    actualStockChangeCount: number;
    duplicateCount: number;
    ignoredLineCount: number;
    manualReviewReceiptCount: number;
    manualReviewLineCount: number;
    mappingSkippedLineCount: number;
    economicControlCount: number;
    wouldCreateControlMessageCount: number;
    technicalErrorCount: number;
  };
  locationMappingDebug?: {
    supabaseProjectHostOnly: string | null;
    initial: ReplayLocationMappingSnapshot;
    windows: Array<{ replayWindow: string; canonicalLocations: ReplayCanonicalLocationDiagnostics[] } & ReplayLocationMappingSnapshot>;
    latest: ReplayLocationMappingSnapshot;
  };
  safety?: Record<string, boolean | string>;
  dryRun?: DryRunMeta;
  notificationPreview?: {
    controls: Array<{ receiptKey: string; receiptNumber: string | null; transactionId: string | null; rules: string[]; why: string[]; wouldSendPushTo: Array<{ id: string; email: string | null; name: string | null; role: string }> }>;
    seriousHistoricalErrors: Array<{ rule: string; why: string; receiptNumber: string | null; transactionId: string | null; wouldSendPushTo: Array<{ id: string; email: string | null; name: string | null; role: string }> }>;
    eventResponsibleRecipients: never[];
  };
};

type DryRunMeta = {
  id: string;
  completedAt: string;
  inputKey: string;
  fingerprint: string;
  blockingErrorSummary: ErrorSummary[];
};

type ReplayLocationMappingSnapshot = {
  activeApprovedMappingCount: number;
  mappingsLoaded: ReplayLocationMappingDebugRow[];
};

type ReplayCanonicalLocationDiagnostics = NonNullable<ReplayErrorDetail["locationDiagnostics"]>;

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
type IgnoredSummary = { code: "IGNORED_NON_STOCK_LINE" | "IGNORED_CONTAINER_ONLY"; count: number };
type ReplayIgnoredDetail = {
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
  ignoredCode: IgnoredSummary["code"];
  message: string;
};
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
    canonicalKey: string;
    incomingName: string | null;
    incomingId: string | null;
    venueId: string | null;
    normalizedName: string | null;
    incomingNames: string[];
    incomingIds: string[];
    venueValues: string[];
    selectedMappingRow: ReplayLocationMappingDebugRow | null;
    matchMethod: "id" | "exact_name" | null;
    duplicateCandidates: ReplayLocationMappingDebugRow[];
    conflictingCandidates: ReplayLocationMappingDebugRow[];
    candidateMappingsLoaded: Array<{
      id: string;
      venueId: string | null;
      cashRegisterId: string | null;
      cashRegisterName: string;
      normalizedCashRegisterName: string;
      backeventLocationId: string | null;
      active: boolean;
      hasBackeventLocation: boolean;
    }>;
  } | null;
};
type ReplayReturnAudit = {
  replayKey: string;
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
  depositLines: number;
  signals: string[];
  classification: string;
  manualClassification: string | null;
  controlTriggers: string[];
  depositReturnQuantity: number;
  depositBreakdown: { cups: number; pitchers: number; other: number };
  purchaseValue: number;
  depositReturnValue: number;
  finalTotal: number;
  lines: Array<{
    lineId: string | null;
    productName: string | null;
    productGroupName: string | null;
    quantity: number;
    amount: number;
    lineType: string;
  }>;
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
type ReplayBlockingIssueGroup = {
  code: string;
  groupKey: string;
  label: string;
  count: number;
  exampleReceiptNumber: string | null;
  exampleTransactionId: string | null;
  cashRegister: string | null;
  datetime: string | null;
  quantity: number;
  amount: number;
  adminHref: string;
  adminLabel: string;
  details: string;
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
  soldQuantity: number;
  consumptionPerSale: number;
  consumptionUnit: string;
  totalConsumptionQuantity: number;
  conversionDivisor: number;
  conversionMultiplier: number;
  finalStoredDelta: number;
  humanReadableDelta: string;
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
  const [mode, setMode] = useState<"dry-run" | "test-run" | "replay">("dry-run");
  const [confirmation, setConfirmation] = useState("");
  const [replayRunId, setReplayRunId] = useState(() => crypto.randomUUID());
  const [windows, setWindows] = useState<ReplayWindow[]>([]);
  const [totals, setTotals] = useState<Record<string, number> | null>(null);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [previousResult, setPreviousResult] = useState<ReplayResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [showTestRunConfirm, setShowTestRunConfirm] = useState(false);
  const [savingClassificationKey, setSavingClassificationKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDefaults = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-replay", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const data = (await response.json()) as ReplayResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Replay er ikke tilgÃ¦ngelig");
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

  async function runReplay(requestedMode = mode, confirmationOverride?: string) {
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
          mode: requestedMode,
          confirmation: confirmationOverride ?? confirmation,
          replayRunId,
          expectedDryRun: requestedMode === "test-run" || requestedMode === "replay" ? result?.dryRun ?? null : null,
        }),
      });
      const data = (await response.json()) as ReplayResponse;
      if (data.staleDryRun) {
        setResult((current) => current ? { ...current, __stale: true } : current);
      }
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Replay fejlede");
      setPreviousResult(result);
      setResult({ ...data, __inputKey: replayInputKey(form, cashRegister, replayRunId), __stale: false });
      setWindows(data.windows ?? []);
      setTotals(data.totals ?? null);
      setMessage(requestedMode === "dry-run" ? "Dry-run er gennemfÃ¸rt uden lagerÃ¦ndringer." : "Replay er kÃ¸rt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay fejlede");
    } finally {
      setRunning(false);
    }
  }

  function handleRunClick() {
    if (mode === "dry-run") {
      void runReplay("dry-run");
      return;
    }
    if (!isMatchingDryRunReady(result, form, cashRegister, replayRunId)) {
      setError("KÃ¸r dry-run for prÃ¦cis samme tidsinterval fÃ¸rst.");
      return;
    }
    if (!result?.testRun?.enabled) {
      setError(formatTestRunBlockers(result));
      return;
    }
    if (mode === "replay") {
      if (window.confirm("Dette opretter rigtige lagerposteringer, kontrolsager, permanente notifikationer og push. Fortsæt?")) {
        void runReplay("replay", historicalReplayProductionConfirmationText);
      }
    } else {
      setConfirmation("");
      setShowTestRunConfirm(true);
    }
  }

  async function confirmTestRun() {
    if (!isReplayConfirmationMatch(confirmation)) {
      setError(`Test-run kræver bekræftelsen ${historicalReplayConfirmationText}`);
      return;
    }
    setShowTestRunConfirm(false);
    await runReplay("test-run");
  }

  async function saveReturnClassification(item: ReplayReturnAudit, classification: string) {
    try {
      setSavingClassificationKey(item.replayKey);
      setError(null);
      setMessage(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-replay", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          venue: form.venue ?? null,
          transactionId: item.transactionId,
          receiptNumber: item.receiptNumber,
          cashRegisterName: item.cashRegister,
          classification,
          reason: "Manuel V1 replay-klassifikation",
        }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Klassifikation kunne ikke gemmes");
      setResult((current) => current ? { ...current, __stale: true } : current);
      setMessage("Klassifikation gemt. Det eksisterende dry-run er nu forældet.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Klassifikation kunne ikke gemmes");
    } finally {
      setSavingClassificationKey(null);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="OnlinePOS replay" subtitle="Historisk dry-run af 10-minutters sync fÃ¸r markedet" />

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
            <select value={mode} onChange={(e) => setMode(e.target.value as "dry-run" | "test-run" | "replay")} className="field">
              <option value="dry-run">Dry-run</option>
              <option value="test-run">Test-run</option>
              <option value="replay">Faktisk replay</option>
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
        {mode === "test-run" ? <TestRunNotice result={result} form={form} cashRegister={cashRegister} replayRunId={replayRunId} running={running} onRunDryRun={() => void runReplay("dry-run")} /> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={handleRunClick} disabled={running || isTestRunActionDisabled(mode, result, form, cashRegister, replayRunId)}>
            <Play className="h-4 w-4" aria-hidden />{running ? "KÃ¸rer..." : replayActionLabel(mode, result, form, cashRegister, replayRunId)}
          </Button>
          <Button type="button" tone="secondary" onClick={() => setReplayRunId(crypto.randomUUID())}>Nyt replay id</Button>
        </div>
      </section>

      {showTestRunConfirm ? (
        <TestRunConfirmModal
          result={result}
          confirmation={confirmation}
          setConfirmation={setConfirmation}
          running={running}
          onCancel={() => setShowTestRunConfirm(false)}
          onConfirm={confirmTestRun}
        />
      ) : null}

      {totals ? (
        <section className="mb-5 grid gap-3 md:grid-cols-7">
          <Metric label="Unikke transaktioner" value={totals.uniqueTransactionCount ?? 0} />
          <Metric label="Unikke linjer" value={totals.uniqueLineCount ?? 0} />
          <Metric label="Behandlet" value={totals.processedCount ?? 0} />
          <Metric label="Ignorerede linjer" value={totals.classifiedIgnoredCount ?? 0} />
          <Metric label="Dubletter" value={totals.duplicateCount ?? 0} />
          <Metric label="Manglende mappings" value={totals.missingMappingCount ?? 0} />
          <Metric label="Forventet lagertrÃ¦k" value={totals.expectedStockDelta ?? 0} />
        </section>
      ) : null}

      {result && previousResult ? <Comparison current={result} previous={previousResult} /> : null}
      {result?.locationMappingDebug ? <LocationMappingDebug result={result} /> : null}
      {result?.blockingIssueGroups?.length ? <BlockingIssueGroups rows={result.blockingIssueGroups} /> : null}
      {result?.testRunPlan?.manualReviews.length ? <ManualReviewOverview rows={result.testRunPlan.manualReviews} /> : null}
      {result?.ignoredDetails?.length ? <IgnoredLinesOverview result={result} /> : null}
      {result?.errorSummary?.length ? <ErrorOverview result={result} /> : null}
      {result?.errorDetails?.some((item) => item.locationDiagnostics) ? <LocationDiagnosticsOverview result={result} /> : null}
      {result?.returns?.length ? <ReturnOverview result={result} onClassify={saveReturnClassification} savingKey={savingClassificationKey} /> : null}
      {result?.modifierAudit?.length ? <ModifierOverview rows={result.modifierAudit} /> : null}
      {result?.unmappedProducts?.length ? <UnmappedProducts rows={result.unmappedProducts} /> : null}
      {result?.stockPreview?.length ? <StockPreview rows={result.stockPreview} /> : null}
      {result?.duplicateDetails?.length ? <DuplicateOverview rows={result.duplicateDetails} /> : null}
      {result?.applyResult ? <TestRunResult result={result} /> : null}

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
              <div className="grid gap-2 text-sm md:grid-cols-7">
                <Mini label="API-sider" value={window.apiPages ?? "-"} />
                <Mini label="Transaktioner" value={window.transactionCount ?? "-"} />
                <Mini label="Linjer" value={window.salesLineCount ?? "-"} />
                <Mini label="Returer" value={window.returnTransactionCount ?? "-"} />
                <Mini label="Dubletter" value={window.duplicateCount ?? "-"} />
                <Mini label="Ignoreret" value={window.ignoredDetails?.length ?? 0} />
                <Mini label="Fejl" value={window.failedCount ?? "-"} />
              </div>
              {window.cashRegisters?.length ? <p className="mt-2 text-xs font-bold text-muted">Kasser: {window.cashRegisters.join(", ")}</p> : null}
              {window.unmappedProducts?.length ? <Notice tone="pending" className="mt-2">Umappede produkter: {window.unmappedProducts.slice(0, 8).join(", ")}</Notice> : null}
              {window.unmappedLocations?.length ? <Notice tone="danger" className="mt-2">Umappede lokationer: {window.unmappedLocations.join(", ")}</Notice> : null}
              {window.modifiers || window.deposits ? <p className="mt-2 text-xs font-bold text-muted">Modifiers: {window.modifiers ?? 0} Â· Pant/gebyr: {window.deposits ?? 0}</p> : null}
              {window.ignoredSummary?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {window.ignoredSummary.map((item) => <StatusPill key={item.code} tone="info">{item.code}: {item.count}</StatusPill>)}
                </div>
              ) : null}
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

function NotificationPreview({ preview, mode }: { preview: NonNullable<ReplayResponse["notificationPreview"]>; mode: string }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="text-lg font-bold text-ink">Kontrol- og notifikationspreview</h2>
      <p className="mt-1 text-sm font-medium text-muted">{mode === "replay" ? "Oprettede handlinger" : "Handlinger der ville blive udført ved faktisk replay"}. Eventansvarlige er ikke standardmodtagere.</p>
      <div className="mt-3 space-y-2">
        {preview.controls.map((item) => (
          <article key={item.receiptKey} className="rounded-xl bg-soft p-3 text-sm">
            <p className="font-bold text-ink">Bon {item.receiptNumber ?? item.transactionId ?? "ukendt"}: {item.rules.join(", ")}</p>
            <p className="mt-1 text-muted">Regelgrundlag: {item.why.join(", ") || "Kontrolregel matchede"}</p>
            <p className="mt-1 text-muted">Permanent besked og push: {item.wouldSendPushTo.map((recipient) => recipient.name ?? recipient.email ?? recipient.id).join(", ") || "Ingen aktive økonomiansvarlige fundet"}</p>
          </article>
        ))}
        {preview.seriousHistoricalErrors.map((item, index) => (
          <article key={`${item.rule}-${item.transactionId ?? item.receiptNumber ?? index}`} className="rounded-xl bg-soft p-3 text-sm">
            <p className="font-bold text-warmRed">{item.rule}: {item.why}</p>
            <p className="mt-1 text-muted">Alvorlig historisk fejl → Ejer: {item.wouldSendPushTo.map((recipient) => recipient.name ?? recipient.email ?? recipient.id).join(", ") || "Ingen aktive ejere fundet"}</p>
          </article>
        ))}
        {preview.controls.length === 0 && preview.seriousHistoricalErrors.length === 0 ? <p className="text-sm font-bold text-muted">Ingen kontrolhændelser i intervallet.</p> : null}
      </div>
    </section>
  );
}

function TestRunNotice({ result, form, cashRegister, replayRunId, running, onRunDryRun }: { result: ReplayResponse | null; form: ReplayForm; cashRegister: string; replayRunId: string; running: boolean; onRunDryRun: () => void }) {
  const matching = isMatchingDryRunReady(result, form, cashRegister, replayRunId);
  const meta = result?.dryRun;
  const uncertainCount = result?.testRunPlan?.manualReviewReceiptCount ?? 0;
  const rerun = <Button type="button" tone="secondary" onClick={onRunDryRun} disabled={running}><RefreshCw className="h-4 w-4" aria-hidden />Kør nyt dry-run med samme interval</Button>;
  if (!matching || result?.__stale) {
    return <div className="mt-3 space-y-2"><Notice tone="pending">Det eksisterende dry-run er manglende eller forældet. Kør et nyt dry-run for præcis dette interval.</Notice>{rerun}</div>;
  }
  if (!result?.testRun?.enabled) {
    return <div className="mt-3 space-y-2"><DryRunDetails meta={meta} form={form} />
      <Notice tone="danger">{formatTestRunBlockers(result)} <a className="ml-1 font-bold underline" href="#replay-blokeringer">Gå til den tekniske blokering</a></Notice>
      {rerun}
    </div>;
  }
  const exceptionCount = uncertainCount + (result?.testRunPlan?.mappingSkippedLineCount ?? 0);
  return <div className="mt-3 space-y-2"><DryRunDetails meta={meta} form={form} />
    {uncertainCount > 0 ? <Notice tone="pending">{uncertainCount} boner sendes til manuel kontrol og får ingen lagerpåvirkning. <a className="font-bold underline" href="#manuel-kontrol">Se kontrolsager</a></Notice> : null}
    <Notice tone={exceptionCount > 0 ? "pending" : "success"}>{exceptionCount > 0 ? "Klar til sikkert test-run med undtagelser" : "Klar til test-run"}. Gennemgå forventet lagerpåvirkning og bekræft i modal.</Notice>
  </div>;
}

function DryRunDetails({ meta, form }: { meta: DryRunMeta | undefined; form: ReplayForm }) {
  if (!meta) return null;
  return <div className="rounded-xl border border-line bg-soft/40 p-3 text-xs font-medium text-muted">
    <p><span className="font-bold text-ink">Dry-run-id:</span> {meta.id}</p>
    <p><span className="font-bold text-ink">Kørt:</span> {formatDateTime(meta.completedAt)}</p>
    <p><span className="font-bold text-ink">Interval:</span> {form.date} {form.startTime}-{form.endTime}</p>
    <p><span className="font-bold text-ink">Blokeringer:</span> {meta.blockingErrorSummary.length ? meta.blockingErrorSummary.map((item) => `${item.code} (${item.count})`).join(", ") : "Ingen"}</p>
  </div>;
}

function TestRunConfirmModal({
  result,
  confirmation,
  setConfirmation,
  running,
  onCancel,
  onConfirm,
}: {
  result: ReplayResponse | null;
  confirmation: string;
  setConfirmation: (value: string) => void;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const stockRows = result?.stockPreview ?? [];
  const confirmationMatches = isReplayConfirmationMatch(confirmation);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 md:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-macro p-4 shadow-xl md:p-5">
        <h2 className="text-xl font-bold text-ink">Godkend historical test-run</h2>
        <p className="mt-1 text-sm font-medium text-muted">
          Test-run bruger samme idempotente OnlinePOS-sync RPC. Linjer, der allerede er behandlet, bliver markeret som dubletter.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric label="Sikre linjer behandles" value={result?.testRunPlan?.safeLineCount ?? 0} />
          <Metric label="Boner til kontrol" value={result?.testRunPlan?.manualReviewReceiptCount ?? 0} />
          <Metric label="Mapping-linjer springes over" value={result?.testRunPlan?.mappingSkippedLineCount ?? 0} />
          <Metric label="Dubletter i dry-run" value={result?.totals?.duplicateCount ?? 0} />
        </div>
        {stockRows.length ? <StockPreview rows={stockRows.slice(0, 40)} /> : <Notice tone="pending" className="mt-4">Ingen lagerpÃ¥virkning i dette interval.</Notice>}
        <Field label={`Skriv ${historicalReplayConfirmationText}`}>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="field"
            placeholder={historicalReplayConfirmationText}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
          />
        </Field>
        <p className={`mt-2 text-sm font-bold ${confirmationMatches ? "text-pantone140" : "text-muted"}`} aria-live="polite">
          {confirmationMatches ? "Teksten matcher. Test-run kan bekræftes." : `Teksten skal matche: ${historicalReplayConfirmationText}`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" tone="secondary" onClick={onCancel} disabled={running}>Annuller</Button>
          <Button type="button" onClick={onConfirm} disabled={running || !confirmationMatches}>
            {running ? "KÃ¸rer..." : "Godkend test-run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TestRunResult({ result }: { result: ReplayResponse }) {
  const apply = result.applyResult;
  const summary = result.testRunResult;
  if (!apply) return null;
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Test-run resultat</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Behandlet sikkert" value={summary?.safelyProcessedCount ?? apply.processedCount} />
        <Metric label="Faktiske lagerændringer" value={summary?.actualStockChangeCount ?? result.actualStockChanges?.length ?? 0} />
        <Metric label="Dubletter" value={summary?.duplicateCount ?? apply.duplicateCount} />
        <Metric label="Ignorerede linjer" value={summary?.ignoredLineCount ?? 0} />
        <Metric label="Sendt til manuel kontrol" value={summary?.manualReviewReceiptCount ?? 0} />
        <Metric label="Kræver mapping" value={summary?.mappingSkippedLineCount ?? 0} />
        <Metric label="Økonomikontroller" value={summary?.economicControlCount ?? 0} />
        <Metric label="Tekniske fejl" value={summary?.technicalErrorCount ?? apply.failedCount} />
      </div>
      <p className="mt-3 text-xs font-bold text-muted">Sync-run: {apply.runId}</p>
    </section>
  );
}

function Comparison({ current, previous }: { current: ReplayResponse; previous: ReplayResponse }) {
  const rows = [
    ["Fejl", previous.totals?.errorCount ?? 0, current.totals?.errorCount ?? 0],
    ["Umappede produkter", previous.unmappedProducts?.length ?? 0, current.unmappedProducts?.length ?? 0],
    ["Umappede lokationer", countLocationErrors(previous), countLocationErrors(current)],
    ["Ignorerede linjer", previous.totals?.classifiedIgnoredCount ?? 0, current.totals?.classifiedIgnoredCount ?? 0],
    ["Klare lagerlinjer", previous.stockPreview?.length ?? 0, current.stockPreview?.length ?? 0],
    ["Usikre returer", previous.returnSummary?.uncertain ?? 0, current.returnSummary?.uncertain ?? 0],
  ] as const;
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Sammenligning med forrige dry-run</h2>
      <div className="grid gap-2 md:grid-cols-6">
        {rows.map(([label, before, after]) => (
          <Metric key={label} label={`${label}: ${before} â†’`} value={after} />
        ))}
      </div>
    </section>
  );
}

function LocationMappingDebug({ result }: { result: ReplayResponse }) {
  const latest = result.locationMappingDebug?.latest;
  if (!latest) return null;
  const canonicalRows = (result.locationMappingDebug?.windows ?? []).flatMap((window) =>
    window.canonicalLocations.map((diagnostics) => ({ replayWindow: window.replayWindow, diagnostics })),
  );
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Lokationsmapping runtime</h2>
      <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold text-muted">
        <StatusPill tone="info">Supabase: {result.locationMappingDebug?.supabaseProjectHostOnly ?? "-"}</StatusPill>
        <StatusPill tone="success">Aktive mappings: {latest.activeApprovedMappingCount}</StatusPill>
        <StatusPill tone="info">RÃ¦kker hentet: {latest.mappingsLoaded.length}</StatusPill>
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
      {canonicalRows.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-bold text-ink">Canonical resolution pr. replay-vindue</h3>
          <CompactTable
            headers={["Vindue", "Canonical key", "Navne", "IDs", "Venues", "Match", "Valgt mapping", "Dubletter/konflikter"]}
            rows={canonicalRows.slice(0, 160).map(({ replayWindow, diagnostics }) => [
              replayWindow,
              diagnostics.canonicalKey,
              diagnostics.incomingNames.join(", ") || "-",
              diagnostics.incomingIds.join(", ") || "-",
              diagnostics.venueValues.join(", ") || "-",
              diagnostics.matchMethod ?? "-",
              diagnostics.selectedMappingRow
                ? `${diagnostics.selectedMappingRow.cashRegisterName} → ${diagnostics.selectedMappingRow.backeventLocationId ?? "-"}`
                : "-",
              diagnostics.conflictingCandidates.length > 0
                ? diagnostics.conflictingCandidates.map((candidate) => candidate.id).join(", ")
                : "0",
            ])}
          />
        </div>
      ) : null}

      {result?.notificationPreview ? <NotificationPreview preview={result.notificationPreview} mode={result.mode ?? "dry-run"} /> : null}
    </section>
  );
}

function LocationDiagnosticsOverview({ result }: { result: ReplayResponse }) {
  const rows = (result.errorDetails ?? []).filter((item) => item.locationDiagnostics).slice(0, 80);
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Lokationsfejl diagnostik</h2>
      <CompactTable
        headers={["Vindue", "Kode", "Canonical key", "Navne", "IDs", "Venues", "Match", "Kandidater"]}
        rows={rows.map((item) => [
          item.replayWindow,
          item.errorCode,
          item.locationDiagnostics?.canonicalKey ?? "-",
          item.locationDiagnostics?.incomingNames.join(", ") || item.cashRegister || "-",
          item.locationDiagnostics?.incomingIds.join(", ") || "-",
          item.locationDiagnostics?.venueValues.join(", ") || "-",
          item.locationDiagnostics?.matchMethod ?? "-",
          formatLocationDiagnostics(item.locationDiagnostics),
        ])}
      />
    </section>
  );
}

function ManualReviewOverview({ rows }: { rows: NonNullable<ReplayResponse["testRunPlan"]>["manualReviews"] }) {
  return <section id="manuel-kontrol" className="mb-5 scroll-mt-4 rounded-2xl border border-pantone139 bg-pantone139/10 p-4 shadow-sm md:p-5">
    <h2 className="mb-2 text-lg font-bold text-ink">Sendt til manuel kontrol</h2>
    <p className="mb-3 text-sm font-bold text-muted">Disse boner får ingen lagerpåvirkning og kan behandles ved et nyt replay efter klassifikation.</p>
    <CompactTable
      headers={["Bon", "Årsag", "Signaler", "Linjer", "Kontrolbesked"]}
      rows={rows.map((row) => [
        row.receiptNumber ?? row.transactionId ?? "Ukendt bon",
        row.reason,
        row.signals.join(", ") || "Ingen",
        row.lineCount,
        row.wouldCreateControlMessage ? "Ville oprette kontrolbesked" : "-",
      ])}
    />
  </section>;
}

function BlockingIssueGroups({ rows }: { rows: ReplayBlockingIssueGroup[] }) {
  return (
    <section id="replay-blokeringer" className="mb-5 scroll-mt-4 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Ikke behandlet – kræver mapping eller kontrol</h2>
        <StatusPill tone="danger">{rows.reduce((sum, row) => sum + row.count, 0)} blokeringer</StatusPill>
      </div>
      <p className="mb-3 text-sm font-medium text-muted">
        Ret produkt- og modifierproblemer i Produktmapping. Usikre returboner klassificeres længere nede på denne side.
      </p>
      <CompactTable
        headers={["Type", "Gruppe", "Antal", "Eksempel", "Kasse", "Tid", "Antal", "Beløb", "Rettes her"]}
        rows={rows.slice(0, 120).map((item) => [
          item.code,
          <span key={item.groupKey}><span className="font-bold">{item.label}</span><span className="block text-[11px] text-muted">{item.details}</span></span>,
          item.count,
          item.exampleReceiptNumber ?? item.exampleTransactionId ?? "-",
          item.cashRegister ?? "-",
          formatDateTime(item.datetime),
          formatNumber(item.quantity),
          formatMoney(item.amount),
          item.adminHref.startsWith("#")
            ? item.adminLabel
            : <a className="font-bold text-pantone140 underline" href={item.adminHref}>{item.adminLabel}</a>,
        ])}
      />
    </section>
  );
}

function IgnoredLinesOverview({ result }: { result: ReplayResponse }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Ignorerede linjer</h2>
        <div className="flex flex-wrap gap-2">
          {(result.ignoredSummary ?? []).map((item) => (
            <StatusPill key={item.code} tone="info">{item.code}: {item.count}</StatusPill>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm font-medium text-muted">
        Disse linjer er sikkert klassificeret uden lagerforbrug. De tæller ikke som fejl og blokerer ikke test-run.
      </p>
      <CompactTable
        headers={["Vindue", "Kategori", "Kasse", "Produkt", "Bon", "Antal", "Beløb", "Årsag"]}
        rows={(result.ignoredDetails ?? []).slice(0, 120).map((item) => [
          item.replayWindow,
          item.ignoredCode,
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

function ErrorOverview({ result }: { result: ReplayResponse }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Fejloversigt</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {result.errorSummary?.map((item) => <StatusPill key={item.code} tone="danger">{item.code}: {item.count}</StatusPill>)}
      </div>
      <CompactTable
        headers={["Vindue", "Kode", "Kasse", "Produkt", "Bon", "Antal", "BelÃ¸b", "Besked"]}
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

function ReturnOverview({
  result,
  onClassify,
  savingKey,
}: {
  result: ReplayResponse;
  onClassify: (item: ReplayReturnAudit, classification: string) => void;
  savingKey: string | null;
}) {
  return (
    <section id="returklassifikation" className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Bonklassifikation og økonomikontrol</h2>
      <p className="mb-3 text-sm font-bold text-muted">
        Returbon: {result.returnSummary?.verified ?? 0} · Salg med pantretur: {result.returnSummary?.saleWithDepositReturn ?? 0} · Usikker: {result.returnSummary?.uncertain ?? 0}
      </p>
      <div className="space-y-3">
        {(result.returns ?? []).slice(0, 80).map((item) => (
          <article key={item.replayKey} className="rounded-xl border border-line bg-soft/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-ink">{item.receiptNumber ?? item.transactionId ?? "Bon mangler"} · {item.cashRegister ?? "Ukendt kasse"}</p>
                <p className="text-xs font-bold text-muted">
                  {item.classification} · {formatDateTime(item.datetime)} · Total {formatMoney(item.total ?? 0)}
                </p>
                <p className="mt-1 text-xs font-medium text-muted">
                  Signaler: {item.signals.join(", ") || "ingen"} · Negative linjer: {item.negativeLines} · Pantlinjer: {item.depositLines}
                  {item.manualClassification ? ` · Manuel: ${formatManualClassification(item.manualClassification)}` : ""}
                </p>
                {item.controlTriggers.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-line bg-soft/40 p-2 text-xs font-medium text-ink">
                    <p className="font-bold">Økonomikontrol</p>
                    <p>Triggers: {item.controlTriggers.join(", ")}</p>
                    <p>
                      Pant: {formatNumber(item.depositReturnQuantity)} · Krus: {formatNumber(item.depositBreakdown.cups)} · Kander: {formatNumber(item.depositBreakdown.pitchers)}
                    </p>
                    <p>Køb: {formatMoney(item.purchaseValue)} · Pantretur: {formatMoney(item.depositReturnValue)} · Sluttotal: {formatMoney(item.finalTotal)}</p>
                  </div>
                ) : null}
              </div>
              {item.classification === "Usikker retur" ? (
                <div className="flex flex-wrap gap-2">
                  {[
                    ["sale", "Almindeligt salg"],
                    ["return", "Returbon"],
                    ["void", "Annulleret/void"],
                    ["ignored_testdata", "Ignorer testdata"],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      tone={value === "return" ? "primary" : "secondary"}
                      onClick={() => onClassify(item, value)}
                      disabled={savingKey === item.replayKey}
                    >
                      {savingKey === item.replayKey ? "Gemmer..." : label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {item.lines.slice(0, 8).map((line, index) => (
                <div key={`${line.lineId ?? index}`} className="rounded-lg border border-line bg-macro px-3 py-2 text-xs font-medium text-ink">
                  <span className="font-bold">{line.productName ?? "Ukendt vare"}</span>
                  <span className="block text-muted">
                    {line.lineType} · {formatNumber(line.quantity)} stk · {formatMoney(line.amount)}
                    {line.productGroupName ? ` · ${line.productGroupName}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ModifierOverview({ rows }: { rows: ReplayModifierAudit[] }) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-lg font-bold text-ink">Modifier- og 0-pris-audit</h2>
      <CompactTable
        headers={["Vindue", "Linje", "Parent", "Produkt", "BelÃ¸b", "Ã˜konomi", "Lager", "Beslutning"]}
        rows={rows.slice(0, 80).map((item) => [
          item.replayWindow,
          item.lineId ?? "-",
          item.parentLineId ?? "-",
          item.productName ?? "-",
          formatMoney(item.amount),
          item.economyProduct ?? "-",
          item.stockRelevant ? item.stockProduct ?? "KrÃ¦ver mapping" : "Ikke lager",
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
      <h2 className="mb-3 text-lg font-bold text-ink">Forventet lagerpÃ¥virkning</h2>
      <CompactTable
        headers={["Vindue", "Lokation", "BackEvent-vare", "OnlinePOS", "Forbrug", "Beregning", "Lagerværdi", "Mapping", "Status"]}
        rows={rows.slice(0, 120).map((item) => [
          item.replayWindow,
          item.locationName,
          item.backeventProductName,
          item.onlineposProductName ?? item.onlineposProductId ?? "-",
          item.quantityText,
          `${formatNumber(item.soldQuantity)} × ${formatNumber(item.consumptionPerSale)} ${item.consumptionUnit} = ${formatNumber(item.totalConsumptionQuantity)} ${item.consumptionUnit} · ÷ ${formatNumber(item.conversionDivisor)} (× ${formatNumber(item.conversionMultiplier)})`,
          formatNumber(item.finalStoredDelta),
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

function formatManualClassification(value: string) {
  if (value === "sale") return "Almindeligt salg";
  if (value === "return") return "Returbon";
  if (value === "void") return "Annulleret/void";
  if (value === "ignored_testdata") return "Ignoreret testdata";
  return value;
}

function formatLocationDiagnostics(diagnostics: ReplayErrorDetail["locationDiagnostics"]) {
  if (!diagnostics) return "-";
  if (diagnostics.conflictingCandidates.length > 0) {
    return `Konflikt: ${diagnostics.conflictingCandidates.map((candidate) => `${candidate.id} → ${candidate.backeventLocationId ?? "-"}`).join(" | ")}`;
  }
  if (diagnostics.selectedMappingRow) {
    return `${diagnostics.matchMethod ?? "-"}: ${diagnostics.selectedMappingRow.id} → ${diagnostics.selectedMappingRow.backeventLocationId ?? "-"}`;
  }
  const candidates = diagnostics.candidateMappingsLoaded;
  if (candidates.length === 0) {
    return `Ingen kandidater Â· incoming=${diagnostics.incomingName ?? "-"} Â· id=${diagnostics.incomingId ?? "-"} Â· venue=${diagnostics.venueId ?? "-"} Â· norm=${diagnostics.normalizedName ?? "-"}`;
  }
  return candidates
    .map((candidate) => `${candidate.cashRegisterName} Â· norm=${candidate.normalizedCashRegisterName || "-"} Â· id=${candidate.cashRegisterId ?? "-"} Â· venue=${candidate.venueId ?? "-"} Â· aktiv=${candidate.active ? "ja" : "nej"} Â· BE=${candidate.hasBackeventLocation ? "ja" : "nej"}`)
    .join(" | ");
}

function countLocationErrors(result: ReplayResponse) {
  return result.errorDetails?.filter((item) => item.errorCode === "LOCATION_MAPPING_MISSING" || item.errorCode === "LOCATION_MAPPING_CONFLICT").length ?? 0;
}

function replayInputKey(form: ReplayForm, cashRegister: string, replayRunId: string) {
  return [
    form.date,
    form.startTime,
    form.endTime,
    form.intervalMinutes,
    form.overlapMinutes,
    form.venue ?? "",
    cashRegister.trim(),
    replayRunId.trim(),
  ].join("|");
}

function isMatchingDryRunReady(result: ReplayResponse | null, form: ReplayForm, cashRegister: string, replayRunId: string) {
  if (!result?.ok || result.mode !== "dry-run" || !result.windows?.length) return false;
  const current = replayInputKey(form, cashRegister, replayRunId);
  const stored = result.__inputKey;
  return stored ? stored === current : true;
}

function isTestRunActionDisabled(mode: "dry-run" | "test-run" | "replay", result: ReplayResponse | null, form: ReplayForm, cashRegister: string, replayRunId: string) {
  return mode !== "dry-run" && (!isMatchingDryRunReady(result, form, cashRegister, replayRunId) || Boolean(result?.__stale) || !result?.testRun?.enabled);
}

function replayActionLabel(mode: "dry-run" | "test-run" | "replay", result: ReplayResponse | null, form: ReplayForm, cashRegister: string, replayRunId: string) {
  if (mode === "dry-run") return "Kør dry-run";
  if (!isMatchingDryRunReady(result, form, cashRegister, replayRunId) || result?.__stale) return "Kør nyt dry-run først";
  if (result?.testRun?.blockingErrorSummary?.length) return "Løs blokeringer først";
  return mode === "replay" ? "Kør faktisk replay" : "Kør test-run";
}

function formatTestRunBlockers(result: ReplayResponse | null) {
  const blockers = result?.testRun?.blockingErrorSummary ?? [];
  if (!result) return "KÃ¸r dry-run fÃ¸rst.";
  if (!blockers.length) return "Test-run er blokeret af dry-run-resultatet.";
  return `Test-run er blokeret: ${blockers.map((item) => `${item.code} (${item.count})`).join(", ")}`;
}
