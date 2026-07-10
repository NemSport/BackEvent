"use client";

import { Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import {
  createMemberGroup,
  deleteMemberGroup,
  getMemberGroups,
  getMembers,
  setMemberGroups,
  updateMemberGroup,
  updateMemberRole,
} from "@/lib/backevent/data";
import { roleLabels } from "@/lib/backevent/permissions";
import type { BackEventMember, BackEventMemberGroup, MemberRole } from "@/lib/backevent/types";

const roles: MemberRole[] = ["frivillig", "ansvarlig", "ejer"];

type Tab = "members" | "groups";

export default function MembersPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [members, setMembers] = useState<BackEventMember[]>([]);
  const [groups, setGroups] = useState<BackEventMemberGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [loadedMembers, loadedGroups] = await Promise.all([getMembers(), getMemberGroups()]);
      setMembers(loadedMembers);
      setGroups(loadedGroups);
      setSelectedGroupId((current) => current ?? loadedGroups[0]?.id ?? null);
    } catch {
      setError("Kunne ikke hente medlemmer og grupper lige nu.");
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

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const selectedGroupMembers = useMemo(() => {
    if (!selectedGroup) {
      return [];
    }

    return members.filter((member) => member.groups?.some((group) => group.id === selectedGroup.id));
  }, [members, selectedGroup]);

  async function changeRole(memberId: string, role: MemberRole) {
    try {
      setSavingId(memberId);
      setError(null);
      setMessage(null);
      await updateMemberRole(memberId, role);
      await loadData();
      setMessage("Rolle gemt.");
    } catch {
      setError("Kunne ikke gemme rollen. Kun ejer kan ændre medlemmer.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveGroup() {
    try {
      setSavingId("group-form");
      setError(null);
      setMessage(null);
      await createMemberGroup({ name: groupName, description: groupDescription });
      setGroupName("");
      setGroupDescription("");
      await loadData();
      setMessage("Gruppe oprettet.");
    } catch {
      setError("Kunne ikke gemme gruppen.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveGroupEdit(group: BackEventMemberGroup, input: { name: string; description: string; active: boolean }) {
    try {
      setSavingId(group.id);
      setError(null);
      setMessage(null);
      await updateMemberGroup(group.id, input);
      setEditingGroupId(null);
      await loadData();
      setMessage("Gruppe gemt.");
    } catch {
      setError("Kunne ikke gemme gruppen.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeGroup(group: BackEventMemberGroup) {
    if (!window.confirm(`Slet gruppen "${group.name}"? Medlemmer slettes ikke.`)) {
      return;
    }

    try {
      setSavingId(group.id);
      setError(null);
      setMessage(null);
      await deleteMemberGroup(group.id);
      setSelectedGroupId((current) => (current === group.id ? null : current));
      await loadData();
      setMessage("Gruppe slettet.");
    } catch {
      setError("Kunne ikke slette gruppen.");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleMemberGroup(member: BackEventMember, groupId: string) {
    try {
      setSavingId(`${member.id}-${groupId}`);
      setError(null);
      setMessage(null);
      const currentGroupIds = member.groups?.map((group) => group.id) ?? [];
      const nextGroupIds = currentGroupIds.includes(groupId)
        ? currentGroupIds.filter((id) => id !== groupId)
        : [...currentGroupIds, groupId];

      await setMemberGroups(member.id, nextGroupIds);
      await loadData();
      setMessage("Grupper gemt.");
    } catch {
      setError("Kunne ikke gemme medlemsgrupper.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="Medlemmer" subtitle="Administrer roller og grupper i BackEvent" />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
              <UserPlus className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Tilføj medlem</h2>
              <p className="mt-1 text-sm font-medium text-muted">
                Nye brugere opretter sig via login-siden. Når de har oprettet sig, kan ejer ændre deres rolle og grupper her.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-soft p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-pantone140" aria-hidden />
            <div>
              <h2 className="text-base font-bold text-ink">Roller styrer adgang</h2>
              <p className="text-sm font-medium text-muted">Grupper bruges kun til kommunikation og organisering.</p>
            </div>
          </div>
        </section>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <TabButton active={activeTab === "members"} onClick={() => setActiveTab("members")}>
          Medlemmer
        </TabButton>
        <TabButton active={activeTab === "groups"} onClick={() => setActiveTab("groups")}>
          Grupper
        </TabButton>
      </div>

      {message ? <p className="mb-4 rounded-2xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{message}</p> : null}
      {error ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{error}</p> : null}

      {activeTab === "members" ? (
        <MembersSection
          loading={loading}
          members={members}
          groups={groups}
          savingId={savingId}
          editingMemberId={editingMemberId}
          onEditMember={setEditingMemberId}
          onChangeRole={changeRole}
          onToggleMemberGroup={toggleMemberGroup}
        />
      ) : (
        <GroupsSection
          loading={loading}
          groups={groups}
          members={members}
          selectedGroup={selectedGroup}
          selectedGroupMembers={selectedGroupMembers}
          savingId={savingId}
          editingGroupId={editingGroupId}
          groupName={groupName}
          groupDescription={groupDescription}
          onSelectGroup={setSelectedGroupId}
          onEditGroup={setEditingGroupId}
          onSaveGroup={saveGroup}
          onSaveGroupEdit={saveGroupEdit}
          onDeleteGroup={removeGroup}
          onToggleMemberGroup={toggleMemberGroup}
          onGroupNameChange={setGroupName}
          onGroupDescriptionChange={setGroupDescription}
        />
      )}
    </AppShell>
  );
}

function MembersSection({
  loading,
  members,
  groups,
  savingId,
  editingMemberId,
  onEditMember,
  onChangeRole,
  onToggleMemberGroup,
}: {
  loading: boolean;
  members: BackEventMember[];
  groups: BackEventMemberGroup[];
  savingId: string | null;
  editingMemberId: string | null;
  onEditMember: (memberId: string | null) => void;
  onChangeRole: (memberId: string, role: MemberRole) => void;
  onToggleMemberGroup: (member: BackEventMember, groupId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-macro shadow-soft">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Users className="h-5 w-5 text-pantone140" aria-hidden />
        <h2 className="text-lg font-bold text-ink">Alle medlemmer</h2>
      </div>

      {loading ? (
        <p className="p-4 text-sm font-bold text-muted">Henter medlemmer...</p>
      ) : members.length === 0 ? (
        <p className="p-4 text-sm font-bold text-muted">Ingen medlemmer endnu.</p>
      ) : (
        <div className="divide-y divide-line">
          {members.map((member) => (
            <article key={member.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">{member.fullName || "Navn mangler"}</p>
                <p className="mt-1 flex items-center gap-2 truncate text-sm font-medium text-muted">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  {member.email || "Email mangler"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {member.groups && member.groups.length > 0 ? (
                    member.groups.map((group) => <GroupChip key={group.id} group={group} />)
                  ) : (
                    <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-bold text-muted">Ingen grupper</span>
                  )}
                </div>
                {editingMemberId === member.id ? (
                  <div className="mt-3 rounded-2xl bg-soft p-3">
                    <p className="mb-2 text-xs font-bold uppercase text-muted">Medlemsgrupper</p>
                    <div className="flex flex-wrap gap-2">
                      {groups.map((group) => {
                        const checked = member.groups?.some((item) => item.id === group.id) ?? false;
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => onToggleMemberGroup(member, group.id)}
                            disabled={savingId === `${member.id}-${group.id}`}
                            className={`rounded-xl px-3 py-2 text-sm font-bold ${
                              checked ? "bg-pantone139 text-ink" : "bg-macro text-muted"
                            }`}
                          >
                            {group.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <select
                  value={member.role}
                  onChange={(event) => onChangeRole(member.id, event.target.value as MemberRole)}
                  disabled={savingId === member.id}
                  className="h-10 rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onEditMember(editingMemberId === member.id ? null : member.id)}
                  className="h-10 rounded-xl bg-soft px-3 text-sm font-bold text-pantone140"
                >
                  Grupper
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function GroupsSection({
  loading,
  groups,
  members,
  selectedGroup,
  selectedGroupMembers,
  savingId,
  editingGroupId,
  groupName,
  groupDescription,
  onSelectGroup,
  onEditGroup,
  onSaveGroup,
  onSaveGroupEdit,
  onDeleteGroup,
  onToggleMemberGroup,
  onGroupNameChange,
  onGroupDescriptionChange,
}: {
  loading: boolean;
  groups: BackEventMemberGroup[];
  members: BackEventMember[];
  selectedGroup: BackEventMemberGroup | null;
  selectedGroupMembers: BackEventMember[];
  savingId: string | null;
  editingGroupId: string | null;
  groupName: string;
  groupDescription: string;
  onSelectGroup: (groupId: string) => void;
  onEditGroup: (groupId: string | null) => void;
  onSaveGroup: () => void;
  onSaveGroupEdit: (group: BackEventMemberGroup, input: { name: string; description: string; active: boolean }) => void;
  onDeleteGroup: (group: BackEventMemberGroup) => void;
  onToggleMemberGroup: (member: BackEventMember, groupId: string) => void;
  onGroupNameChange: (value: string) => void;
  onGroupDescriptionChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft">
        <h2 className="mb-4 text-lg font-bold text-ink">Opret gruppe</h2>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={groupName}
            onChange={(event) => onGroupNameChange(event.target.value)}
            placeholder="Gruppenavn"
            className="h-11 rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
          />
          <input
            value={groupDescription}
            onChange={(event) => onGroupDescriptionChange(event.target.value)}
            placeholder="Beskrivelse"
            className="h-11 rounded-xl border border-line bg-macro px-3 text-sm font-medium text-ink outline-none focus:border-pantone140"
          />
          <button
            type="button"
            onClick={onSaveGroup}
            disabled={savingId === "group-form"}
            className="h-11 rounded-xl bg-pantone139 px-4 text-sm font-bold text-ink disabled:opacity-50"
          >
            Opret gruppe
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-macro shadow-soft xl:col-span-1">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-lg font-bold text-ink">Grupper</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm font-bold text-muted">Henter grupper...</p>
        ) : groups.length === 0 ? (
          <p className="p-4 text-sm font-bold text-muted">Ingen grupper endnu.</p>
        ) : (
          <div className="divide-y divide-line">
            {groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                active={selectedGroup?.id === group.id}
                editing={editingGroupId === group.id}
                saving={savingId === group.id}
                onSelect={() => onSelectGroup(group.id)}
                onEdit={() => onEditGroup(editingGroupId === group.id ? null : group.id)}
                onSave={(input) => onSaveGroupEdit(group, input)}
                onDelete={() => onDeleteGroup(group)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <h2 className="text-lg font-bold text-ink">{selectedGroup ? selectedGroup.name : "Vælg gruppe"}</h2>
        <p className="mt-1 text-sm font-medium text-muted">
          {selectedGroup?.description || "Åbn en gruppe for at se og tildele medlemmer."}
        </p>
        {selectedGroup ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold uppercase text-muted">Medlemmer i gruppen</p>
            {selectedGroupMembers.length === 0 ? (
              <p className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-muted">Ingen medlemmer i gruppen.</p>
            ) : (
              selectedGroupMembers.map((member) => (
                <div key={member.id} className="rounded-xl bg-soft px-3 py-2 text-sm">
                  <p className="font-bold text-ink">{member.fullName || member.email || "Navn mangler"}</p>
                  <p className="font-medium text-muted">{roleLabels[member.role]}</p>
                </div>
              ))
            )}
            <div className="pt-3">
              <p className="mb-2 text-xs font-bold uppercase text-muted">Tildel/fjern medlemmer</p>
              <div className="space-y-2">
                {members.map((member) => {
                  const checked = member.groups?.some((group) => group.id === selectedGroup.id) ?? false;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => onToggleMemberGroup(member, selectedGroup.id)}
                      disabled={savingId === `${member.id}-${selectedGroup.id}`}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold ${
                        checked ? "bg-pantone139 text-ink" : "bg-soft text-muted"
                      }`}
                    >
                      <span>{member.fullName || member.email || "Navn mangler"}</span>
                      <span>{checked ? "Valgt" : roleLabels[member.role]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function GroupRow({
  group,
  active,
  editing,
  saving,
  onSelect,
  onEdit,
  onSave,
  onDelete,
}: {
  group: BackEventMemberGroup;
  active: boolean;
  editing: boolean;
  saving: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSave: (input: { name: string; description: string; active: boolean }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [isActive, setIsActive] = useState(group.active);

  if (editing) {
    return (
      <article className="space-y-2 px-4 py-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 w-full rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Beskrivelse"
          className="h-10 w-full rounded-xl border border-line bg-macro px-3 text-sm font-medium text-ink outline-none focus:border-pantone140"
        />
        <label className="flex items-center gap-2 text-sm font-bold text-muted">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          Aktiv
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onSave({ name, description, active: isActive })} disabled={saving} className="rounded-xl bg-pantone139 px-3 py-2 text-sm font-bold text-ink">
            Gem
          </button>
          <button type="button" onClick={onEdit} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
            Annuller
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={`px-4 py-3 ${active ? "bg-pantone139/20" : ""}`}>
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-ink">{group.name}</h3>
            <p className="text-sm font-medium text-muted">{group.description || "Ingen beskrivelse"}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${group.active ? "bg-soft text-pantone140" : "bg-warmRed/10 text-warmRed"}`}>
            {group.active ? "Aktiv" : "Inaktiv"}
          </span>
        </div>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
          Rediger
        </button>
        <button type="button" onClick={() => onSave({ name: group.name, description: group.description ?? "", active: !group.active })} className="rounded-xl bg-soft px-3 py-2 text-sm font-bold text-pantone140">
          {group.active ? "Deaktivér" : "Aktivér"}
        </button>
        <button type="button" onClick={onDelete} className="rounded-xl bg-warmRed/10 px-3 py-2 text-sm font-bold text-warmRed">
          Slet
        </button>
      </div>
    </article>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-bold ${active ? "bg-pantone139 text-ink" : "bg-soft text-pantone140"}`}
    >
      {children}
    </button>
  );
}

function GroupChip({ group }: { group: BackEventMemberGroup }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${group.active ? "bg-pantone139/30 text-pantone140" : "bg-soft text-muted"}`}>
      {group.name}
    </span>
  );
}
