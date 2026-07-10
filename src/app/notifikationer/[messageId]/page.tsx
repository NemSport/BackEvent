"use client";

import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/backevent/app-shell";
import { BackButton } from "@/components/backevent/buttons";
import { Button, ButtonLink, Notice, StatusPill } from "@/components/backevent/ui";
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

export default function NotificationMessagePage() {
  const params = useParams<{ messageId: string }>();
  const messageId = params.messageId;
  const [message, setMessage] = useState<PushMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadMessage() {
      try {
        setLoading(true);
        setError(null);
        const token = await getAccessToken();
        const response = await fetch(`/api/push/messages/${messageId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = (await response.json()) as { ok?: boolean; message?: PushMessage | string };

        if (!response.ok || !data.ok || typeof data.message === "string") {
          throw new Error(typeof data.message === "string" ? data.message : "Kunne ikke hente besked");
        }

        if (mounted) {
          setMessage(data.message ?? null);
        }

        if (data.message?.unread) {
          await markAsRead();
        }
      } catch (caught) {
        if (mounted) {
          setError(caught instanceof Error ? caught.message : "Kunne ikke hente besked.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadMessage();

    return () => {
      mounted = false;
    };
    // markAsRead intentionally uses current messageId and should run only as part of initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  async function markAsRead() {
    try {
      setSaving(true);
      const token = await getAccessToken();
      const response = await fetch(`/api/push/messages/${messageId}`, {
        method: "PATCH",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as { ok?: boolean; message?: PushMessage | string };

      if (!response.ok || !data.ok || typeof data.message === "string") {
        throw new Error(typeof data.message === "string" ? data.message : "Kunne ikke markere besked som læst");
      }

      setMessage(data.message ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kunne ikke markere besked som læst.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5">
        <BackButton href="/notifikationer" />
      </div>

      {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}

      <section className="rounded-2xl border border-line bg-macro p-5 shadow-sm">
        {loading ? (
          <p className="rounded-2xl bg-soft px-4 py-3 text-sm font-bold text-muted">Henter besked...</p>
        ) : message ? (
          <>
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
                <Bell className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusPill tone={message.readAt ? "success" : "pending"}>{message.readAt ? "Læst" : "Ulæst"}</StatusPill>
                  <span className="text-sm font-bold text-muted">{message.senderName ?? "BackEvent"}</span>
                </div>
                <h1 className="text-3xl font-bold text-ink">{message.title}</h1>
                <p className="mt-2 text-sm font-bold text-muted">{new Date(message.createdAt).toLocaleString("da-DK")}</p>
              </div>
            </div>

            <p className="whitespace-pre-wrap rounded-2xl bg-soft p-4 text-lg font-medium leading-relaxed text-ink">{message.body}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {!message.readAt ? (
                <Button type="button" onClick={markAsRead} disabled={saving}>
                  <Check className="h-5 w-5" aria-hidden />
                  {saving ? "Gemmer..." : "Marker som læst"}
                </Button>
              ) : null}
              <ButtonLink href="/notifikationer" tone="secondary">
                Til indbakke
              </ButtonLink>
            </div>
          </>
        ) : (
          <div className="text-center">
            <h1 className="text-3xl font-bold text-ink">Besked findes ikke</h1>
            <p className="mt-2 text-sm font-medium text-muted">Den kan være slettet eller høre til en anden bruger.</p>
            <Link href="/notifikationer" className="mt-5 inline-flex font-bold text-pantone140">
              Gå til indbakke
            </Link>
          </div>
        )}
      </section>
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

