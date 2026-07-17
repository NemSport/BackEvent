"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bell, ChevronDown, ClipboardCheck, Info, MapPin } from "lucide-react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { Button, Card, Notice, StatusPill } from "@/components/backevent/ui";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";
import {
  explainReceiptControlRule,
  formatReceiptClassification,
  formatReceiptControlRule,
  formatReceiptControlStatus,
} from "@/lib/backevent/return-control-contract";

type Control = Record<string, unknown> & {
  id: string;
  receipt_number: string | null;
  onlinepos_transaction_id: string | null;
  transaction_datetime?: string | null;
  created_at: string;
  classification: string;
  control_types: string[];
  deposit_breakdown: Record<string, number>;
  deposit_return_quantity: number;
  purchase_value: number;
  deposit_return_value: number;
  final_total: number;
  source: string;
  replay_run_id: string | null;
  status: string;
  location_name?: string | null;
  location_mapping_status?: "mapped" | "unmapped";
  cash_register_name?: string | null;
  cash_register_id?: string | null;
  handled_by_name?: string | null;
  handled_at?: string | null;
  internal_note?: string | null;
  updated_at: string;
};
type Notification = { id: string; status: string; error_message: string | null; created_at: string; recipient?: { full_name?: string | null; email?: string | null } | null };
type AuditItem = { id: string; previous_status: string; status: string; internal_note: string | null; handled_by_name: string; created_at: string };

