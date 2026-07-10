"use client";

import { Bell, Send, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { NotificationSettingsCard } from "@/components/backevent/notification-settings-card";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { getMemberGroupMemberships } from "@/lib/backevent/data";
import { isOperationalGroupName } from "@/lib/backevent/push-messages";
import type { BackEventMemberGroup, BackEventMemberGroupMembership } from "@/lib/backevent/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type GroupPushResult = {
  ok: boolean;
  groupId?: string;
  groupName?: string;
  memberCount?: number;
  subscriptionCount?: number;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  message?: string;
};

type PushLog = {
  id: string;
  recipientUserId: string | null;
  recipientEmail: string | null;
  groupId: string | null;
  title: string;
  body: string;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  createdAt: string;
};

type InventoryAlertRunResult = {
  ok: boolean;
  checkedItems: number;
  lowCount: number;
  criticalCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  suppressedCount?: number;
  runStatus?: "success" | "partial" | "failed" | "skipped";
  alerts: Array<{
    productName: string;
    locationName: string;
    stockValue: number;
    unit: string;
    alertLevel: "low" | "critical";
    threshold: number;
    skippedReason?: string;
  }>;
  message?: string;
};

type LatestInventoryAlertRun = {
  id: string;
  runType: "manual" | "cron";
  status: "success" | "partial" | "failed" | "skipped";
  checkedItems: number;
  sentAlerts: number;
  suppressedAlerts: number;
  failedCount: number;
  errorMessage: string | null;
  createdAt: string;
};

