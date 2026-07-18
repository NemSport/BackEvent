"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { Button, StatusPill } from "@/components/backevent/ui";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";
import {
  formatReceiptControlRule,
  formatReceiptControlStatus,
} from "@/lib/backevent/return-control-contract";
import { amountIncludingVat } from "@/lib/backevent/vat";
import { formatReceiptControlLocation } from "@/lib/onlinepos/receipt-control-location";

type ReceiptControl = {
  id: string;
  receiptNumber: string | null;
  transactionId: string | null;
  controlTypes: string[];
  depositReturnQuantity: number;
  depositReturnValue: number;
  finalTotal: number;
  amountsIncludeVat: boolean;
  source: string;
  status: string;
  createdAt: string;
  transactionDatetime: string | null;
  handledAt: string | null;
  handledByName: string | null;
  internalNote: string | null;
  updatedAt: string | null;
  locationName: string | null;
  cashRegisterName: string | null;
  cashRegisterId: string | null;
};
type Option = { id: string; name: string };
type ListResponse = {
  ok?: boolean;
  message?: string;
  items?: ReceiptControl[];
  total?: number;
  page?: number;
  pageSize?: number;
  locations?: Option[];
  handlers?: Option[];
};

export default function ReturKontrolPage() {
  return <Suspense fallback={<AppShell><p className="p-5 font-bold text-muted">Henter bonkontroller...</p></AppShell>}><ReturKontrolContent /></Suspense>;
}

function ReturKontrolContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [items, setItems] = useState<ReceiptControl[]>([]);
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<Option[]>([]);
  const [handlers, setHandlers] = useState<Option[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("Henter bonkontroller...");
  const [working, setWorking] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchParams.get("search") ?? "");
  const page = positive(searchParams.get("page"), 1);
  const pageSize = positive(searchParams.get("pageSize"), 25);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getBrowserAccessToken();
      const response = await fetch(`/api/returns/receipt-controls?${queryString}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = await response.json().catch(() => null) as ListResponse | null;
      if (!mounted) return;
      if (!response.ok || !json?.ok) {
        setMessage(json?.message ?? "Bonkontroller kunne ikke hentes");
        return;
      }
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setLocations(json.locations ?? []);
      setHandlers(json.handlers ?? []);
      setSelected(new Set());
      setMessage("");
    })();
    return () => { mounted = false; };
  }, [queryString]);

  const visibleSelected = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || (value === "all" && key !== "status")) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    router.push(`/retur/kontrol?${next.toString()}`);
  }

  function applyQuick(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("quick", value); else next.delete("quick");
    next.delete("page");
    router.push(`/retur/kontrol?${next.toString()}`);
  }

  function resetFilters() {
    setSearchDraft("");
    router.push("/retur/kontrol?status=open&sort=oldest&pageSize=25");
  }

  function toggleAll() {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)));
  }

  async function exportControls(scope: "filtered" | "selected" | "all") {
    if (scope === "selected" && selected.size === 0) return;
    setWorking(true);
    setMessage("Danner Excel-fil...");
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scope);
    if (scope === "selected") params.set("ids", [...selected].join(","));
    const token = await getBrowserAccessToken();
    const response = await fetch(`/api/returns/receipt-controls/export?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      const json = await response.json().catch(() => null) as { message?: string } | null;
      setMessage(json?.message ?? "Excel-eksporten fejlede");
      setWorking(false);
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "backevent-returkontrol.xlsx";
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(href);
    setMessage("");
    setWorking(false);
  }

  async function markSelectedForFollowUp() {
    if (!visibleSelected.length || working) return;
    setWorking(true);
    setMessage("Markerede boner sættes til opfølgning...");
    const token = await getBrowserAccessToken();
    for (const item of visibleSelected) {
      const response = await fetch(`/api/returns/receipt-controls/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "follow_up", note: item.internalNote ?? "", expectedUpdatedAt: item.updatedAt }),
      });
      if (!response.ok) {
        setMessage(`Bon ${item.receiptNumber ?? item.transactionId ?? "ukendt"} kunne ikke markeres`);
        setWorking(false);
        return;
      }
    }
    router.refresh();
    window.location.reload();
  }

  return (
    <AppShell>
      <BackButton href="/retur" />
      <section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft">
        <h1 className="text-3xl font-bold text-ink">Returkontrol</h1>
        <p className="mt-2 font-bold text-muted">Arbejd købaseret gennem OnlinePOS-bonerne.</p>
      </section>

      <section className="mb-4 rounded-[1.5rem] border border-line bg-macro p-4 shadow-soft">
        <div className="flex flex-wrap gap-2">
          <Quick active={searchParams.get("quick") === "mine-open"} onClick={() => applyQuick("mine-open")}>Mine åbne</Quick>
          <Quick active={searchParams.get("quick") === "all-open"} onClick={() => applyQuick("all-open")}>Alle åbne</Quick>
          <Quick active={searchParams.get("quick") === "follow-up"} onClick={() => applyQuick("follow-up")}>Kræver opfølgning</Quick>
          <Quick active={searchParams.get("quick") === "processed-today"} onClick={() => applyQuick("processed-today")}>Behandlet i dag</Quick>
          <Quick active={searchParams.get("quick") === "unmapped"} onClick={() => applyQuick("unmapped")}>Ikke mappede barer</Quick>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Filter label="Status" value={searchParams.get("status") ?? "open"} onChange={(value) => setFilter("status", value)} options={[
            ["all", "Alle"], ["open", "Afventer kontrol"], ["follow_up", "Kræver opfølgning"], ["approved", "Godkendt"], ["confirmed_error", "Fejl bekræftet"],
          ]} />
          <Filter label="Bar/lokation" value={searchParams.get("location") ?? "all"} onChange={(value) => setFilter("location", value)} options={[
            ["all", "Alle"], ...locations.map((item) => [item.id, item.name]), ["unmapped", "Ikke mappet"], ["unknown", "Ukendt"],
          ]} />
          <Filter label="Kontrolårsag" value={searchParams.get("reason") ?? "all"} onChange={(value) => setFilter("reason", value)} options={[
            ["all", "Alle"], ["NEGATIVE_RECEIPT_TOTAL", "Negativ total"], ["HIGH_DEPOSIT_RETURN", "Pant"], ["MANUAL_REVIEW", "Usikker negativ produktlinje"], ["RETURN_RECEIPT", "Returbon"],
          ]} />
          <Filter label="Sync-type" value={searchParams.get("source") ?? "all"} onChange={(value) => setFilter("source", value)} options={[
            ["all", "Alle"], ["live", "Live sync"], ["historical_replay", "Replay"], ["test", "Test-run"],
          ]} />
          <label className="text-sm font-bold text-ink">Fra dato<input type="date" value={searchParams.get("from") ?? ""} onChange={(event) => setFilter("from", event.target.value)} className="mt-1 block h-11 w-full rounded-xl border border-line bg-macro px-3" /></label>
          <label className="text-sm font-bold text-ink">Til dato<input type="date" value={searchParams.get("to") ?? ""} onChange={(event) => setFilter("to", event.target.value)} className="mt-1 block h-11 w-full rounded-xl border border-line bg-macro px-3" /></label>
          <Filter label="Behandler" value={searchParams.get("handler") ?? "all"} onChange={(value) => setFilter("handler", value)} options={[["all", "Alle"], ...handlers.map((item) => [item.id, item.name])]} />
          <Filter label="Sortering" value={searchParams.get("sort") ?? "oldest"} onChange={(value) => setFilter("sort", value)} options={[
            ["newest", "Nyeste først"], ["oldest", "Ældste først"], ["receipt_asc", "Bonnummer stigende"], ["receipt_desc", "Bonnummer faldende"], ["negative_total", "Største negative total"], ["deposit_value", "Største pantbeløb"], ["location", "Bar/lokation"], ["handled", "Senest behandlet"],
          ]} />
          <label className="text-sm font-bold text-ink sm:col-span-2 lg:col-span-3">Søgning<div className="mt-1 flex gap-2"><input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setFilter("search", searchDraft); }} placeholder="Bonnummer, receipt ID, bar eller bemærkning" className="block h-11 min-w-0 flex-1 rounded-xl border border-line bg-macro px-3" /><Button type="button" onClick={() => setFilter("search", searchDraft)}>Søg</Button></div></label>
          <Filter label="Pr. side" value={String(pageSize)} onChange={(value) => setFilter("pageSize", value)} options={[["25", "25"], ["50", "50"], ["100", "100"]]} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-muted">Viser {items.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} af {total} boner</p>
          <div className="flex flex-wrap gap-2">
            <Button tone="secondary" onClick={resetFilters}>Nulstil filtre</Button>
            <Button tone="secondary" disabled={working} onClick={() => exportControls("filtered")}>Eksportér filtrerede</Button>
            <Button tone="secondary" disabled={working} onClick={() => exportControls("all")}>Eksportér alle</Button>
          </div>
        </div>
      </section>

      {selected.size ? <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-soft p-3"><strong>{selected.size} valgt</strong><Button disabled={working} onClick={() => exportControls("selected")}>Eksportér valgte</Button><Button tone="secondary" disabled={working} onClick={markSelectedForFollowUp}>Markér til opfølgning</Button></div> : null}
      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-sm font-bold text-muted">{message}</p> : null}

      <div className="overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <label className="flex items-center gap-3 border-b border-line p-4 text-sm font-bold"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} /> Vælg alle synlige</label>
        <div className="divide-y divide-line">
          {items.map((item, index) => {
            const detailParams = new URLSearchParams(searchParams.toString());
            detailParams.set("queueIndex", String(index));
            return <div key={item.id} className="flex gap-3 p-4 hover:bg-soft/70">
              <input aria-label={`Vælg bon ${item.receiptNumber ?? item.transactionId}`} type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              })} />
              <Link href={`/retur/kontrol/${item.id}?${detailParams}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-bold text-ink">Bon {item.receiptNumber ?? item.transactionId ?? "ukendt"}</p><p className="mt-1 text-sm font-bold text-ink">{formatReceiptControlLocation(item)}</p><p className="mt-1 text-sm text-muted">{formatDate(item.transactionDatetime ?? item.createdAt)} · {sourceLabel(item.source)}</p></div>
                  <div className="text-right"><StatusPill tone={item.status === "approved" ? "success" : item.status === "confirmed_error" ? "danger" : "pending"}>{formatReceiptControlStatus(item.status)}</StatusPill><p className="mt-2 font-bold text-ink">{formatMoney(item.finalTotal, item.amountsIncludeVat)}</p></div>
                </div>
                <p className="mt-2 text-sm font-bold text-warmRed">{item.controlTypes.map(formatReceiptControlRule).join(" · ")}</p>
                {item.internalNote ? <p className="mt-1 line-clamp-1 text-sm text-muted">{item.internalNote}</p> : null}
              </Link>
            </div>;
          })}
          {!message && items.length === 0 ? <p className="p-5 text-sm font-bold text-muted">Ingen boner matcher filtrene.</p> : null}
        </div>
      </div>

      <nav className="mt-4 flex items-center justify-between gap-3">
        <Button tone="secondary" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>Forrige side</Button>
        <span className="text-sm font-bold text-muted">Side {page} af {pageCount}</span>
        <Button tone="secondary" disabled={page >= pageCount} onClick={() => setFilter("page", String(page + 1))}>Næste side</Button>
      </nav>
    </AppShell>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="text-sm font-bold text-ink">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block h-11 w-full rounded-xl border border-line bg-macro px-3">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}
function Quick({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border px-3 py-2 text-sm font-bold ${active ? "border-pantone139 bg-pantone139 text-ink" : "border-line bg-macro text-muted"}`}>{children}</button>;
}
function positive(value: string | null, fallback: number) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : "ukendt"; }
function formatMoney(value: number, alreadyIncludesVat: boolean) { return `${amountIncludingVat(value, alreadyIncludesVat).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr.`; }
function sourceLabel(value: string) { return value === "historical_replay" ? "Replay" : value === "test" ? "Test-run" : "Live sync"; }