export default function ReceiptControlDetailPage() {
  const { controlId } = useParams<{ controlId: string }>();
  const [control, setControl] = useState<Control | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [canControl, setCanControl] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [message, setMessage] = useState("Henter bonkontrol...");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getBrowserAccessToken();
      const response = await fetch(`/api/returns/receipt-controls/${controlId}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = await response.json().catch(() => null) as { ok?: boolean; message?: string; control?: Control; notifications?: Notification[]; audit?: AuditItem[]; canControl?: boolean } | null;
      if (!mounted) return;
      if (!response.ok || !json?.ok || !json.control) {
        setMessage(json?.message ?? `Bonkontrol kunne ikke hentes (HTTP ${response.status})`);
        return;
      }
      setControl(json.control);
      setNotifications(json.notifications ?? []);
      setAudit(json.audit ?? []);
      setCanControl(Boolean(json.canControl));
      setNote(json.control.internal_note ?? "");
      setMessage("");
    })();
    return () => { mounted = false; };
  }, [controlId]);

  async function handle(action: "approve" | "follow_up" | "confirm_error" | "save_note") {
    if (!control || saving) return;
    setSaving(true);
    setSaveMessage(null);
    const token = await getBrowserAccessToken();
    const response = await fetch(`/api/returns/receipt-controls/${controlId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, note, expectedUpdatedAt: control.updated_at }),
    });
    const json = await response.json().catch(() => null) as { ok?: boolean; message?: string; conflict?: boolean } | null;
    if (!response.ok || !json?.ok) {
      setSaveMessage(json?.message ?? "Behandlingen kunne ikke gemmes");
      setSaving(false);
      if (json?.conflict) window.setTimeout(() => window.location.reload(), 900);
      return;
    }
    window.location.reload();
  }

  if (!control) return <AppShell><div className="mx-auto max-w-5xl"><BackButton href="/retur/kontrol" /><Card className="my-5"><h1 className="text-2xl font-bold text-ink">Bonkontrol</h1><p className="mt-2 font-bold text-warmRed">{message}</p></Card></div></AppShell>;

  const primaryTime = control.transaction_datetime ?? control.created_at;
  const hasLocation = Boolean(control.location_name || control.cash_register_name || control.cash_register_id);
  const displayedLocation = control.location_name ?? control.cash_register_name ?? control.cash_register_id ?? "Ukendt";
  const rules = control.control_types ?? [];
  const sentCount = notifications.filter((item) => item.status === "sent").length;
  const failedCount = notifications.filter((item) => item.status === "failed" || item.status === "skipped").length;
  const statusTone = control.status === "approved" || control.status === "resolved" ? "success" : control.status === "confirmed_error" || control.status === "dismissed" ? "danger" : control.status === "test" ? "info" : "pending";

  return <AppShell><main className="mx-auto w-full max-w-5xl pb-8">
    <BackButton href="/retur/kontrol" />

    <header className="my-5 border-b border-line pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold leading-tight text-ink md:text-4xl">Bon {control.receipt_number ?? control.onlinepos_transaction_id ?? "ukendt"}</h1>
          <p className="mt-1 text-sm font-semibold text-muted md:text-base">{formatDate(primaryTime)} · {sourceLabel(control.source)}</p>
          {hasLocation ? <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-ink"><MapPin className="h-4 w-4 shrink-0" />Bar: {displayedLocation}{control.location_mapping_status !== "mapped" ? " · Ikke mappet" : control.cash_register_name && control.cash_register_name !== control.location_name ? ` · OnlinePOS: ${control.cash_register_name}` : ""}</p> : <p className="mt-2 text-sm font-bold text-muted">Bar: Ukendt · Ikke mappet</p>}
        </div>
        <StatusPill tone={statusTone} className="self-start">{formatReceiptControlStatus(control.status)}</StatusPill>
      </div>
    </header>

    <section aria-label="Bonens nøgletal" className="mb-5 grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-macro shadow-sm md:grid-cols-4">
      <Metric label="Køb inkl. moms" value={formatMoney(control.purchase_value)} />
      <Metric label="Pant retur inkl. moms" value={formatMoney(control.deposit_return_value)} />
      <Metric label="Bon i alt inkl. moms" value={formatMoney(control.final_total)} />
      <Metric label="Pant" value={`${formatNumber(control.deposit_return_quantity)} stk.`} />
    </section>

    <Card className="mb-5 border-l-4 border-l-pantone139">
      <div className="flex gap-3">
        <ClipboardCheck className="mt-0.5 h-6 w-6 shrink-0 text-pantone140" aria-hidden />
        <div>
          <h2 className="text-lg font-bold text-ink">Hvorfor er bonen markeret?</h2>
          <div className="mt-2 space-y-3">
            {rules.map((rule) => <div key={rule}><p className="font-bold text-ink">{formatReceiptControlRule(rule)}</p><p className="mt-0.5 text-sm leading-relaxed text-muted">{explainReceiptControlRule(rule, control.deposit_return_quantity)}</p></div>)}
            {rules.length === 0 ? <p className="text-sm text-muted">Der er ikke gemt en konkret kontrolårsag.</p> : null}
          </div>
          <p className="mt-3 text-sm font-semibold text-pantone140">{formatReceiptClassification(control.classification)}</p>
        </div>
      </div>
    </Card>

    <div className="mb-5 grid gap-5 md:grid-cols-2">
      <Card>
        <h2 className="text-lg font-bold text-ink">Pantfordeling</h2>
        <dl className="mt-3 divide-y divide-line text-sm">
          <CompactRow label="Krus" value={control.deposit_breakdown?.cups ?? 0} />
          <CompactRow label="Kander" value={control.deposit_breakdown?.pitchers ?? 0} />
          <CompactRow label="Øvrige" value={control.deposit_breakdown?.other ?? 0} />
        </dl>
        <div className="mt-4 flex gap-2 rounded-xl bg-soft px-3 py-2.5 text-xs leading-relaxed text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p>Produktlinjer blev ikke gemt ved dette replay. Fordelingen ovenfor er de gemte totaler.</p></div>
      </Card>

      <Card>
        <div className="flex items-center gap-2"><Bell className="h-5 w-5 text-pantone140" /><h2 className="text-lg font-bold text-ink">Notifikation</h2></div>
        <p className="mt-3 font-bold text-ink">{notificationSummary(notifications, sentCount, failedCount)}</p>
        <p className="mt-1 text-sm text-muted">{notifications.length > 0 ? `${notifications.length} permanent${notifications.length === 1 ? " besked" : "e beskeder"} oprettet` : "Ingen permanent besked oprettet"}</p>
      </Card>
    </div>

    {canControl ? <Card className="mb-5">
      <h2 className="text-lg font-bold text-ink">Behandl kontrol</h2>
      <label htmlFor="internal-note" className="mt-4 block text-sm font-bold text-ink">Intern bemærkning</label>
      <textarea id="internal-note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={4000} placeholder="Skriv hvad du har kontrolleret eller hvad der skal følges op på..." className="mt-2 w-full rounded-xl border border-line bg-macro px-3 py-3 text-ink outline-none focus:border-pantone139 focus:ring-2 focus:ring-pantone140/20" />
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Button type="button" tone="success" disabled={saving} onClick={() => handle("approve")}>Godkend bon</Button>
        <Button type="button" tone="primary" disabled={saving} onClick={() => handle("follow_up")}>Kræver opfølgning</Button>
        <Button type="button" tone="danger" disabled={saving} onClick={() => handle("confirm_error")}>Bekræft fejl</Button>
        <Button type="button" tone="secondary" disabled={saving} onClick={() => handle("save_note")}>Gem bemærkning</Button>
      </div>
      {saveMessage ? <Notice tone="danger" className="mt-3">{saveMessage}</Notice> : null}
      {control.handled_by_name && control.handled_at ? <p className="mt-4 text-sm text-muted">Senest behandlet af <strong className="text-ink">{control.handled_by_name}</strong> {formatDate(control.handled_at)}.</p> : null}
      {audit.length ? <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-bold text-pantone140">Vis behandlingshistorik ({audit.length})</summary><p className="mt-3 text-sm font-bold text-ink">Bar: {displayedLocation}{control.location_mapping_status !== "mapped" ? " · Ikke mappet" : ""}</p><div className="mt-3 space-y-2">{audit.map((item) => <div key={item.id} className="rounded-xl bg-soft p-3 text-sm"><p className="font-bold text-ink">{formatReceiptControlStatus(item.status)} · {item.handled_by_name}</p><p className="text-muted">{formatDate(item.created_at)}</p>{item.internal_note ? <p className="mt-1 whitespace-pre-wrap text-ink">{item.internal_note}</p> : null}</div>)}</div></details> : null}
    </Card> : null}

    <details className="group rounded-2xl border border-line bg-macro shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-ink focus:outline-none focus:ring-2 focus:ring-inset focus:ring-pantone140/35 md:px-5">
        Tekniske oplysninger
        <ChevronDown className="h-5 w-5 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-4 py-4 md:px-5">
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <TechnicalRow label="Kilde" value={sourceLabel(control.source)} />
          <TechnicalRow label="Intern status" value={control.status} />
          <TechnicalRow label="Intern klassifikation" value={control.classification} />
          <TechnicalRow label="Regelkoder" value={rules.join(", ") || "Ingen"} />
          <div className="md:col-span-2"><dt className="font-bold text-muted">Replay-id</dt><dd className="mt-1 flex flex-wrap items-center gap-2"><code className="max-w-full break-all rounded-lg bg-soft px-2 py-1 text-xs text-ink">{control.replay_run_id ?? "Ikke relevant"}</code>{control.replay_run_id ? <button type="button" onClick={() => navigator.clipboard.writeText(control.replay_run_id!)} className="rounded-lg border border-line px-2 py-1 text-xs font-bold text-pantone140 hover:bg-soft">Kopiér</button> : null}</dd></div>
        </dl>
        <div className="mt-5 space-y-2"><h3 className="font-bold text-ink">Push og modtagere</h3>{notifications.map((item) => <div key={item.id} className="rounded-xl bg-soft p-3 text-sm"><p className="font-bold text-ink">{item.recipient?.full_name ?? item.recipient?.email ?? "Ukendt modtager"} · {pushStatusLabel(item.status)}</p>{item.error_message ? <p className="mt-1 break-words text-warmRed">{item.error_message}</p> : null}</div>)}{notifications.length === 0 ? <p className="text-sm text-muted">Ingen notifikationsforsøg registreret.</p> : null}</div>
      </div>
    </details>
  </main></AppShell>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-b border-r border-line p-3 last:border-r-0 md:border-b-0 md:p-4"><dt className="text-xs font-bold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 text-lg font-bold text-ink md:text-xl">{value}</dd></div>; }
function CompactRow({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between py-2"><dt className="text-muted">{label}</dt><dd className="font-bold text-ink">{formatNumber(value)}</dd></div>; }
function TechnicalRow({ label, value }: { label: string; value: string }) { return <div><dt className="font-bold text-muted">{label}</dt><dd className="mt-1 break-words text-ink">{value}</dd></div>; }
function sourceLabel(value: string) { return value === "historical_replay" ? "Historisk replay" : value === "test" ? "Testkørsel" : "Live sync"; }
function formatDate(value: string) { return new Date(value).toLocaleString("da-DK", { dateStyle: "long", timeStyle: "short" }); }
function formatNumber(value: number) { return Number(value).toLocaleString("da-DK", { maximumFractionDigits: 2 }); }
function formatMoney(value: number) { return `${formatNumber(value)} kr.`; }
function notificationSummary(items: Notification[], sent: number, failed: number) { if (items.length === 0) return "Ingen notifikation sendt"; if (failed > 0 && sent === 0) return "Push kunne ikke sendes"; if (sent > 0) return sent === 1 ? "Push sendt" : `${sent} pushbeskeder sendt`; return "Permanent besked oprettet"; }
function pushStatusLabel(value: string) { return ({ sent: "Push sendt", pending: "Afventer push", skipped: "Push ikke sendt", failed: "Push fejlede" } as Record<string, string>)[value] ?? "Ukendt pushstatus"; }
