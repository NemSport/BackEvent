"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Notice, StatusPill } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  sourceLocationId: string | null;
  active: boolean;
};

type LocationMapping = {
  id: string;
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string;
  backeventLocationId: string | null;
  active: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type DiscoveredRegister = {
  venueId: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string;
  normalizedCashRegisterName: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrenceCount: number;
  mapping: LocationMapping | null;
  duplicateMappings?: Array<Pick<LocationMapping, "id" | "venueId" | "cashRegisterId" | "cashRegisterName" | "normalizedCashRegisterName" | "backeventLocationId" | "active">>;
  duplicateCount?: number;
  status: "mapped" | "missing" | "inactive" | "unknown_location";
  suggestion: { label: string; locationNameHint: string } | null;
  suggestedBackeventLocationId: string | null;
};

type ApiResponse = {
  ok: boolean;
  message?: string;
  locations?: LocationRow[];
  mappings?: LocationMapping[];
  discovered?: DiscoveredRegister[];
};

export default function OnlinePosLocationMappingPage() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredRegister[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => discovered, [discovered]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-location-mappings", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Lokationsmapping kunne ikke hentes");
      setLocations(data.locations ?? []);
      setDiscovered(data.discovered ?? []);
      setDrafts(Object.fromEntries((data.discovered ?? []).map((row) => [rowKey(row), row.mapping?.backeventLocationId ?? row.suggestedBackeventLocationId ?? ""])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokationsmapping kunne ikke hentes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(row: DiscoveredRegister, active = true) {
    const key = rowKey(row);
    const backeventLocationId = drafts[key];
    if (!backeventLocationId) {
      setError("Vælg en BackEvent-lokation først");
      return;
    }
    try {
      setSavingKey(key);
      setError(null);
      setMessage(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-location-mappings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: row.mapping?.id,
          venueId: row.venueId,
          cashRegisterId: row.cashRegisterId,
          cashRegisterName: row.cashRegisterName,
          backeventLocationId,
          active,
        }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Lokationsmapping kunne ikke gemmes");
      setMessage(active ? "Lokationsmapping gemt" : "Lokationsmapping deaktiveret");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokationsmapping kunne ikke gemmes");
    } finally {
      setSavingKey(null);
    }
  }

  async function remove(row: DiscoveredRegister) {
    if (!row.mapping || !window.confirm("Vil du fjerne lokationsmappingen?")) return;
    try {
      setSavingKey(rowKey(row));
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/onlinepos-location-mappings", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: row.mapping.id }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.message ?? "Lokationsmapping kunne ikke fjernes");
      setMessage("Lokationsmapping fjernet");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokationsmapping kunne ikke fjernes");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="Lokationsmapping" subtitle="Kobl OnlinePOS-kasser til BackEvent-steder" />

      {message ? <Notice tone="success" className="mb-4">{message}</Notice> : null}
      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Kasser fundet</h2>
            <p className="text-sm font-medium text-muted">Forslag gemmes aldrig automatisk. Umappede kasser kan ikke trække lager.</p>
          </div>
          <Button type="button" tone="secondary" onClick={load} disabled={loading}>{loading ? "Henter..." : "Opdater"}</Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden bg-soft/60 px-3 py-2 text-xs font-bold uppercase text-muted md:grid md:grid-cols-[1.5fr_0.8fr_0.9fr_1.3fr_1.1fr_1.2fr]">
            <span>OnlinePOS-kasse</span>
            <span>ID</span>
            <span>Status</span>
            <span>BackEvent-lokation</span>
            <span>Gemt række</span>
            <span>Handling</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((row) => {
              const key = rowKey(row);
              const selected = drafts[key] ?? "";
              return (
                <article key={key} className="grid gap-3 px-3 py-3 md:grid-cols-[1.5fr_0.8fr_0.9fr_1.3fr_1.1fr_1.2fr] md:items-center md:py-2">
                  <div>
                    <p className="font-bold text-ink">{row.cashRegisterName}</p>
                    <p className="text-xs font-medium text-muted">Norm: {row.normalizedCashRegisterName ?? "-"} · Venue: {row.venueId ?? "-"}</p>
                    {row.suggestion ? <p className="mt-1 text-xs font-bold text-pantone140">{row.suggestion.label}</p> : null}
                  </div>
                  <p className="text-sm font-medium text-muted">{row.cashRegisterId ?? "-"}</p>
                  <div className="space-y-1">
                    <StatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusPill>
                    {row.duplicateCount && row.duplicateCount > 1 ? <p className="text-xs font-bold text-warmRed">{row.duplicateCount} mulige rækker</p> : null}
                  </div>
                  <select
                    value={selected}
                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    className="field h-10 py-1 text-sm"
                  >
                    <option value="">Vælg lokation</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                  <div className="space-y-1 text-xs font-medium text-muted">
                    <p>{row.occurrenceCount} forekomst{row.occurrenceCount === 1 ? "" : "er"} · {formatDate(row.lastSeenAt)}</p>
                    <p>Navn: {row.mapping?.cashRegisterName ?? "-"}</p>
                    <p>Norm: {row.mapping?.normalizedCashRegisterName ?? "-"}</p>
                    <p>ID: {row.mapping?.cashRegisterId ?? "-"} · Venue: {row.mapping?.venueId ?? "-"}</p>
                    <p>Aktiv: {row.mapping ? (row.mapping.active ? "ja" : "nej") : "-"} · BackEvent ID: {row.mapping?.backeventLocationId ?? "-"}</p>
                    {row.duplicateMappings && row.duplicateMappings.length > 1 ? (
                      <details>
                        <summary className="cursor-pointer font-bold text-pantone140">Vis dubletter</summary>
                        <div className="mt-1 space-y-1">
                          {row.duplicateMappings.map((mapping) => (
                            <p key={mapping.id} className="rounded bg-soft/60 px-2 py-1">
                              {mapping.cashRegisterName} · norm {mapping.normalizedCashRegisterName || "-"} · ID {mapping.cashRegisterId ?? "-"} · venue {mapping.venueId ?? "-"} · aktiv {mapping.active ? "ja" : "nej"} · BE {mapping.backeventLocationId ?? "-"}
                            </p>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => save(row, true)} disabled={savingKey === key} className="min-h-9 px-3 py-1 text-sm">Gem</Button>
                    {row.mapping?.active ? <Button type="button" tone="secondary" onClick={() => save(row, false)} disabled={savingKey === key} className="min-h-9 px-3 py-1 text-sm">Deaktivér</Button> : null}
                    {row.mapping ? <Button type="button" tone="danger" onClick={() => remove(row)} disabled={savingKey === key} className="min-h-9 px-3 py-1 text-sm">Fjern</Button> : null}
                  </div>
                </article>
              );
            })}
            {rows.length === 0 ? <p className="p-4 text-sm font-medium text-muted">Ingen OnlinePOS-kasser fundet endnu.</p> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function rowKey(row: DiscoveredRegister) {
  return `${row.venueId ?? ""}:${row.cashRegisterId ? `id:${row.cashRegisterId}` : `name:${row.cashRegisterName}`}`;
}

function statusLabel(status: DiscoveredRegister["status"]) {
  if (status === "mapped") return "Mappet";
  if (status === "inactive") return "Inaktiv";
  if (status === "unknown_location") return "Ukendt BackEvent-lokation";
  return "Mangler mapping";
}

function statusTone(status: DiscoveredRegister["status"]) {
  if (status === "mapped") return "success";
  if (status === "inactive") return "inactive";
  if (status === "unknown_location") return "danger";
  return "pending";
}

function formatDate(value: string | null) {
  if (!value) return "Ikke set";
  return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
