"use client";

import { AlertTriangle, Mail, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getMembers } from "@/lib/backevent/data";
import { roleLabels } from "@/lib/backevent/permissions";
import type { BackEventMember, MemberRole } from "@/lib/backevent/types";

type SendResult = {
  ok: boolean;
  sent: number;
  failed: number;
  results?: Array<{ recipient: string; status: "sent" | "failed"; errorMessage: string | null }>;
  message?: string;
};

type EmailLog = {
  id: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  category: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
};

type AlertPreview = {
  ok: boolean;
  lowStockItems: Array<{ locationName: string; productName: string; quantity: number; unit: string }>;
  criticalStockItems: Array<{ locationName: string; productName: string; quantity: number; unit: string }>;
  previewSubject: string;
  previewText: string;
  message?: string;
};

const roles: MemberRole[] = ["frivillig", "ansvarlig", "ejer"];

export default function AdminEmailsPage() {
  const [members, setMembers] = useState<BackEventMember[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<MemberRole[]>(["ansvarlig", "ejer"]);
  const [manualRecipients, setManualRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRecipients = useMemo(() => {
    const roleEmails = members
      .filter((member) => member.active && member.email && selectedRoles.includes(member.role))
      .map((member) => member.email as string);
    const manualEmails = manualRecipients
      .split(/[\n,;]/)
      .map((recipient) => recipient.trim())
      .filter(Boolean);

    return Array.from(new Set([...roleEmails, ...manualEmails].map((recipient) => recipient.toLowerCase())));
  }, [manualRecipients, members, selectedRoles]);

  const loadLogs = useCallback(async () => {
    const token = await getAccessToken();
    const response = await fetch("/api/admin/emails/send", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const data = (await response.json()) as { ok: boolean; logs?: EmailLog[]; message?: string };

    if (!response.ok || !data.ok) {
      throw new Error(data.message ?? "Kunne ikke hente email-log");
    }

    setLogs(data.logs ?? []);
  }, []);

  const loadPageData = useCallback(async () => {
    try {
      setError(null);
      const [loadedMembers] = await Promise.all([getMembers(), loadLogs()]);
      setMembers(loadedMembers);
    } catch {
      setError("Kunne ikke hente emaildata lige nu.");
    }
  }, [loadLogs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPageData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPageData]);

  async function sendEmail() {
    try {
      setSending(true);
      setResult(null);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/emails/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          recipients: selectedRecipients,
          subject,
          message,
          category: "general_message",
        }),
      });
      const data = (await response.json()) as SendResult;
      setResult(data);

      if (!response.ok || !data.ok) {
        setError(data.message ?? "Email kunne ikke sendes til alle.");
      }

      await loadLogs();
    } catch {
      setError("Email kunne ikke sendes lige nu.");
    } finally {
      setSending(false);
    }
  }

  async function loadInventoryPreview() {
    try {
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/admin/emails/inventory-alert-preview", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as AlertPreview;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke lave preview");
      }

      setPreview(data);
    } catch {
      setError("Kunne ikke lave lager-preview.");
    }
  }

  function toggleRole(role: MemberRole) {
    setSelectedRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  return (
    <AppShell requiredRole="ejer">
      <Header title="Emails" subtitle="Send backend-beskeder og forbered lageralarmer" />

      {error ? <p className="mb-4 rounded-2xl bg-warmRed/10 px-4 py-3 text-sm font-bold text-warmRed">{error}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
              <Mail className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-bold text-ink">Send besked</h2>
              <p className="text-sm font-medium text-muted">Kun ejer kan sende generelle emails.</p>
            </div>
          </div>

          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-ink">Modtagere efter rolle</legend>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                      selectedRoles.includes(role) ? "border-pantone140 bg-pantone139 text-ink" : "border-line bg-soft text-muted"
                    }`}
                  >
                    {roleLabels[role]}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-ink">Manuelle emails</span>
              <textarea
                value={manualRecipients}
                onChange={(event) => setManualRecipients(event.target.value)}
                rows={3}
                placeholder="navn@example.dk, andet@example.dk"
                className="w-full rounded-2xl border border-line bg-macro px-4 py-3 text-base font-medium text-ink outline-none focus:border-pantone140"
              />
            </label>

            <div className="rounded-2xl bg-soft px-4 py-3 text-sm font-bold text-muted">
              {selectedRecipients.length} modtagere valgt
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-ink">Emne</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="h-12 w-full rounded-2xl border border-line bg-macro px-4 text-base font-medium text-ink outline-none focus:border-pantone140"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-ink">Besked</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={8}
                className="w-full rounded-2xl border border-line bg-macro px-4 py-3 text-base font-medium text-ink outline-none focus:border-pantone140"
              />
            </label>

            <button
              type="button"
              onClick={sendEmail}
              disabled={sending || selectedRecipients.length === 0}
              className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-pantone139 px-5 py-3 text-base font-bold text-ink disabled:opacity-50"
            >
              <Send className="h-5 w-5" aria-hidden />
              {sending ? "Sender..." : "Send email"}
            </button>

            {result ? (
              <div className="rounded-2xl border border-line bg-soft px-4 py-3 text-sm font-bold text-ink">
                Sendt: {result.sent} · Fejlet: {result.failed}
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-pantone140" aria-hidden />
              <h2 className="text-lg font-bold text-ink">Lageralarm preview</h2>
            </div>
            <button
              type="button"
              onClick={loadInventoryPreview}
              className="mb-4 rounded-xl bg-soft px-4 py-2 text-sm font-bold text-pantone140"
            >
              Lav preview
            </button>
            {preview ? (
              <div className="space-y-3 text-sm font-medium text-muted">
                <p className="font-bold text-ink">{preview.previewSubject}</p>
                <p>Kritisk: {preview.criticalStockItems.length}</p>
                <p>Lavt lager: {preview.lowStockItems.length}</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-soft p-3 text-xs text-ink">{preview.previewText}</pre>
              </div>
            ) : (
              <p className="text-sm font-medium text-muted">Ingen automatiske lageremails sendes endnu.</p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-macro p-5 shadow-soft">
            <h2 className="mb-3 text-lg font-bold text-ink">Seneste email-log</h2>
            <div className="space-y-2">
              {logs.length === 0 ? (
                <p className="text-sm font-medium text-muted">Ingen emails endnu.</p>
              ) : (
                logs.slice(0, 10).map((log) => (
                  <article key={log.id} className="rounded-xl bg-soft px-3 py-2 text-xs font-medium text-muted">
                    <p className="font-bold text-ink">{log.subject}</p>
                    <p>{log.recipientEmail}</p>
                    <p>
                      {log.status} · {new Date(log.createdAt).toLocaleString("da-DK")}
                    </p>
                    {log.errorMessage ? <p className="text-warmRed">{log.errorMessage}</p> : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
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
