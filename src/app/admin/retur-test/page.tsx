"use client";

import { AlertTriangle, Bug, CheckCircle2, Plus, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Card, Notice, StatusPill } from "@/components/backevent/ui";
import { buildReturnTestLinePreview, calculateReturnEconomy } from "@/lib/backevent/return-test-harness-core";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Scenario = { id: string; label: string };
type UnitOption = { value: string; label: string };
type LocationOption = { id: string; name: string };
type ProductOption = {
  id: string;
  name: string;
  unit: string | null;
  return_handling: "return_to_stock" | "waste" | "manual_review" | "no_stock_effect" | null;
  purchase_unit_label?: string | null;
  units_per_purchase_unit?: number | string | null;
  units_per_case?: number | string | null;
  stock_unit_label?: string | null;
  content_per_stock_unit?: number | string | null;
  consumption_unit_label?: string | null;
  defaultInputUnit: string;
  inputUnits: UnitOption[];
};
type RecentReturn = {
  id: string;
  receipt_number: string | null;
  test_scenario: string | null;
  created_at: string;
  processing_status: string;
  control_status: string;
};
type HarnessData = {
  ok: boolean;
  scenarios?: Scenario[];
  locations?: LocationOption[];
  products?: ProductOption[];
  recentReturns?: RecentReturn[];
  message?: string;
};
type ReturnLineForm = {
  clientLineId: string;
  productId: string;
  quantity: string;
  inputUnit: string;
  amount: string;
  lineType: "main" | "modifier" | "deposit" | "cup" | "fee";
  parentClientLineId: string;
};

