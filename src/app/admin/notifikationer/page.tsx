"use client";

import { Bell, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { NotificationSettingsCard } from "@/components/backevent/notification-settings-card";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { getMemberGroupMemberships } from "@/lib/backevent/data";
import { isOperationalGroupName } from "@/lib/backevent/push-messages";
import { roleLabels } from "@/lib/backevent/permissions";
import type { BackEventMember, BackEventMemberGroup, BackEventMemberGroupMembership, MemberRole } from "@/lib/backevent/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SendPushResult = {
  ok: boolean;
  groupId?: string;
  groupName?: string;
  memberCount?: number;
  subscriptionCount?: number;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  message?: string;
  recipientSummary?: string;
};

type TargetMode = "all" | "roles" | "groups" | "members";

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
  const [members, setMembers] = useState<BackEventMember[]>([]);
  const [targetMode, setTargetMode] = useState<TargetMode>("groups");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<MemberRole[]>(["ansvarlig"]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [targetUrl, setTargetUrl] = useState("/notifikationer");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [sendResult, setSendResult] = useState<SendPushResult | null>(null);
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [inventoryAlertResult, setInventoryAlertResult] = useState<InventoryAlertRunResult | null>(null);
  const [latestAutomaticRun, setLatestAutomaticRun] = useState<LatestInventoryAlertRun | null>(null);
  const [runningInventoryAlert, setRunningInventoryAlert] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeGroups = useMemo(
    () => groups.filter((group) => group.active && (isOwner || isOperationalGroupName(group.name))),
    [groups, isOwner],
  );
  const recipientCount = useMemo(() => {
    if (targetMode === "all") return members.filter((member) => member.active).length;
    if (targetMode === "roles") return members.filter((member) => member.active && selectedRoles.includes(member.role)).length;
    if (targetMode === "groups") {
      const memberIds = new Set(
        memberships
          .filter((membership) => selectedGroupIds.includes(membership.groupId))
          .map((membership) => membership.profileId),
      );
      if (members.length === 0) return memberIds.size;
      return members.filter((member) => member.active && memberIds.has(member.id)).length;
    }
    return members.filter((member) => member.active && selectedMemberIds.includes(member.id)).length;
  }, [members, memberships, selectedGroupIds, selectedMemberIds, selectedRoles, targetMode]);
  const lagerGroup = useMemo(() => groups.find((group) => group.name.toLowerCase() === "lageransvarlige") ?? null, [groups]);
  const lagerGroupMemberCount = useMemo(
    () => (lagerGroup ? memberships.filter((membership) => membership.groupId === lagerGroup.id).length : 0),
    [lagerGroup, memberships],
  );

  const loadLogs = useCallback(async () => {
    const token = await getAccessToken();
    const response = await fetch("/api/admin/push/send", {
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
      const [memberGroupData, membersResponse] = await Promise.all([
        getMemberGroupMemberships(),
        isOwner ? fetchMembersForPush() : Promise.resolve(null),
        isOwner ? loadLogs() : Promise.resolve(),
        isOwner ? loadLatestAutomaticRun() : Promise.resolve(),
      ]);
      const onlyActiveGroups = memberGroupData.groups.filter((group) => group.active && (isOwner || isOperationalGroupName(group.name)));
      setGroups(memberGroupData.groups);
      setMemberships(memberGroupData.memberships);
      setSelectedGroupIds((current) => current.length > 0 ? current : onlyActiveGroups[0]?.id ? [onlyActiveGroups[0].id] : []);
      if (membersResponse) {
        setMembers(membersResponse);
      }
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

  async function sendPush() {
    if (!confirmingSend) {
      setConfirmingSend(true);
      return;
    }

    try {
      setSending(true);
      setSendResult(null);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          targetMode,
          groupIds: selectedGroupIds,
          roles: selectedRoles,
          memberIds: selectedMemberIds,
          title,
          message,
          targetUrl,
        }),
      });
      const data = (await response.json()) as SendPushResult;
      setSendResult(data);
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Push-besked kunne ikke sendes.");
      } else {
        setConfirmingSend(false);
      }
      if (isOwner) {
        await loadLogs();
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
              <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
                    <Send className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-ink">Send notifikation</h2>
                    <p className="text-sm font-medium text-muted">Vælg modtagere, se forhåndsvisning og send.</p>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(["groups", "roles", "members", "all"] as TargetMode[]).map((mode) => {
                      const disabled = !isOwner && mode !== "groups";
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={disabled}
                          onClick={() => setTargetMode(mode)}
                          className={`min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-40 ${targetMode === mode ? "bg-pantone139 text-ink" : "bg-soft text-pantone140"}`}
                        >
                          {mode === "groups" ? "Grupper" : mode === "roles" ? "Roller" : mode === "members" ? "Medlemmer" : "Alle"}
                        </button>
                      );
                    })}
                  </div>

                  {targetMode === "groups" ? (
                    <MultiPick
                      items={activeGroups.map((group) => ({ id: group.id, label: group.name }))}
                      selectedIds={selectedGroupIds}
                      onToggle={(id) => toggleId(id, selectedGroupIds, setSelectedGroupIds)}
                    />
                  ) : null}

                  {targetMode === "roles" ? (
                    <MultiPick
                      items={(["frivillig", "ansvarlig", "ejer"] as MemberRole[]).map((role) => ({ id: role, label: roleLabels[role] }))}
                      selectedIds={selectedRoles}
                      onToggle={(id) => toggleId(id as MemberRole, selectedRoles, setSelectedRoles)}
                    />
                  ) : null}

                  {targetMode === "members" ? (
                    <MultiPick
                      items={members.map((member) => ({ id: member.id, label: member.fullName || member.email || "Navn mangler" }))}
                      selectedIds={selectedMemberIds}
                      onToggle={(id) => toggleId(id, selectedMemberIds, setSelectedMemberIds)}
                    />
                  ) : null}

                  <label className="text-sm font-bold text-ink">
                    Titel
                    <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink" />
                  </label>
                  <label className="text-sm font-bold text-ink">
                    Besked
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-line bg-macro px-3 py-2 text-sm font-medium text-ink" />
                  </label>
                  <label className="text-sm font-bold text-ink">
                    Link
                    <select value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink">
                      <option value="/notifikationer">Indbakke</option>
                      <option value="/lagerstatus">Lagerstatus</option>
                      <option value="/admin">Admin</option>
                      <option value="/flyt">Flyt varer</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 rounded-2xl bg-soft p-3">
                  <p className="text-xs font-bold uppercase text-muted">Forhåndsvisning</p>
                  <p className="mt-1 text-sm font-bold text-ink">{title || "Titel"}</p>
                  <p className="text-sm font-medium text-muted">{message || "Besked vises her."}</p>
                  <p className="mt-2 text-sm font-bold text-pantone140">{recipientCount} modtagere</p>
                </div>

                {confirmingSend ? (
                  <div className="mt-3 rounded-xl bg-pantone139/20 p-3 text-sm font-bold text-ink">
                    Send til {recipientCount} modtagere?
                    <button type="button" onClick={() => setConfirmingSend(false)} className="ml-3 text-pantone140">Ret</button>
                  </div>
                ) : null}

                <div className="sticky bottom-20 z-10 mt-4 rounded-2xl bg-macro/95 py-2 backdrop-blur lg:static">
                  <button
                    type="button"
                    onClick={sendPush}
                    disabled={sending || recipientCount === 0 || title.trim().length < 2 || message.trim().length < 2}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pantone139 px-4 text-sm font-bold text-ink disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    {sending ? "Sender..." : confirmingSend ? "Bekræft og send" : "Send notifikation"}
                  </button>
                </div>

                {sendResult ? (
                  <div className="mt-4 grid gap-3 rounded-2xl bg-soft p-4 text-sm font-bold text-ink sm:grid-cols-3">
                    <ResultStat label="Modtagere" value={sendResult.memberCount ?? 0} />
                    <ResultStat label="Sendt" value={sendResult.sentCount ?? 0} />
                    <ResultStat label="Fejlet" value={sendResult.failedCount ?? 0} />
                    <p className="sm:col-span-3 text-muted">{sendResult.recipientSummary ?? ""}</p>
                  </div>
                ) : null}
              </section>

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

function MultiPick({
  items,
  selectedIds,
  onToggle,
}: {
  items: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.length === 0 ? <p className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Ingen valg fundet.</p> : null}
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            className={`min-h-11 rounded-xl px-3 text-left text-sm font-bold ${selected ? "bg-pantone139 text-ink" : "bg-soft text-muted"}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function toggleId<T extends string>(id: T, selectedIds: T[], setter: (value: T[]) => void) {
  setter(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
}

async function fetchMembersForPush() {
  const token = await getAccessToken();
  const response = await fetch("/api/admin/members", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = (await response.json()) as { ok: boolean; members?: BackEventMember[] };
  return data.ok ? data.members ?? [] : [];
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
