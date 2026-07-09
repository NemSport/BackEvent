"use client";

import { Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { getMembers, updateMemberRole } from "@/lib/backevent/data";
import { roleLabels } from "@/lib/backevent/permissions";
import type { BackEventMember, MemberRole } from "@/lib/backevent/types";

const roles: MemberRole[] = ["frivillig", "ansvarlig", "ejer"];

export default function MembersPage() {
  const [members, setMembers] = useState<BackEventMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMembers() {
    try {
      setError(null);
      const loadedMembers = await getMembers();
      setMembers(loadedMembers);
    } catch {
      setError("Kunne ikke hente medlemmer lige nu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMembers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function changeRole(memberId: string, role: MemberRole) {
    try {
      setSavingId(memberId);
      setError(null);
      setMessage(null);
      await updateMemberRole(memberId, role);
      await loadMembers();
      setMessage("Rolle gemt.");
    } catch {
      setError("Kunne ikke gemme rollen. Kun ejer kan ændre medlemmer.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="Medlemmer" subtitle="Administrer adgang og roller i BackEvent" />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
              <UserPlus className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Tilføj medlem</h2>
              <p className="mt-1 text-sm font-medium text-muted">
                Nye brugere opretter sig via login-siden. Når de har oprettet sig, kan ejer ændre deres rolle her.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-soft p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-pantone140" aria-hidden />
            <div>
              <h2 className="text-base font-bold text-ink">Kun ejer</h2>
              <p className="text-sm font-medium text-muted">Denne side er blokeret for ansvarlige og frivillige.</p>
            </div>
          </div>
        </section>
      </div>

      {message ? <p className="mb-4 rounded-2xl bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{message}</p> : null}
      {error ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{error}</p> : null}

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
              <article key={member.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-ink">{member.fullName || "Navn mangler"}</p>
                  <p className="mt-1 flex items-center gap-2 truncate text-sm font-medium text-muted">
                    <Mail className="h-4 w-4 shrink-0" aria-hidden />
                    {member.email || "Email mangler"}
                  </p>
                  {!member.active ? <p className="mt-1 text-xs font-bold text-warmRed">Inaktiv</p> : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <select
                    value={member.role}
                    onChange={(event) => changeRole(member.id, event.target.value as MemberRole)}
                    disabled={savingId === member.id}
                    className="h-10 rounded-xl border border-line bg-macro px-3 text-sm font-bold text-ink outline-none focus:border-pantone140"
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                  <span className="rounded-full bg-soft px-3 py-1 text-xs font-bold text-pantone140">
                    {savingId === member.id ? "Gemmer..." : roleLabels[member.role]}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
