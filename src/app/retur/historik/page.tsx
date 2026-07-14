"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { StatusPill } from "@/components/backevent/ui";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";
import { formatReceiptControlStatus } from "@/lib/backevent/return-control-contract";

type HistoryControl = {
  id: string; receiptNumber: string | null; transactionId: string | null; status: string;
  handledAt: string | null; handledByName: string | null; internalNote: string | null; createdAt: string;
};

export default function ReturnHistoryPage() {
  const [items, setItems] = useState<HistoryControl[]>([]);
  const [message, setMessage] = useState("Henter historik...");
  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getBrowserAccessToken();
      const response = await fetch("/api/returns?control=history", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = await response.json().catch(() => null) as { ok?: boolean; message?: string; receiptControls?: HistoryControl[] } | null;
      if (!mounted) return;
      if (!response.ok || !json?.ok) setMessage(json?.message ?? "Historikken kunne ikke hentes");
      else { setItems(json.receiptControls ?? []); setMessage(""); }
    })();
    return () => { mounted = false; };
  }, []);

  return <AppShell><BackButton href="/retur" /><section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft"><h1 className="text-3xl font-bold text-ink">Kontrolhistorik</h1><p className="mt-2 font-bold text-muted">Afsluttede bonkontroller bevares her.</p></section>
    {message ? <p className="rounded-2xl bg-soft p-4 text-sm font-bold text-muted">{message}</p> : null}
    <div className="divide-y divide-line overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">{items.map((item) => <Link key={item.id} href={`/retur/kontrol/${item.id}`} className="block p-4 hover:bg-soft/70"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-ink">Bon {item.receiptNumber ?? item.transactionId ?? "ukendt"}</p><p className="mt-1 text-sm text-muted">{item.handledByName ? `${item.handledByName} · ` : ""}{formatDate(item.handledAt ?? item.createdAt)}</p></div><StatusPill tone={item.status === "approved" ? "success" : "danger"}>{formatReceiptControlStatus(item.status)}</StatusPill></div>{item.internalNote ? <p className="mt-2 line-clamp-2 text-sm text-muted">{item.internalNote}</p> : null}</Link>)}{!message && items.length === 0 ? <p className="p-5 text-sm font-bold text-muted">Ingen afsluttede bonkontroller endnu.</p> : null}</div>
  </AppShell>;
}

function formatDate(value: string) { return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }); }
