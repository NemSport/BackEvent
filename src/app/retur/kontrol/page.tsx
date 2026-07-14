"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { getBrowserAccessToken } from "@/lib/backevent/api-token";
import { buildReturnControlDetailHref } from "@/lib/backevent/return-control-contract";

type ReturnListItem = {
  id: string;
  receiptNumber: string | null;
  returnedAt: string | null;
  totalAmount: number;
  processingStatus: string;
  controlReasons: string[];
  locationName: string;
};
type ReceiptControl = {
  id: string;
  receiptNumber: string | null;
  transactionId: string | null;
  controlTypes: string[];
  depositReturnQuantity: number;
  finalTotal: number;
  source: string;
  createdAt: string;
};

export default function ReturKontrolPage() {
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [receiptControls, setReceiptControls] = useState<ReceiptControl[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const token = await getBrowserAccessToken();
      const response = await fetch("/api/returns?control=open", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; returns?: ReturnListItem[]; receiptControls?: ReceiptControl[] } | null;
      if (!mounted) return;
      if (!json?.ok) setMessage(json?.message ?? "Kontrolreturer kunne ikke hentes");
      setReturns(json?.returns ?? []);
      setReceiptControls(json?.receiptControls ?? []);
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <AppShell>
      <BackButton href="/retur" />
      <section className="my-5 rounded-[1.5rem] bg-soft p-5 shadow-soft">
        <h1 className="text-3xl font-bold text-ink">Returkontrol</h1>
        <p className="mt-2 text-base font-bold text-muted">Returer og OnlinePOS-boner der kræver opmærksomhed.</p>
      </section>
      {message ? <p className="mb-4 rounded-2xl bg-soft p-4 text-sm font-bold text-warmRed">{message}</p> : null}
      <div className="divide-y divide-line overflow-hidden rounded-[1.5rem] border border-line bg-macro shadow-soft">
        {receiptControls.map((item) => (
          <Link key={`receipt-${item.id}`} href={buildReturnControlDetailHref("receipt-control", item.id)} className="block p-4 hover:bg-soft/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-ink">Bon {item.receiptNumber ?? item.transactionId ?? "ukendt"}</p>
                <p className="mt-1 text-sm font-bold text-muted">{formatDate(item.createdAt)} · {item.source === "historical_replay" ? "Historisk replay" : "Live sync"}</p>
              </div>
              <p className="rounded-xl bg-warmRed px-3 py-1 text-sm font-bold text-macro">{item.finalTotal.toLocaleString("da-DK")} kr.</p>
            </div>
            <p className="mt-2 text-sm font-bold text-warmRed">{item.controlTypes.map(controlLabel).join(" · ")}</p>
            {item.depositReturnQuantity > 0 ? <p className="mt-1 text-sm text-muted">Pant i alt: {item.depositReturnQuantity.toLocaleString("da-DK")} stk.</p> : null}
          </Link>
        ))}
        {returns.map((item) => (
          <Link key={item.id} href={buildReturnControlDetailHref("return", item.id)} className="block p-4 hover:bg-soft/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-ink">{item.locationName}</p>
                <p className="mt-1 text-sm font-bold text-muted">Bon {item.receiptNumber ?? "ukendt"} · {formatDate(item.returnedAt)}</p>
              </div>
              <p className="rounded-xl bg-warmRed px-3 py-1 text-sm font-bold text-macro">{Math.abs(item.totalAmount).toLocaleString("da-DK")} kr.</p>
            </div>
            <p className="mt-2 text-sm font-bold text-warmRed">{item.controlReasons.slice(0, 3).join(" · ") || "Afvigelse fundet"}</p>
          </Link>
        ))}
        {returns.length === 0 && receiptControls.length === 0 ? <p className="p-5 text-sm font-bold text-muted">Ingen åbne returkontroller.</p> : null}
      </div>
    </AppShell>
  );
}

function controlLabel(value: string) {
  if (value === "RETURN_RECEIPT") return "Returbon";
  if (value === "HIGH_DEPOSIT_RETURN") return "Mere end 10 pant";
  if (value === "NEGATIVE_RECEIPT_TOTAL") return "Negativ bontotal";
  if (value === "MANUAL_REVIEW") return "Manuel kontrol";
  return value;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" }) : "ukendt";
}
