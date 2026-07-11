"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";

type ReturnListItem = {
  id: string;
  receiptNumber: string | null;
  returnedAt: string | null;
  totalAmount: number;
  processingStatus: string;
  controlStatus: string;
  controlReasons: string[];
  locationName: string;
};

type ReturnResponse = {
  ok?: boolean;
  message?: string;
  summary?: { todayCount: number; requiresControl: number; failed: number; totalReturnAmount: number };
  latestSync?: {
    status: string;
    page_count: number;
    transaction_count: number;
    return_count: number;
    review_count: number;
    duplicate_count: number;
    error_message: string | null;
    started_at: string;
    finished_at: string | null;
  } | null;
  returns?: ReturnListItem[];
};

export default function ReturPage() {
  const [data, setData] = useState<ReturnResponse | null>(null);
  const [filter, setFilter] = useState<"all" | "control" | "failed">("all");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const token = await getBrowserAccessToken();
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (search.trim()) params.set("search", search.trim());
      if (filter !== "all") params.set("status", filter);
      const response = await fetch(`/api/returns${params.size ? `?${params}` : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = (await response.json().catch(() => null)) as ReturnResponse | null;
      if (mounted) setData(json ?? { ok: false, message: "Returer kunne ikke hentes" });
    }
    load();
    return () => {
      mounted = false;
    };
  }, [date, filter, search]);

  const returns = data?.returns ?? [];

  return (
    <AppShell>
      <BackButton href="/" />
      <section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft">
        <h1 className="text-3xl font-bold text-ink">Retur & kontrol</h1>
        <p className="mt-2 text-base font-bold text-muted">OnlinePOS-returer registreres og kontrolleres her.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="I dag" value={data?.summary?.todayCount ?? 0} />
        <SummaryCard label="Kræver kontrol" value={data?.summary?.requiresControl ?? 0} tone="warning" />
        <SummaryCard label="Fejlet" value={data?.summary?.failed ?? 0} tone="critical" />
        <SummaryCard label="Returbeløb" value={`${formatAmount(data?.summary?.totalReturnAmount ?? 0)} kr.`} />
      </section>

      {data?.latestSync ? (
        <section className="mt-4 rounded-2xl border border-line bg-macro p-4 text-sm font-bold text-muted shadow-sm">
          Seneste sync: {syncStatusLabel(data.latestSync.status)} · {data.latestSync.page_count} sider · {data.latestSync.return_count} returer
          {data.latestSync.error_message ? <span className="text-warmRed"> · {data.latestSync.error_message}</span> : null}
        </section>
      ) : null}

      <section className="mt-5 rounded-[1.5rem] border border-line bg-macro shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-soft px-4 py-3">
          <h2 className="text-lg font-bold text-ink">Returer</h2>
          <div className="flex flex-wrap gap-2">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Alle</FilterButton>
            <FilterButton active={filter === "control"} onClick={() => setFilter("control")}>Kontrol</FilterButton>
            <FilterButton active={filter === "failed"} onClick={() => setFilter("failed")}>Fejlet</FilterButton>
          </div>
        </div>
        <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-[0.8fr_1fr_auto]">
          <label className="text-sm font-bold text-ink">
            Dato
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140" />
          </label>
          <label className="text-sm font-bold text-ink">
            Søg bon
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Bonnummer" className="mt-1 min-h-10 w-full rounded-xl border border-line px-3 py-2 font-bold outline-none focus:border-pantone140" />
          </label>
          <button type="button" onClick={() => { setDate(""); setSearch(""); setFilter("all"); }} className="self-end rounded-xl border border-line px-3 py-2 text-sm font-bold text-pantone140">
            Nulstil
          </button>
        </div>
        {data?.message ? <p className="p-4 text-sm font-bold text-warmRed">{data.message}</p> : null}
        <div className="divide-y divide-line">
          {returns.map((item) => (
            <Link key={item.id} href={`/retur/${item.id}`} className="grid gap-2 px-4 py-3 text-sm font-medium text-ink hover:bg-soft/70 md:grid-cols-[1fr_0.75fr_0.65fr_0.7fr_0.55fr] md:items-center">
              <div>
                <p className="font-bold">{item.locationName}</p>
                <p className="text-xs text-muted">Bon {item.receiptNumber ?? "ukendt"} · {formatDate(item.returnedAt)}</p>
              </div>
              <span>{formatAmount(Math.abs(item.totalAmount))} kr.</span>
              <span className={statusClass(item.processingStatus)}>{statusLabel(item.processingStatus)}</span>
              <span className={item.controlStatus === "open" ? "text-warmRed font-bold" : "text-muted"}>{item.controlStatus === "open" ? "Kontrol" : "OK"}</span>
              <span className="text-right font-bold text-pantone140">Åbn</span>
            </Link>
          ))}
          {returns.length === 0 ? <p className="p-5 text-sm font-bold text-muted">Ingen returer fundet.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "critical" }) {
  return (
    <article className="rounded-2xl border border-line bg-macro p-4 shadow-sm">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "critical" ? "text-warmRed" : tone === "warning" ? "text-pantone140" : "text-ink"}`}>{value}</p>
    </article>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-xl px-3 py-2 text-sm font-bold ${active ? "bg-pantone140 text-macro" : "bg-macro text-pantone140"}`}>{children}</button>;
}

function statusLabel(status: string) {
  if (status === "processed") return "Behandlet";
  if (status === "requires_review") return "Kontrol";
  if (status === "processing_failed") return "Fejlet";
  if (status === "duplicate") return "Dublet";
  return "Registreret";
}

function statusClass(status: string) {
  if (status === "processed") return "font-bold text-green-700";
  if (status === "processing_failed" || status === "requires_review") return "font-bold text-warmRed";
  return "font-bold text-pantone140";
}

function syncStatusLabel(status: string) {
  if (status === "completed") return "Færdig";
  if (status === "partial") return "Delvis";
  if (status === "failed") return "Fejlet";
  return "Kører";
}

function formatAmount(value: number) {
  return value.toLocaleString("da-DK", { maximumFractionDigits: 2 });
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : "ukendt";
}
