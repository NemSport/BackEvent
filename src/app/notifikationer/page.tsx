"use client";

import Link from "next/link";
import { Bell, CheckCircle2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { ButtonLink, Notice, StatusPill } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PushMessage = {
  id: string;
  senderName: string | null;
  title: string;
  body: string;
  category: string;
  readAt: string | null;
  createdAt: string;
  unread: boolean;
};

export default function NotificationsInboxPage() {
  const [messages, setMessages] = useState<PushMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadMessages() {
      try {
        setLoading(true);
        setError(null);
        const token = await getAccessToken();
        const response = await fetch("/api/push/messages", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = (await response.json()) as { ok?: boolean; messages?: PushMessage[]; unreadCount?: number; message?: string };

        if (!response.ok || !data.ok) {
          throw new Error(data.message ?? "Kunne ikke hente beskeder");
        }

        if (mounted) {
          setMessages(data.messages ?? []);
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch (caught) {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : "Kunne ikke hente beskeder.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadMessages();

    return () => {
      mounted = false;
    };
  }, []);

  async function deleteMessage(messageId: string) {
    if (!window.confirm("Vil du slette beskeden?")) {
      return;
    }

    try {
      setDeletingId(messageId);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(`/api/push/messages/${messageId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke slette besked");
      }

      setMessages((current) => current.filter((message) => message.id !== messageId));
      setUnreadCount((current) => {
        const deleted = messages.find((message) => message.id === messageId);
        return deleted?.unread ? Math.max(0, current - 1) : current;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kunne ikke slette besked.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell>
      <Header title="Notifikationer" subtitle="Beskeder fra BackEvent" />

      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <section className="rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
              <Bell className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Indbakke</h2>
              <p className="text-sm font-medium text-muted">{unreadCount > 0 ? `${unreadCount} ulæste beskeder` : "Ingen ulæste beskeder"}</p>
            </div>
          </div>
          <StatusPill tone={unreadCount > 0 ? "pending" : "success"}>{unreadCount > 0 ? "Ulæst" : "OK"}</StatusPill>
        </div>

        {loading ? (
          <p className="rounded-2xl bg-soft px-4 py-3 text-sm font-bold text-muted">Henter beskeder...</p>
        ) : messages.length === 0 ? (
          <div className="rounded-2xl bg-soft p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-ok" aria-hidden />
            <p className="mt-3 text-lg font-bold text-ink">Ingen beskeder endnu</p>
            <p className="mt-1 text-sm font-medium text-muted">Når BackEvent sender noget vigtigt, lander det her.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`rounded-2xl border p-4 transition hover:border-pantone139 hover:bg-soft/70 ${
                  message.unread ? "border-pantone139 bg-pantone139/15" : "border-line bg-macro"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/notifikationer/${message.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-lg font-bold text-ink">{message.title}</p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm font-medium text-muted">{message.body}</p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    {message.unread ? <span className="h-3 w-3 rounded-full bg-pantone139" aria-label="Ulæst" /> : null}
                    <button
                      type="button"
                      onClick={() => deleteMessage(message.id)}
                      disabled={deletingId === message.id}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-warmRed/10 text-warmRed disabled:opacity-50"
                      aria-label="Slet besked"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
                  <span>{message.senderName ?? "BackEvent"}</span>
                  <span>·</span>
                  <span>{new Date(message.createdAt).toLocaleString("da-DK")}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5">
        <ButtonLink href="/" tone="secondary" className="w-full sm:w-auto">
          Til Start
        </ButtonLink>
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