const defaultReceipt = `TEST-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const lineTypeLabels = {
  main: "Hovedprodukt",
  modifier: "Modifier",
  deposit: "Pant",
  cup: "Krus",
  fee: "Gebyr",
};
const handlingLabels: Record<string, string> = {
  return_to_stock: "Tilbage på lager",
  waste: "Svind",
  no_stock_effect: "Ingen lagerpåvirkning",
  manual_review: "Kræver manuel kontrol",
};

export default function ReturnTestHarnessPage() {
  const [data, setData] = useState<HarnessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    scenario: "normal_return",
    locationId: "",
    receiptNumber: defaultReceipt,
    returnedAt: toLocalDateTime(new Date()),
    runId: crypto.randomUUID(),
  });
  const [lines, setLines] = useState<ReturnLineForm[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/returns/test-harness", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = (await response.json()) as HarnessData;

      if (!response.ok || !json.ok) throw new Error(json.message ?? "Retur-test kunne ikke hentes");

      setData(json);
      setForm((current) => ({
        ...current,
        locationId: current.locationId || json.locations?.[0]?.id || "",
      }));
      setLines((current) => current.length > 0 ? current : [newLine(json.products?.[0])]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retur-test kunne ikke hentes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const products = useMemo(() => data?.products ?? [], [data?.products]);
  const preview = useMemo(() => buildPreview(lines, products), [lines, products]);

  async function runTest(mode: "run" | "rerun" | "duplicate" | "changed_duplicate" | "simulated_error" = "run") {
    try {
      setRunning(true);
      setError(null);
      setMessage(null);
      setLastResult(null);
      const body = buildBody(mode);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/returns/test-harness", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { ok: boolean; message?: string; result?: Record<string, unknown> };

      if (!response.ok || !json.ok) throw new Error(json.message ?? "Testretur kunne ikke køres");

      setLastResult(json.result ?? null);
      setMessage("Testretur er kørt gennem Retur & kontrol.");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Testretur fejlede");
    } finally {
      setRunning(false);
    }
  }

  async function cleanup() {
    if (!window.confirm("Vil du rydde alle testreturer? Kun source = test_harness slettes.")) return;
    try {
      setRunning(true);
      setError(null);
      setMessage(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/returns/test-harness", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirmation: cleanupConfirmation }),
      });
      const json = (await response.json()) as { ok: boolean; message?: string; deletedReturns?: number };

      if (!response.ok || !json.ok) throw new Error(json.message ?? "Testdata kunne ikke ryddes");

      setCleanupConfirmation("");
      setMessage(`${json.deletedReturns ?? 0} testreturer er ryddet.`);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Testdata kunne ikke ryddes");
    } finally {
      setRunning(false);
    }
  }

  function buildBody(mode: "run" | "rerun" | "duplicate" | "changed_duplicate" | "simulated_error") {
    const runId = mode === "run" ? crypto.randomUUID() : form.runId;
    if (mode === "run") setForm((current) => ({ ...current, runId }));
    return {
      scenario: mode === "changed_duplicate" ? "duplicate_changed" : mode === "simulated_error" ? "simulated_stock_failure" : form.scenario,
      locationId: form.locationId,
      receiptNumber: form.receiptNumber,
      returnedAt: form.returnedAt,
      runId,
      lines: lines.map((line, index) => ({
        ...line,
        quantity: mode === "changed_duplicate" && index === 0 ? parseNumber(line.quantity) + 1 : line.quantity,
        amount: mode === "changed_duplicate" && index === 0 ? parseNumber(line.amount) + 1 : line.amount,
        parentClientLineId: line.parentClientLineId || null,
      })),
    };
  }

  function addLine(product?: ProductOption) {
    setLines((current) => [...current, newLine(product ?? products[0])]);
  }

  function updateLine(index: number, patch: Partial<ReturnLineForm>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function removeLine(index: number) {
    setLines((current) => current.length <= 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
  }

  function applyPreset(preset: string) {
    const [first, second] = products;
    if (!first) return;
    const make = (product: ProductOption, quantity: string, lineType: ReturnLineForm["lineType"], amount: string, parent = "") => ({
      ...newLine(product),
      quantity,
      amount,
      lineType,
      parentClientLineId: parent,
    });

    if (preset === "mixed" && second) setLines([make(first, "1", "main", "25"), make(second, "2", "main", "50"), make(first, "3", "deposit", "15")]);
    if (preset === "multiple_stock" && second) setLines([make(first, "1", "main", "25"), make(second, "2", "main", "50")]);
    if (preset === "parent_modifier" && second) {
      const parent = make(first, "1", "main", "30");
      parent.clientLineId = "parent-1";
      const modifier = make(second, "1", "modifier", "0", "parent-1");
      setLines([parent, modifier]);
    }
    if (preset === "over_10_split" && second) setLines([make(first, "6", "main", "120"), make(second, "5", "main", "100")]);
    if (preset === "deposit_products") setLines([make(first, "6", "main", "120"), make(first, "6", "deposit", "30")]);
    if (preset === "unit") {
      const unit = first.stock_unit_label || first.defaultInputUnit;
      setLines([
        { ...make(first, "1", "main", "25"), inputUnit: unit },
        { ...make(first, "24", "main", "600"), inputUnit: unit },
        { ...make(first, "1", "main", "600"), inputUnit: first.purchase_unit_label || first.unit || "kasse" },
      ]);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="Retur-test" subtitle="Realistisk testharness til Retur & kontrol før markedet" />

      {message ? <Notice tone="success" className="mb-4">{message}</Notice> : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusPill tone="danger">TEST</StatusPill>
        <StatusPill tone="pending">Kun Ejer</StatusPill>
        <StatusPill tone="info">Kræver BACKEVENT_ENABLE_RETURN_TEST_HARNESS=true</StatusPill>
      </div>

      {loading ? (
        <Card><p className="text-sm font-bold text-muted">Henter retur-test...</p></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <main className="space-y-5">
            <Card>
              <div className="mb-4 flex items-start gap-3">
                <div className="rounded-xl bg-warmRed/10 p-2 text-warmRed"><Bug className="h-5 w-5" aria-hidden /></div>
                <div>
                  <h2 className="text-lg font-bold text-ink">Kør testretur</h2>
                  <p className="text-sm font-medium text-muted">Antal tolkes som valgt salgsenhed. Serveren beregner lagerpåvirkning fra produktdata.</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Label text="Scenarie">
                  <select value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })} className="field">
                    {(data?.scenarios ?? []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
                  </select>
                </Label>
                <Label text="Lokation">
                  <select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} className="field">
                    {(data?.locations ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </Label>
                <Label text="Bonnummer">
                  <input value={form.receiptNumber} onChange={(event) => setForm({ ...form, receiptNumber: event.target.value })} className="field" />
                </Label>
                <Label text="Tidspunkt">
                  <input type="datetime-local" value={form.returnedAt} onChange={(event) => setForm({ ...form, returnedAt: event.target.value })} className="field" />
                </Label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => applyPreset("mixed")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Blandet retur</button>
                <button type="button" onClick={() => applyPreset("multiple_stock")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Flere lagerprodukter</button>
                <button type="button" onClick={() => applyPreset("parent_modifier")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Parent + modifier</button>
                <button type="button" onClick={() => applyPreset("over_10_split")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Over 10 fordelt</button>
                <button type="button" onClick={() => applyPreset("deposit_products")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Pant og varer</button>
                <button type="button" onClick={() => applyPreset("unit")} className="rounded-lg bg-soft px-3 py-2 text-xs font-bold text-pantone140">Enhedstest</button>
              </div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">Returlinjer</h2>
                <button type="button" onClick={() => addLine()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-pantone139 px-3 text-sm font-bold text-ink">
                  <Plus className="h-4 w-4" aria-hidden />
                  Tilføj produkt
                </button>
              </div>

              <div className="space-y-3">
                {lines.map((line, index) => {
                  const product = products.find((item) => item.id === line.productId) ?? products[0];
                  const inputUnits = product?.inputUnits ?? [{ value: "stk", label: "stk" }];
                  const linePreview = preview.linePreviews[index];
                  return (
                    <article key={line.clientLineId} className="rounded-xl border border-line bg-soft/40 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="font-bold text-ink">Vare {index + 1}</h3>
                        <button type="button" onClick={() => removeLine(index)} disabled={lines.length <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg bg-warmRed/10 px-2 text-xs font-bold text-warmRed disabled:opacity-40">
                          <X className="h-3.5 w-3.5" aria-hidden />
                          Fjern
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <Label text="Produkt">
                          <select
                            value={line.productId}
                            onChange={(event) => {
                              const nextProduct = products.find((item) => item.id === event.target.value);
                              updateLine(index, { productId: event.target.value, inputUnit: nextProduct?.defaultInputUnit ?? "stk" });
                            }}
                            className="field"
                          >
                            {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </Label>
                        <Label text="Antal">
                          <input value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} className="field" inputMode="decimal" />
                        </Label>
                        <Label text="Enhed">
                          <select value={line.inputUnit} onChange={(event) => updateLine(index, { inputUnit: event.target.value })} className="field">
                            {inputUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                          </select>
                        </Label>
                        <Label text="Beløb">
                          <input value={line.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} className="field" inputMode="decimal" />
                        </Label>
                        <Label text="Linjetype">
                          <select value={line.lineType} onChange={(event) => updateLine(index, { lineType: event.target.value as ReturnLineForm["lineType"] })} className="field">
                            {Object.entries(lineTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </Label>
                        <Label text="Parent">
                          <select value={line.parentClientLineId} onChange={(event) => updateLine(index, { parentClientLineId: event.target.value })} className="field">
                            <option value="">Ingen</option>
                            {lines.filter((item) => item.clientLineId !== line.clientLineId).map((item, itemIndex) => <option key={item.clientLineId} value={item.clientLineId}>Vare {itemIndex + 1}</option>)}
                          </select>
                        </Label>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-bold text-muted md:grid-cols-3">
                        <span>Indtastet: {linePreview?.inputDisplay ?? `${line.quantity || "0"} ${line.inputUnit}`}</span>
                        <span>Automatisk behandling: {linePreview?.automaticHandling ?? handlingLabels[product?.return_handling ?? "manual_review"]}</span>
                        <span>
                          Faktisk påvirkning: {linePreview?.impactDisplay ?? "Kræver manuel kontrol"}
                          {linePreview?.secondaryImpact ? <span className="block font-semibold text-muted/80">{linePreview.secondaryImpact}</span> : null}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 text-lg font-bold text-ink">Seneste testreturer</h2>
              <div className="overflow-hidden rounded-xl border border-line">
                {(data?.recentReturns ?? []).length === 0 ? <p className="px-3 py-3 text-sm font-bold text-muted">Ingen testreturer endnu.</p> : null}
                {(data?.recentReturns ?? []).map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-line px-3 py-2 text-sm">
                    <span className="font-bold text-ink">{item.receipt_number ?? "Bon mangler"}</span>
                    <span className="text-muted">{item.test_scenario ?? "test"} · {item.processing_status}</span>
                    <StatusPill tone="danger" className="px-2 py-0.5 text-[10px]">TEST</StatusPill>
                  </div>
                ))}
              </div>
            </Card>
          </main>

          <aside className="space-y-5">
            <Card>
              <h2 className="mb-2 text-lg font-bold text-ink">Forhåndsvisning</h2>
              <PreviewRow label="Bonnummer" value={form.receiptNumber} />
              <PreviewRow label="Returlinjer" value={String(lines.length)} />
              <PreviewRow label="Varer retur" value={`${formatNumber(preview.productRefund)} kr.`} />
              <PreviewRow label="Pant retur" value={`${formatNumber(preview.depositRefund)} kr.`} />
              <PreviewRow label="Krus retur" value={`${formatNumber(preview.cupRefund)} kr.`} />
              <PreviewRow label="Gebyrer" value={`-${formatNumber(preview.fees)} kr.`} />
              <PreviewRow label="Samlet returbeløb" value={`${formatNumber(preview.netRefund)} kr.`} />
              <PreviewRow label="Forventet lagerretur" value={String(preview.stockReturnCount)} />
              <PreviewRow label="Forventet svind" value={String(preview.wasteCount)} />
              <PreviewRow label="Ingen lagerpåvirkning" value={String(preview.noStockCount)} />
              {preview.controlReasons.length > 0 ? <Notice tone="pending" className="mt-3">{preview.controlReasons.join(" · ")}</Notice> : null}
            </Card>

            <Card>
              <h2 className="mb-2 text-lg font-bold text-ink">Kørsel</h2>
              <div className="grid gap-2">
                <Button type="button" onClick={() => void runTest("run")} disabled={running} size="sm"><Play className="h-4 w-4" aria-hidden />Kør test</Button>
                <Button type="button" onClick={() => void runTest("rerun")} disabled={running} tone="secondary" size="sm"><RotateCcw className="h-4 w-4" aria-hidden />Genkør samme test</Button>
                <Button type="button" onClick={() => void runTest("duplicate")} disabled={running} tone="secondary" size="sm">Opret dublet</Button>
                <Button type="button" onClick={() => void runTest("changed_duplicate")} disabled={running} tone="secondary" size="sm">Ændret dublet</Button>
                <Button type="button" onClick={() => void runTest("simulated_error")} disabled={running} tone="danger" size="sm">Simulér fejl</Button>
              </div>
            </Card>

            <Card>
              <h2 className="mb-2 text-lg font-bold text-ink">Resultat</h2>
              {lastResult ? <pre className="max-h-72 overflow-auto rounded-xl bg-soft p-3 text-xs font-semibold text-ink">{JSON.stringify(lastResult, null, 2)}</pre> : <p className="text-sm font-bold text-muted">Kør en test for at se resultatstruktur.</p>}
            </Card>

            <Card className="border-warmRed/30">
              <div className="mb-3 flex items-center gap-2 text-warmRed"><AlertTriangle className="h-5 w-5" aria-hidden /><h2 className="text-lg font-bold">Oprydning</h2></div>
              <Notice tone="pending" className="mb-3">Tidligere testdata kan være oprettet med forkert enhedsfortolkning. Ryd testdata eller lav sporbar lagerkorrektion.</Notice>
              <input value={cleanupConfirmation} onChange={(event) => setCleanupConfirmation(event.target.value)} placeholder="SLET TESTDATA" className="field mb-3" />
              <Button type="button" onClick={() => void cleanup()} disabled={running || cleanupConfirmation !== "SLET TESTDATA"} tone="danger" size="sm"><Trash2 className="h-4 w-4" aria-hidden />Ryd testdata</Button>
            </Card>

            <Card>
              <div className="flex items-center gap-2 text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden /><h2 className="text-lg font-bold">Sikkerhed</h2></div>
              <ul className="mt-3 space-y-2 text-sm font-medium text-muted">
                <li>Kun Ejer kan åbne API og side.</li>
                <li>Feature flag skal være aktivt.</li>
                <li>Serveren beregner lagerantal fra produktdata.</li>
                <li>Rigtige returdata ryddes aldrig herfra.</li>
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-muted">{text}</span>{children}</label>;
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-line py-2 text-sm"><span className="font-bold text-muted">{label}</span><span className="text-right font-bold text-ink">{value}</span></div>;
}

function newLine(product?: ProductOption): ReturnLineForm {
  return {
    clientLineId: crypto.randomUUID(),
    productId: product?.id ?? "",
    quantity: "1",
    inputUnit: product?.defaultInputUnit ?? "stk",
    amount: "25",
    lineType: "main",
    parentClientLineId: "",
  };
}

function buildPreview(lines: ReturnLineForm[], products: ProductOption[]) {
  let stockReturnCount = 0;
  let wasteCount = 0;
  let noStockCount = 0;
  let ordinaryQuantity = 0;
  const controlReasons = new Set<string>();
  const linePreviews = lines.map((line) => {
    const product = products.find((item) => item.id === line.productId) ?? null;
    const quantity = Math.abs(parseNumber(line.quantity));
    if (!["deposit", "cup", "fee"].includes(line.lineType) && !line.parentClientLineId) ordinaryQuantity += quantity;

    const linePreview = buildReturnTestLinePreview({
      product,
      quantity,
      inputUnit: line.inputUnit,
      lineType: line.lineType,
    });

    if (["deposit", "cup", "fee"].includes(line.lineType) || linePreview.noOrdinaryStockImpact) noStockCount += 1;
    else if (product?.return_handling === "return_to_stock") stockReturnCount += 1;
    else if (product?.return_handling === "waste") wasteCount += 1;
    else controlReasons.add("Kræver manuel kontrol");

    if (linePreview.automaticHandling === "Ukendt produkt") controlReasons.add("Ukendt produkt");
    if (linePreview.automaticHandling === "Kræver manuel kontrol") controlReasons.add("Kræver manuel kontrol");
    return linePreview;
  });
  if (ordinaryQuantity > 10) controlReasons.add("Over 10 almindelige varer");
  const economy = calculateReturnEconomy(lines.map((line) => ({
    lineType: line.lineType,
    amount: parseNumber(line.amount),
  })));
  return {
    productRefund: economy.productRefund,
    depositRefund: economy.depositRefund,
    cupRefund: economy.cupRefund,
    fees: economy.fees,
    netRefund: Math.abs(economy.netAmount),
    netAmount: economy.netAmount,
    stockReturnCount,
    wasteCount,
    noStockCount,
    controlReasons: Array.from(controlReasons),
    linePreviews,
  };
}
async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 }).format(value);
}