export default function AdminNotificationsPage() {
  const { isOwner, isResponsible } = useBackEventAuth();
  const [groups, setGroups] = useState<BackEventMemberGroup[]>([]);
  const [memberships, setMemberships] = useState<BackEventMemberGroupMembership[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<GroupPushResult | null>(null);
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [inventoryAlertResult, setInventoryAlertResult] = useState<InventoryAlertRunResult | null>(null);
  const [latestAutomaticRun, setLatestAutomaticRun] = useState<LatestInventoryAlertRun | null>(null);
  const [runningInventoryAlert, setRunningInventoryAlert] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeGroups = useMemo(
    () => groups.filter((group) => group.active && (isOwner || isOperationalGroupName(group.name))),
    [groups, isOwner],
  );
  const lagerGroup = useMemo(() => groups.find((group) => group.name.toLowerCase() === "lageransvarlige") ?? null, [groups]);
  const lagerGroupMemberCount = useMemo(
    () => (lagerGroup ? memberships.filter((membership) => membership.groupId === lagerGroup.id).length : 0),
    [lagerGroup, memberships],
  );

  const loadLogs = useCallback(async () => {
    const token = await getAccessToken();
    const response = await fetch("/api/admin/push/send-group", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const data = (await response.json()) as { ok: boolean; logs?: PushLog[]; message?: string };

    if (!response.ok || !data.ok) {
      throw new Error(data.message ?? "Kunne ikke hente push-log");
    }

    setLogs(data.logs ?? []);
  }, []);

  const loadLatestAutomaticRun = useCallback(async () => {
    const token = await getAccessToken();
    const response = await fetch("/api/admin/push/inventory-alerts/run", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const data = (await response.json()) as { ok: boolean; latestAutomaticRun?: LatestInventoryAlertRun | null; message?: string };

    if (!response.ok || !data.ok) {
      throw new Error(data.message ?? "Kunne ikke hente seneste lageralarm");
    }

    setLatestAutomaticRun(data.latestAutomaticRun ?? null);
  }, []);

  const loadOwnerData = useCallback(async () => {
    if (!isResponsible) {
      return;
    }

    try {
      setError(null);
      const [memberGroupData] = await Promise.all([
        getMemberGroupMemberships(),
        isOwner ? loadLogs() : Promise.resolve(),
        isOwner ? loadLatestAutomaticRun() : Promise.resolve(),
      ]);
      const onlyActiveGroups = memberGroupData.groups.filter((group) => group.active && (isOwner || isOperationalGroupName(group.name)));
      setGroups(memberGroupData.groups);
      setMemberships(memberGroupData.memberships);
      setSelectedGroupId((current) => current || onlyActiveGroups[0]?.id || "");
    } catch {
      setError("Kunne ikke hente grupper og push-log lige nu.");
    }
  }, [isOwner, isResponsible, loadLatestAutomaticRun, loadLogs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOwnerData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadOwnerData]);

  async function sendGroupPush() {
    try {
      setSending(true);
      setResult(null);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/push/send-group", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          groupId: selectedGroupId,
          title,
          message,
        }),
      });
      const data = (await response.json()) as GroupPushResult;
      setResult(data);

      if (!response.ok || !data.ok) {
        setError(data.message ?? "Push-besked kunne ikke sendes til alle.");
      }

      if (isOwner) {
        await loadLogs();
        await loadLatestAutomaticRun();
      }
    } catch {
      setError("Push-besked kunne ikke sendes lige nu.");
    } finally {
      setSending(false);
    }
  }

  async function runInventoryAlerts() {
    try {
      setRunningInventoryAlert(true);
      setInventoryAlertResult(null);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/push/inventory-alerts/run", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as InventoryAlertRunResult;
      setInventoryAlertResult(data);

      if (!response.ok || !data.ok) {
        setError(data.message ?? "Lageralarm kunne ikke køres.");
      }

      await loadLogs();
      await loadLatestAutomaticRun();
    } catch {
      setError("Lageralarm kunne ikke køres lige nu.");
    } finally {
      setRunningInventoryAlert(false);
    }
  }

  return (
    <AppShell requiredRole="ansvarlig">
      <Header title="Notifikationer" subtitle="Aktivér push-notifikationer og send beskeder" />

      {error ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{error}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-5">
          <NotificationSettingsCard />

          {isResponsible ? (
            <>
              {isOwner ? (
              <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
                    <Bell className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-ink">Automatiske lageralarmer</h2>
                    <p className="text-sm font-medium text-muted">Automatisk hvert 10. minut og manuel test til Lageransvarlige.</p>
                  </div>
                </div>

                <div className="grid gap-3 rounded-2xl bg-soft p-4 text-sm font-bold text-ink sm:grid-cols-3">
                  <ResultStat label="Gruppe" value={lagerGroup ? 1 : 0} />
                  <ResultStat label="Medlemmer" value={lagerGroupMemberCount} />
                  <ResultStat label="Status" value={lagerGroup?.active ? "Aktiv" : "Mangler"} />
                  <p className="sm:col-span-3 text-muted">
                    {lagerGroup ? "Lageransvarlige er klar. Medlemmer tildeles under Medlemmer." : "Gruppen oprettes ved migration eller første kørsel."}
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-line bg-macro p-4">
                  <h3 className="text-sm font-bold uppercase text-muted">Seneste automatiske kørsel</h3>
                  {latestAutomaticRun ? (
                    <div className="mt-3 grid gap-3 text-sm font-bold text-ink sm:grid-cols-2 lg:grid-cols-4">
                      <ResultStat label="Tidspunkt" value={new Date(latestAutomaticRun.createdAt).toLocaleString("da-DK")} />
                      <ResultStat label="Status" value={runStatusLabel(latestAutomaticRun.status)} />
                      <ResultStat label="Tjekket" value={latestAutomaticRun.checkedItems} />
                      <ResultStat label="Sendt" value={latestAutomaticRun.sentAlerts} />
                      <ResultStat label="Undertrykt" value={latestAutomaticRun.suppressedAlerts} />
                      <ResultStat label="Fejl" value={latestAutomaticRun.failedCount} />
                      {latestAutomaticRun.errorMessage ? <p className="sm:col-span-2 lg:col-span-4 text-warmRed">{latestAutomaticRun.errorMessage}</p> : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-bold text-muted">Ingen automatisk kørsel endnu.</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={runInventoryAlerts}
                  disabled={runningInventoryAlert}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-pantone139 px-4 py-2.5 text-sm font-bold text-ink shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  {runningInventoryAlert ? "Kører..." : "Kør lageralarm test"}
                </button>

                {inventoryAlertResult ? (
                  <div className="mt-5 rounded-2xl bg-soft p-4">
                    <div className="grid gap-3 text-sm font-bold text-ink sm:grid-cols-3 lg:grid-cols-6">
                      <ResultStat label="Tjekket" value={inventoryAlertResult.checkedItems} />
                      <ResultStat label="Lavt" value={inventoryAlertResult.lowCount} />
                      <ResultStat label="Kritisk" value={inventoryAlertResult.criticalCount} />
                      <ResultStat label="Sendt" value={inventoryAlertResult.sentCount} />
                      <ResultStat label="Fejlet" value={inventoryAlertResult.failedCount} />
                      <ResultStat label="Sprunget over" value={inventoryAlertResult.skippedCount} />
                      <ResultStat label="Undertrykt" value={inventoryAlertResult.suppressedCount ?? 0} />
                    </div>
                    {inventoryAlertResult.alerts.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {inventoryAlertResult.alerts.slice(0, 8).map((alert) => (
                          <p key={`${alert.productName}-${alert.locationName}-${alert.alertLevel}`} className="rounded-xl bg-macro px-3 py-2 text-sm font-bold text-ink">
                            {alert.alertLevel === "critical" ? "Kritisk" : "Lavt"}: {alert.productName} i {alert.locationName} ·{" "}
                            {formatNumber(alert.stockValue)} {alert.unit}
                            {alert.skippedReason ? <span className="text-muted"> · {alert.skippedReason}</span> : null}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-xl bg-macro px-3 py-2 text-sm font-bold text-muted">Ingen lageralarmer lige nu.</p>
                    )}
                  </div>
                ) : null}
              </section>
              ) : null}

              <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
                    <Users className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-ink">Send besked til gruppe</h2>
                    <p className="text-sm font-medium text-muted">
                      {isOwner ? "Ejer kan sende til alle aktive grupper." : "Ansvarlig kan sende til driftsgrupper."}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-bold text-ink">Gruppe</span>
                    <select
                      value={selectedGroupId}
                      onChange={(event) => setSelectedGroupId(event.target.value)}
                      className="h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
                    >
                      {activeGroups.length === 0 ? <option value="">Ingen aktive grupper</option> : null}
                      {activeGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-bold text-ink">Titel</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={120}
                      className="h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
                      placeholder="Kort titel"
                    />
                  </label>

                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-bold text-ink">Besked</span>
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      maxLength={500}
                      rows={4}
                      className="w-full rounded-xl border border-line bg-macro px-3 py-2 text-sm font-medium text-ink outline-none focus:border-pantone140"
                      placeholder="Skriv beskeden til gruppen"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={sendGroupPush}
                    disabled={sending || !selectedGroupId || title.trim().length < 2 || message.trim().length < 2}
                    className="inline-flex items-center gap-2 rounded-xl bg-pantone139 px-4 py-2.5 text-sm font-bold text-ink shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    {sending ? "Sender..." : "Send push-besked"}
                  </button>
                  <p className="text-sm font-bold text-muted">{activeGroups.length} aktive grupper</p>
                </div>

                {result ? (
                  <div className="mt-5 grid gap-3 rounded-2xl bg-soft p-4 text-sm font-bold text-ink sm:grid-cols-2 lg:grid-cols-5">
                    <ResultStat label="Medlemmer" value={result.memberCount ?? 0} />
                    <ResultStat label="Enheder" value={result.subscriptionCount ?? 0} />
                    <ResultStat label="Sendt" value={result.sentCount ?? 0} />
                    <ResultStat label="Fejlet" value={result.failedCount ?? 0} />
                    <ResultStat label="Sprunget over" value={result.skippedCount ?? 0} />
                    {result.message ? <p className="sm:col-span-2 lg:col-span-5 text-warmRed">{result.message}</p> : null}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-soft text-pantone140">
                  <Bell className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-ink">Gruppebeskeder</h2>
                  <p className="text-sm font-medium text-muted">Frivillige kan ikke sende push-beskeder til grupper.</p>
                </div>
              </div>
            </section>
          )}
        </section>

        <aside className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
          <h2 className="text-lg font-bold text-ink">Seneste push-log</h2>
          <p className="mt-1 text-sm font-medium text-muted">Beskeder sendt fra BackEvent.</p>

          {!isOwner ? (
            <p className="mt-4 rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Kun ejer kan se gruppe-push log.</p>
          ) : logs.length === 0 ? (
            <p className="mt-4 rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Ingen push-beskeder endnu.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {logs.map((log) => (
                <article key={log.id} className="rounded-xl border border-line bg-soft px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-ink">{log.title}</p>
                    <StatusChip status={log.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs font-medium text-muted">{log.body}</p>
                  <p className="mt-2 text-xs font-bold text-muted">
                    {log.recipientEmail ?? "Ukendt"} · {new Date(log.createdAt).toLocaleString("da-DK")}
                  </p>
                  {log.errorMessage ? <p className="mt-1 text-xs font-bold text-warmRed">{log.errorMessage}</p> : null}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function ResultStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="text-xl text-ink">{value}</p>
    </div>
  );
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toLocaleString("da-DK", { maximumFractionDigits: 1 });
}

function runStatusLabel(status: LatestInventoryAlertRun["status"]) {
  if (status === "partial") return "Delvist";
  if (status === "failed") return "Fejl";
  if (status === "skipped") return "Undertrykt";
  return "OK";
}

function StatusChip({ status }: { status: PushLog["status"] }) {
  const label = status === "sent" ? "Sendt" : status === "failed" ? "Fejlet" : "Sprunget over";
  const className =
    status === "sent"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "bg-warmRed/10 text-warmRed"
        : "bg-pantone139/30 text-pantone140";

  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>{label}</span>;
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
