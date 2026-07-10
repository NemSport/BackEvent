"use client";

import { Bell, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PushStatus = "checking" | "unsupported" | "not_enabled" | "denied" | "subscribed";

export function NotificationSettingsCard() {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    async function checkStatus() {
      if (!isPushSupported()) {
        setStatus("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();

      setEndpoint(subscription?.endpoint ?? null);
      setStatus(subscription ? "subscribed" : "not_enabled");
    }

    const timer = window.setTimeout(() => {
      void checkStatus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function activateNotifications() {
    try {
      setBusy(true);
      setMessage(null);

      if (!isPushSupported()) {
        setStatus("unsupported");
        return;
      }

      if (!publicKey) {
        setMessage("Push public key mangler.");
        setStatus("not_enabled");
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission === "denied") {
        setStatus("denied");
        setMessage("Notifikationer er blokeret i browseren.");
        return;
      }

      if (permission !== "granted") {
        setStatus("not_enabled");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const token = await getAccessToken();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Kunne ikke aktivere notifikationer");
      }

      setEndpoint(subscription.endpoint);
      setStatus("subscribed");
      setMessage(data.message ?? "Notifikationer er aktiveret.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kunne ikke aktivere notifikationer.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestNotification() {
    try {
      setBusy(true);
      setMessage(null);
      const token = await getAccessToken();
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ endpoint }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string; sent?: number; failed?: number };

      setMessage(data.message ?? `Sendt: ${data.sent ?? 0}. Fejlet: ${data.failed ?? 0}.`);
    } catch {
      setMessage("Testnotifikation kunne ikke sendes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-macro p-4 shadow-soft">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
          <Bell className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-bold text-ink">Notifikationer</h2>
          <p className="text-sm font-medium text-muted">{statusText(status)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={activateNotifications}
          disabled={busy || status === "unsupported" || status === "denied"}
          className="rounded-xl bg-pantone139 px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"
        >
          Aktivér notifikationer
        </button>
        <button
          type="button"
          onClick={sendTestNotification}
          disabled={busy || status !== "subscribed"}
          className="inline-flex items-center gap-2 rounded-xl bg-soft px-4 py-2 text-sm font-bold text-pantone140 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden />
          Send testnotifikation
        </button>
      </div>

      {message ? <p className="mt-3 text-sm font-bold text-muted">{message}</p> : null}
    </section>
  );
}

function statusText(status: PushStatus) {
  switch (status) {
    case "checking":
      return "Tjekker status...";
    case "unsupported":
      return "Denne browser understøtter ikke push-notifikationer.";
    case "denied":
      return "Notifikationer er blokeret i browseren.";
    case "subscribed":
      return "Denne enhed er klar til notifikationer.";
    default:
      return "Aktivér for at modtage BackEvent-notifikationer senere.";
  }
}

function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
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
