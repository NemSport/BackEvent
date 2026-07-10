"use client";

import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { NotificationSettingsCard } from "@/components/backevent/notification-settings-card";

export default function AdminNotificationsPage() {
  return (
    <AppShell requiredRole="ansvarlig">
      <Header title="Notifikationer" subtitle="Aktivér push-notifikationer på denne enhed" />

      <section className="max-w-3xl">
        <NotificationSettingsCard />
      </section>
    </AppShell>
  );
}
