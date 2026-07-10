"use client";

import { Bell, CheckCircle2, Mail, Pencil, Plus, Search, Send, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { useBackEventAuth } from "@/lib/backevent/auth";
import { allPermissions, permissionLabels, roleDefaultPermissions, roleLabels } from "@/lib/backevent/permissions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BackEventMember, BackEventMemberGroup, BackEventPermissionKey, MemberRole } from "@/lib/backevent/types";

type InvitationFilter = "all" | "accepted" | "pending" | "not_sent";
type PushFilter = "all" | "active" | "missing";
type ReadyFilter = "all" | "ready" | "not_ready";
type StatusFilter = "all" | "active" | "inactive";
type SortKey = "name" | "role" | "status" | "ready" | "lastLogin";
type SortDirection = "asc" | "desc";

type MembersResponse = {
  ok: boolean;
  message?: string;
  members: BackEventMember[];
  groups: BackEventMemberGroup[];
  mockMode?: boolean;
};

type MemberFormState = {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  role: MemberRole;
  active: boolean;
  groupIds: string[];
  permissions: BackEventPermissionKey[];
  sendInvite: boolean;
  confirmSelfDeactivate: boolean;
};

const roles: MemberRole[] = ["frivillig", "ansvarlig", "ejer"];

const emptyForm: MemberFormState = {
  fullName: "",
  email: "",
  phone: "",
  role: "frivillig",
  active: true,
  groupIds: [],
  permissions: roleDefaultPermissions.frivillig,
  sendInvite: true,
  confirmSelfDeactivate: false,
};

export default function MembersPage() {
  const { profile } = useBackEventAuth();
  const [members, setMembers] = useState<BackEventMember[]>([]);
  const [groups, setGroups] = useState<BackEventMemberGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const [form, setForm] = useState<MemberFormState | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | MemberRole>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [invitationFilter, setInvitationFilter] = useState<InvitationFilter>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [pushFilter, setPushFilter] = useState<PushFilter>("all");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/members", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as MembersResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke hente medlemmer");
      }
      setMembers(data.members ?? []);
      setGroups(data.groups ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kunne ikke hente medlemmer.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  const rows = useMemo(() => members.map((member) => ({ member, readiness: getReadiness(member) })), [members]);
  const stats = useMemo(() => {
    const readyCount = rows.filter((row) => row.readiness.level === "ready").length;
    const notReadyCount = rows.length - readyCount;
    return {
      readyCount,
      notReadyCount,
      missingPushCount: rows.filter((row) => (row.member.pushSubscriptionCount ?? 0) === 0).length,
      pendingInvitations: rows.filter((row) => row.member.invitationStatus === "pending").length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter(({ member, readiness }) => {
        if (roleFilter !== "all" && member.role !== roleFilter) return false;
        if (statusFilter === "active" && !member.active) return false;
        if (statusFilter === "inactive" && member.active) return false;
        if (invitationFilter !== "all" && member.invitationStatus !== invitationFilter) return false;
        if (groupFilter !== "all" && !(member.groups ?? []).some((group) => group.id === groupFilter)) return false;
        if (pushFilter === "active" && (member.pushSubscriptionCount ?? 0) === 0) return false;
        if (pushFilter === "missing" && (member.pushSubscriptionCount ?? 0) > 0) return false;
        if (readyFilter === "ready" && readiness.level !== "ready") return false;
        if (readyFilter === "not_ready" && readiness.level === "ready") return false;
        if (normalizedQuery && !`${member.fullName ?? ""} ${member.email ?? ""} ${member.phone ?? ""}`.toLowerCase().includes(normalizedQuery)) return false;
        return true;
      })
      .sort((a, b) => compareMembers(a.member, b.member, a.readiness.level, b.readiness.level, sortKey, sortDirection));
  }, [groupFilter, invitationFilter, pushFilter, query, readyFilter, roleFilter, rows, sortDirection, sortKey, statusFilter]);

  function openCreate() {
    setForm(emptyForm);
    setMessage(null);
    setError(null);
  }

  function openEdit(member: BackEventMember) {
    setForm({
      id: member.id,
      fullName: member.fullName ?? "",
      email: member.email ?? "",
      phone: member.phone ?? "",
      role: member.role,
      active: member.active,
      groupIds: member.groups?.map((group) => group.id) ?? [],
      permissions: member.permissions ?? [],
      sendInvite: false,
      confirmSelfDeactivate: false,
    });
    setMessage(null);
    setError(null);
  }

  async function saveMember() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(form.id ? `/api/admin/members/${form.id}` : "/api/admin/members", {
        method: form.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke gemme medlem");
      }
      setForm(null);
      await loadData();
      setMessage(form.id ? "Medlem gemt." : "Medlem oprettet.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kunne ikke gemme medlem.");
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite(member: BackEventMember) {
    setSendingInviteId(member.id);
    setError(null);
    setMessage(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/admin/members/${member.id}/invite`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke sende invitation");
      }
      await loadData();
      setMessage("Invitation sendt.");
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Kunne ikke sende invitation.");
    } finally {
      setSendingInviteId(null);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  }

  const activeFilterCount = [query, roleFilter !== "all", statusFilter !== "all", invitationFilter !== "all", groupFilter !== "all", pushFilter !== "all", readyFilter !== "all"].filter(Boolean).length;

  return (
    <AppShell requiredRole="ejer">
      <Header title="Medlemmer" subtitle="Opret, inviter og gør holdet klar til marked" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Klar" value={stats.readyCount} tone="green" icon={CheckCircle2} />
        <StatCard label="Ikke klar" value={stats.notReadyCount} tone="yellow" icon={ShieldCheck} />
        <StatCard label="Uden push" value={stats.missingPushCount} tone="red" icon={Bell} />
        <StatCard label="Invitation afventer" value={stats.pendingInvitations} tone="yellow" icon={Mail} />
      </div>

      <section className="mb-4 rounded-2xl border border-line bg-macro p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1 text-xs font-bold text-muted">
            Søg
            <span className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-line bg-macro px-2">
              <Search className="h-4 w-4 text-muted" aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-ink outline-none" placeholder="Navn, mail eller telefon" />
            </span>
          </label>
          <FilterSelect label="Rolle" value={roleFilter} onChange={(value) => setRoleFilter(value as "all" | MemberRole)} options={[["all", "Alle"], ...roles.map((role) => [role, roleLabels[role]] as const)]} />
          <FilterSelect label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} options={[["all", "Alle"], ["active", "Aktiv"], ["inactive", "Inaktiv"]]} />
          <FilterSelect label="Invitation" value={invitationFilter} onChange={(value) => setInvitationFilter(value as InvitationFilter)} options={[["all", "Alle"], ["accepted", "Accepteret"], ["pending", "Afventer"], ["not_sent", "Ikke sendt"]]} />
          <FilterSelect label="Gruppe" value={groupFilter} onChange={setGroupFilter} options={[["all", "Alle"], ...groups.map((group) => [group.id, group.name] as const)]} />
          <FilterSelect label="Push" value={pushFilter} onChange={(value) => setPushFilter(value as PushFilter)} options={[["all", "Alle"], ["active", "Push aktiv"], ["missing", "Mangler push"]]} />
          <FilterSelect label="Klar" value={readyFilter} onChange={(value) => setReadyFilter(value as ReadyFilter)} options={[["all", "Alle"], ["ready", "Klar"], ["not_ready", "Ikke klar"]]} />
          <button type="button" onClick={() => { setQuery(""); setRoleFilter("all"); setStatusFilter("all"); setInvitationFilter("all"); setGroupFilter("all"); setPushFilter("all"); setReadyFilter("all"); }} className="h-9 rounded-lg border border-line bg-soft px-3 text-sm font-bold text-pantone140">
            Nulstil {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-9 items-center gap-2 rounded-lg bg-pantone139 px-3 text-sm font-bold text-ink">
            <Plus className="h-4 w-4" aria-hidden />
            Opret medlem
          </button>
        </div>
      </section>

      {message ? <p className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-700">{message}</p> : null}
      {error ? <p className="mb-3 rounded-xl bg-warmRed/10 px-3 py-2 text-sm font-bold text-warmRed">{error}</p> : null}

      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-muted">Viser {filteredRows.length} af {members.length} medlemmer</p>
        <SortSelect sortKey={sortKey} sortDirection={sortDirection} onSortKey={setSortKey} onSortDirection={setSortDirection} />
      </div>

      {loading ? (
        <p className="rounded-2xl border border-line bg-macro p-4 text-sm font-bold text-muted">Henter medlemmer...</p>
      ) : (
        <>
          <div className="hidden overflow-auto rounded-2xl border border-line bg-macro shadow-sm lg:block">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 bg-soft text-xs font-bold uppercase text-muted">
                <tr>
                  <SortableHeader label="Navn" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <th className="border-b border-line px-2 py-2">Kontakt</th>
                  <SortableHeader label="Rolle" sortKey="role" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <th className="border-b border-line px-2 py-2">Invitation</th>
                  <th className="border-b border-line px-2 py-2">Push</th>
                  <th className="border-b border-line px-2 py-2">Grupper</th>
                  <SortableHeader label="Klar" sortKey="ready" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Seneste login" sortKey="lastLogin" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <th className="border-b border-line px-2 py-2">Handling</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ member, readiness }) => (
                  <MemberTableRow key={member.id} member={member} readiness={readiness} sendingInvite={sendingInviteId === member.id} onEdit={openEdit} onInvite={sendInvite} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 lg:hidden">
            {filteredRows.map(({ member, readiness }) => (
              <MemberMobileRow key={member.id} member={member} readiness={readiness} sendingInvite={sendingInviteId === member.id} onEdit={openEdit} onInvite={sendInvite} />
            ))}
          </div>
        </>
      )}

      {form ? (
        <MemberModal
          form={form}
          groups={groups}
          currentUserId={profile?.id}
          saving={saving}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSave={saveMember}
        />
      ) : null}
    </AppShell>
  );
}

function MemberTableRow({
  member,
  readiness,
  sendingInvite,
  onEdit,
  onInvite,
}: {
  member: BackEventMember;
  readiness: ReturnType<typeof getReadiness>;
  sendingInvite: boolean;
  onEdit: (member: BackEventMember) => void;
  onInvite: (member: BackEventMember) => void;
}) {
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="border-b border-line/70 px-2 py-1.5 font-bold text-ink">{member.fullName || "Navn mangler"}</td>
      <td className="border-b border-line/70 px-2 py-1.5 text-xs font-medium text-muted">
        <p>{member.email || "Mail mangler"}</p>
        {member.phone ? <p>{member.phone}</p> : null}
      </td>
      <td className="border-b border-line/70 px-2 py-1.5 text-muted">{roleLabels[member.role]}</td>
      <td className="border-b border-line/70 px-2 py-1.5"><StatusChip label={member.active ? "Aktiv" : "Inaktiv"} tone={member.active ? "green" : "red"} /></td>
      <td className="border-b border-line/70 px-2 py-1.5"><InvitationChip status={member.invitationStatus} /></td>
      <td className="border-b border-line/70 px-2 py-1.5"><StatusChip label={(member.pushSubscriptionCount ?? 0) > 0 ? `${member.pushSubscriptionCount} enhed` : "Ingen"} tone={(member.pushSubscriptionCount ?? 0) > 0 ? "green" : "yellow"} /></td>
      <td className="max-w-60 border-b border-line/70 px-2 py-1.5">
        <GroupList groups={member.groups ?? []} />
      </td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <StatusChip label={readiness.label} tone={readiness.tone} />
        {readiness.missing.length > 0 ? <p className="mt-1 max-w-56 text-xs font-medium text-muted">{readiness.missing.join(", ")}</p> : null}
      </td>
      <td className="border-b border-line/70 px-2 py-1.5 text-xs font-medium text-muted">{formatDate(member.lastLoginAt)}</td>
      <td className="border-b border-line/70 px-2 py-1.5">
        <div className="flex gap-1">
          <button type="button" onClick={() => onEdit(member)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-macro px-2 text-xs font-bold text-pantone140">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Redigér
          </button>
          <button type="button" onClick={() => onInvite(member)} disabled={sendingInvite || !member.email} className="inline-flex h-8 items-center gap-1 rounded-lg bg-pantone139 px-2 text-xs font-bold text-ink disabled:opacity-40">
            <Send className="h-3.5 w-3.5" aria-hidden />
            {sendingInvite ? "Sender" : "Invitér"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function MemberMobileRow({
  member,
  readiness,
  sendingInvite,
  onEdit,
  onInvite,
}: {
  member: BackEventMember;
  readiness: ReturnType<typeof getReadiness>;
  sendingInvite: boolean;
  onEdit: (member: BackEventMember) => void;
  onInvite: (member: BackEventMember) => void;
}) {
  return (
    <article className="rounded-2xl border border-line bg-macro p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink">{member.fullName || "Navn mangler"}</p>
          <p className="text-sm font-medium text-muted">{member.email || "Mail mangler"}</p>
          <p className="text-xs font-bold text-muted">{roleLabels[member.role]}</p>
        </div>
        <StatusChip label={readiness.label} tone={readiness.tone} />
      </div>
      {readiness.missing.length > 0 ? <p className="mt-2 text-xs font-bold text-warmRed">{readiness.missing.join(", ")}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusChip label={member.active ? "Aktiv" : "Inaktiv"} tone={member.active ? "green" : "red"} />
        <InvitationChip status={member.invitationStatus} />
        <StatusChip label={(member.pushSubscriptionCount ?? 0) > 0 ? "Push aktiv" : "Mangler push"} tone={(member.pushSubscriptionCount ?? 0) > 0 ? "green" : "yellow"} />
      </div>
      <GroupList groups={member.groups ?? []} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onEdit(member)} className="h-10 rounded-xl border border-line bg-macro text-sm font-bold text-pantone140">
          Redigér
        </button>
        <button type="button" onClick={() => onInvite(member)} disabled={sendingInvite || !member.email} className="h-10 rounded-xl bg-pantone139 text-sm font-bold text-ink disabled:opacity-40">
          {sendingInvite ? "Sender..." : "Send invitation"}
        </button>
      </div>
    </article>
  );
}

function MemberModal({
  form,
  groups,
  currentUserId,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  form: MemberFormState;
  groups: BackEventMemberGroup[];
  currentUserId?: string;
  saving: boolean;
  onChange: (form: MemberFormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const editing = Boolean(form.id);
  const deactivatingSelf = editing && form.id === currentUserId && !form.active;

  function patch(patchValue: Partial<MemberFormState>) {
    onChange({ ...form, ...patchValue });
  }

  function toggleGroup(groupId: string) {
    patch({
      groupIds: form.groupIds.includes(groupId)
        ? form.groupIds.filter((id) => id !== groupId)
        : [...form.groupIds, groupId],
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-3">
      <section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border border-line bg-macro p-4 shadow-soft">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink">{editing ? "Redigér medlem" : "Opret medlem"}</h2>
            <p className="text-sm font-medium text-muted">Ejer kan ændre rolle, status, grupper og konkrete tilladelser.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-soft px-3 py-2 text-sm font-bold text-pantone140">
            Luk
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Navn" value={form.fullName} onChange={(value) => patch({ fullName: value })} />
          <Field label="E-mail" value={form.email} onChange={(value) => patch({ email: value })} type="email" />
          <Field label="Telefon" value={form.phone} onChange={(value) => patch({ phone: value })} />
          <label className="text-xs font-bold text-muted">
            Rolle
            <select
              value={form.role}
              onChange={(event) => {
                const role = event.target.value as MemberRole;
                patch({ role, permissions: role === "ejer" ? allPermissions : roleDefaultPermissions[role] });
              }}
              className="mt-1 h-10 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink"
            >
              {roles.map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm font-bold text-muted">
            <input type="checkbox" checked={form.active} onChange={(event) => patch({ active: event.target.checked, confirmSelfDeactivate: false })} className="h-4 w-4 accent-pantone140" />
            Aktiv
          </label>
          {!editing ? (
            <label className="flex items-center gap-2 text-sm font-bold text-muted">
              <input type="checkbox" checked={form.sendInvite} onChange={(event) => patch({ sendInvite: event.target.checked })} className="h-4 w-4 accent-pantone140" />
              Send invitation nu
            </label>
          ) : null}
          {deactivatingSelf ? (
            <label className="flex items-center gap-2 rounded-xl bg-warmRed/10 px-3 py-2 text-sm font-bold text-warmRed">
              <input type="checkbox" checked={form.confirmSelfDeactivate} onChange={(event) => patch({ confirmSelfDeactivate: event.target.checked })} className="h-4 w-4" />
              Jeg forstår, at jeg deaktiverer mig selv
            </label>
          ) : null}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase text-muted">Grupper</p>
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 ? <p className="text-sm font-bold text-muted">Ingen grupper endnu.</p> : null}
            {groups.map((group) => {
              const checked = form.groupIds.includes(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${checked ? "bg-pantone139 text-ink" : "bg-soft text-muted"}`}
                >
                  {group.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase text-muted">Tilladelser</p>
          {form.role === "ejer" ? (
            <p className="rounded-xl bg-pantone139/20 px-3 py-2 text-sm font-bold text-pantone140">Ejer har altid alle tilladelser.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {allPermissions.map((permission) => {
                const checked = form.permissions.includes(permission);
                return (
                  <label key={permission} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold ${checked ? "bg-pantone139/25 text-ink" : "bg-soft text-muted"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        patch({
                          permissions: event.target.checked
                            ? [...form.permissions, permission]
                            : form.permissions.filter((item) => item !== permission),
                        })
                      }
                      className="h-4 w-4 accent-pantone140"
                    />
                    {permissionLabels[permission]}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-line bg-macro px-4 text-sm font-bold text-pantone140">
            Annuller
          </button>
          <button type="button" onClick={onSave} disabled={saving || deactivatingSelf && !form.confirmSelfDeactivate} className="h-10 rounded-xl bg-pantone139 px-4 text-sm font-bold text-ink disabled:opacity-50">
            {saving ? "Gemmer..." : "Gem medlem"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="text-xs font-bold text-muted">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} type={type} className="mt-1 h-10 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-pantone139/50" />
    </label>
  );
}

function StatCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone: "green" | "yellow" | "red"; icon: typeof Users }) {
  const toneClass = tone === "green" ? "text-green-700 bg-green-50" : tone === "red" ? "text-warmRed bg-warmRed/10" : "text-pantone140 bg-pantone139/25";
  return (
    <article className="rounded-2xl border border-line bg-macro p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" aria-hidden /></span>
        <div>
          <p className="text-2xl font-bold text-ink">{value}</p>
          <p className="text-xs font-bold uppercase text-muted">{label}</p>
        </div>
      </div>
    </article>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="min-w-32 text-xs font-bold text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function SortSelect({ sortKey, sortDirection, onSortKey, onSortDirection }: { sortKey: SortKey; sortDirection: SortDirection; onSortKey: (key: SortKey) => void; onSortDirection: (direction: SortDirection) => void }) {
  return (
    <div className="flex gap-2">
      <select value={sortKey} onChange={(event) => onSortKey(event.target.value as SortKey)} className="h-9 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
        <option value="name">Navn</option>
        <option value="role">Rolle</option>
        <option value="status">Status</option>
        <option value="ready">Klar</option>
        <option value="lastLogin">Seneste login</option>
      </select>
      <select value={sortDirection} onChange={(event) => onSortDirection(event.target.value as SortDirection)} className="h-9 rounded-lg border border-line bg-macro px-2 text-sm font-bold text-ink">
        <option value="asc">A-Å</option>
        <option value="desc">Å-A</option>
      </select>
    </div>
  );
}

function SortableHeader({ label, sortKey, activeKey, direction, onSort }: { label: string; sortKey: SortKey; activeKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void }) {
  return (
    <th className="border-b border-line px-2 py-2">
      <button type="button" onClick={() => onSort(sortKey)} className="font-bold text-muted hover:text-pantone140">
        {label}{activeKey === sortKey ? (direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

function GroupList({ groups }: { groups: BackEventMemberGroup[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {groups.length === 0 ? <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-muted">Ingen grupper</span> : null}
      {groups.slice(0, 4).map((group) => (
        <span key={group.id} className="rounded-full bg-pantone139/25 px-2 py-0.5 text-[11px] font-bold text-pantone140">{group.name}</span>
      ))}
      {groups.length > 4 ? <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-bold text-muted">+{groups.length - 4}</span> : null}
    </div>
  );
}

function InvitationChip({ status }: { status?: BackEventMember["invitationStatus"] }) {
  if (status === "accepted") return <StatusChip label="Accepteret" tone="green" />;
  if (status === "pending") return <StatusChip label="Afventer" tone="yellow" />;
  return <StatusChip label="Ikke sendt" tone="red" />;
}

function StatusChip({ label, tone }: { label: string; tone: "green" | "yellow" | "red" | "gray" }) {
  const classes = {
    green: "bg-green-50 text-green-700",
    yellow: "bg-pantone139/25 text-pantone140",
    red: "bg-warmRed/10 text-warmRed",
    gray: "bg-soft text-muted",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${classes[tone]}`}>{label}</span>;
}

function getReadiness(member: BackEventMember) {
  const missing: string[] = [];
  if (!member.active) missing.push("Inaktiv");
  if (member.invitationStatus !== "accepted") missing.push("Invitation ikke accepteret");
  if (!roles.includes(member.role)) missing.push("Ugyldig rolle");
  if ((member.pushSubscriptionCount ?? 0) === 0) missing.push("Mangler push");

  if (missing.length === 0) {
    return { level: "ready" as const, label: "Klar", tone: "green" as const, missing };
  }

  if (!member.active) {
    return { level: "not_ready" as const, label: "Ikke klar", tone: "red" as const, missing };
  }

  return { level: "needs_attention" as const, label: "Mangler noget", tone: "yellow" as const, missing };
}

function compareMembers(a: BackEventMember, b: BackEventMember, aReady: string, bReady: string, sortKey: SortKey, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  let result = 0;
  if (sortKey === "name") result = (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? "", "da");
  if (sortKey === "role") result = roleLabels[a.role].localeCompare(roleLabels[b.role], "da");
  if (sortKey === "status") result = Number(b.active) - Number(a.active);
  if (sortKey === "ready") result = readyRank(aReady) - readyRank(bReady);
  if (sortKey === "lastLogin") result = (a.lastLoginAt ?? "").localeCompare(b.lastLoginAt ?? "");
  return result === 0 ? (a.email ?? "").localeCompare(b.email ?? "", "da") : result * multiplier;
}

function readyRank(level: string) {
  if (level === "ready") return 1;
  if (level === "needs_attention") return 2;
  return 3;
}

function formatDate(value?: string | null) {
  if (!value) return "Aldrig";
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

async function getAccessToken() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
