"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Notice } from "./ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PromptState = "checking" | "hidden" | "ready" | "denied" | "busy";

export function PushOnboardingPrompt() {
  const [state, setState] = useState<PromptState>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let mounted = true;

    async function check() {
      if (typeof window === "undefined" || sessionStorage.getItem("backevent-push-not-now") === "1") {
        setState("hidden");
        return;
      }

      if (!isPushSupported()) {
        setState("hidden");
        return;
      }

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      const token = await getAccessToken();
      const response = await fetch("/api/push/subscribe", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }).catch(() => null);
      const data = response ? ((await response.json().catch(() => null)) as { ok?: boolean; activeCount?: number } | null) : null;

      if (!mounted) {
        return;
      }

      setState(data?.ok && (data.activeCount ?? 0) > 0 ? "hidden" : "ready");
    }

    const timer = window.setTimeout(() => {
      void check();
    }, 500);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function activate() {
    try {
      setState("busy");
      setMessage(null);

      if (!isPushSupported()) {
        setState("hidden");
        return;
      }

      if (!publicKey) {
        setMessage("Push er ikke konfigureret endnu.");
        setState("ready");
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission === "denied") {
        setState("denied");
        return;
      }

      if (permission !== "granted") {
        setState("ready");
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
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message ?? "Kunne ikke aktivere notifikationer");
      }

      setState("hidden");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kunne ikke aktivere notifikationer.");
      setState("ready");
    }
  }

  function skip() {
    sessionStorage.setItem("backevent-push-not-now", "1");
    setState("hidden");
  }

  if (state === "checking" || state === "hidden") {
    return null;
  }

  if (state === "denied") {
    return (
      <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-2xl border border-line bg-macro p-4 shadow-soft md:bottom-4">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warmRed/10 text-warmRed">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-bold text-ink">Notifikationer er blokeret</p>
            <p className="mt-1 text-sm font-medium text-muted">Åbn browserens indstillinger for siden, hvis du vil modtage beskeder fra BackEvent.</p>
            <button type="button" onClick={skip} className="mt-3 text-sm font-bold text-pantone140">
              Luk
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-2xl border border-line bg-macro p-4 shadow-soft md:bottom-4">
      <div className="mb-3 flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pantone139/30 text-pantone140">
          <Bell className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="font-bold text-ink">Få besked på denne enhed</p>
          <p className="mt-1 text-sm font-medium text-muted">BackEvent kan sende vigtige beskeder og lageralarmer.</p>
        </div>
      </div>
      {message ? <Notice tone="danger" className="mb-3">{message}</Notice> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" onClick={activate} disabled={state === "busy"}>
          {state === "busy" ? "Aktiverer..." : "Tillad notifikationer"}
        </Button>
        <Button type="button" tone="secondary" onClick={skip} disabled={state === "busy"}>
          Ikke nu
        </Button>
      </div>
    </div>
  );
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

