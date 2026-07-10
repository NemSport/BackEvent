import { NextResponse } from "next/server";
import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

const ALERT_GROUP_NAME = "Lageransvarlige";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  tracking_mode: string | null;
  active: boolean | null;
};

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  active: boolean | null;
};

type BalanceRow = {
  product_id: string;
  location_id: string;
  quantity: number | string | null;
};

type AlertSettingRow = {
  id: string;
  inventory_item_id: string;
  location_id: string | null;
  low_threshold: number | string | null;
  critical_threshold: number | string | null;
  active: boolean | null;
};

type AlertLevel = "low" | "critical";

type Alert = {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  unit: string;
  stockValue: number;
  alertLevel: AlertLevel;
  threshold: number;
  skippedReason?: string;
};

type GroupRow = {
  id: string;
  name: string;
  active: boolean;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  active: boolean;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({
      ok: true,
      checkedItems: 0,
      lowCount: 0,
      criticalCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      alerts: [],
      message: "Mock mode: lageralarm simuleret uden afsendelse",
    });
  }

  let group: GroupRow;
  let alerts: Alert[];

  try {
    group = await ensureAlertGroup(auth.supabase);
    alerts = await calculateAlerts(auth.supabase);
  } catch {
    return NextResponse.json({ ok: false, message: "Kunne ikke beregne lageralarmer" }, { status: 500 });
  }

  const lowCount = alerts.filter((alert) => alert.alertLevel === "low").length;
  const criticalCount = alerts.filter((alert) => alert.alertLevel === "critical").length;
  const sendableAlerts: Alert[] = [];
  const now = new Date();
  let skippedCount = 0;

  for (const alert of alerts) {
    const canSend = await shouldSendAlert(auth.supabase, alert, now);
    if (canSend) {
      sendableAlerts.push(alert);
    } else {
      skippedCount += 1;
      alert.skippedReason = "Sendt inden for 6 timer";
    }
  }

  let members: ProfileRow[] = [];
  let subscriptions: PushSubscriptionRow[] = [];

  try {
    members = await getActiveGroupMembers(auth.supabase, group.id);
    subscriptions = members.length > 0 ? await getActiveSubscriptions(auth.supabase, members.map((member) => member.id)) : [];
  } catch {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente Lageransvarlige" }, { status: 500 });
  }

  const membersWithSubscriptions = new Set(subscriptions.map((subscription) => subscription.user_id));
  let sentCount = 0;
  let failedCount = 0;

  for (const member of members) {
    if (!membersWithSubscriptions.has(member.id) && sendableAlerts.length > 0) {
      skippedCount += 1;
      await createPushLog(auth.supabase, {
        member,
        groupId: group.id,
        title: "Lageralarm",
        body: "Ingen aktiv push-enhed",
        status: "skipped",
        errorMessage: "Ingen aktiv push-enhed",
      });
    }
  }

  if (sendableAlerts.length > 0 && subscriptions.length > 0) {
    if (!isWebPushConfigured()) {
      skippedCount += subscriptions.length;
      for (const member of members) {
        await createPushLog(auth.supabase, {
          member,
          groupId: group.id,
          title: "Lageralarm",
          body: "Push er ikke konfigureret endnu",
          status: "skipped",
          errorMessage: "Push er ikke konfigureret endnu",
        });
      }
    } else {
      webPush.setVapidDetails(process.env.WEB_PUSH_SUBJECT!, getPublicVapidKey()!, process.env.WEB_PUSH_PRIVATE_KEY!);
      const payload = buildPayload(sendableAlerts);

      for (const subscription of subscriptions) {
        const member = members.find((item) => item.id === subscription.user_id) ?? null;

        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify(payload),
          );
          sentCount += 1;
          await createPushLog(auth.supabase, {
            member,
            groupId: group.id,
            title: payload.title,
            body: payload.body,
            status: "sent",
            errorMessage: null,
          });
        } catch (error) {
          failedCount += 1;
          const errorMessage = safeErrorMessage(error);
          if (isExpiredSubscription(error)) {
            await auth.supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
          }
          await createPushLog(auth.supabase, {
            member,
            groupId: group.id,
            title: payload.title,
            body: payload.body,
            status: "failed",
            errorMessage,
          });
        }
      }

      if (sentCount > 0) {
        for (const alert of sendableAlerts) {
          await updateAlertState(auth.supabase, alert, now);
        }
      }
    }
  }

  return NextResponse.json({
    ok: failedCount === 0,
    checkedItems: alerts.length,
    lowCount,
    criticalCount,
    sentCount,
    skippedCount,
    failedCount,
    alerts,
    groupId: group.id,
    groupName: group.name,
    memberCount: members.length,
    subscriptionCount: subscriptions.length,
  });
}

async function ensureAlertGroup(supabase: SupabaseClient): Promise<GroupRow> {
  const { data: existing, error: readError } = await supabase
    .from("backevent_member_groups")
    .select("id,name,active")
    .ilike("name", ALERT_GROUP_NAME)
    .limit(1)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existing) {
    if (!existing.active) {
      const { error } = await supabase.from("backevent_member_groups").update({ active: true }).eq("id", existing.id);
      if (error) throw error;
    }

    return { id: existing.id, name: existing.name, active: true };
  }

  const { data, error } = await supabase
    .from("backevent_member_groups")
    .insert({ name: ALERT_GROUP_NAME, description: "Modtagere af lageralarmer", active: true })
    .select("id,name,active")
    .single();

  if (error) {
    throw error;
  }

  return data as GroupRow;
}

async function calculateAlerts(supabase: SupabaseClient): Promise<Alert[]> {
  const [productsResponse, locationsResponse, balancesResponse, settingsResponse] = await Promise.all([
    supabase.from("backevent_products").select("id,name,unit,tracking_mode,active").eq("active", true).eq("tracking_mode", "inventory"),
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true),
    supabase.from("backevent_stock_balances").select("product_id,location_id,quantity"),
    supabase
      .from("backevent_inventory_alert_settings")
      .select("id,inventory_item_id,location_id,low_threshold,critical_threshold,active")
      .eq("active", true),
  ]);

  if (productsResponse.error || locationsResponse.error || balancesResponse.error || settingsResponse.error) {
    throw productsResponse.error ?? locationsResponse.error ?? balancesResponse.error ?? settingsResponse.error;
  }

  const products = ((productsResponse.data ?? []) as ProductRow[]).filter((product) => product.active !== false);
  const locations = ((locationsResponse.data ?? []) as LocationRow[]).filter((location) => location.active !== false && location.type === "container");
  const balances = (balancesResponse.data ?? []) as BalanceRow[];
  const settings = (settingsResponse.data ?? []) as AlertSettingRow[];
  const alerts: Alert[] = [];

  for (const balance of balances) {
    const product = products.find((item) => item.id === balance.product_id);
    const location = locations.find((item) => item.id === balance.location_id);

    if (!product || !location) {
      continue;
    }

    const setting = findSetting(settings, product.id, location.id);
    if (!setting) {
      await clearAlertState(supabase, product.id, location.id);
      continue;
    }

    const stockValue = Number(balance.quantity ?? 0);
    const criticalThreshold = numberOrNull(setting.critical_threshold);
    const lowThreshold = numberOrNull(setting.low_threshold);
    const alertLevel = criticalThreshold !== null && stockValue <= criticalThreshold ? "critical" : lowThreshold !== null && stockValue <= lowThreshold ? "low" : null;

    if (!alertLevel) {
      await clearAlertState(supabase, product.id, location.id);
      continue;
    }

    alerts.push({
      productId: product.id,
      productName: product.name,
      locationId: location.id,
      locationName: location.name,
      unit: product.unit ?? "kasser",
      stockValue,
      alertLevel,
      threshold: alertLevel === "critical" ? criticalThreshold ?? 0 : lowThreshold ?? 0,
    });
  }

  return alerts;
}

function findSetting(settings: AlertSettingRow[], productId: string, locationId: string) {
  return (
    settings.find((setting) => setting.inventory_item_id === productId && setting.location_id === locationId) ??
    settings.find((setting) => setting.inventory_item_id === productId && !setting.location_id) ??
    null
  );
}

async function shouldSendAlert(supabase: SupabaseClient, alert: Alert, now: Date) {
  const query = supabase
    .from("backevent_inventory_alert_state")
    .select("id,last_sent_at,last_stock_value")
    .eq("inventory_item_id", alert.productId)
    .eq("alert_level", alert.alertLevel)
    .limit(1);

  const { data, error } = await query.eq("location_id", alert.locationId).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.last_sent_at) {
    return true;
  }

  return now.getTime() - new Date(data.last_sent_at).getTime() >= SIX_HOURS_MS;
}

async function updateAlertState(supabase: SupabaseClient, alert: Alert, now: Date) {
  const { data: existing, error } = await supabase
    .from("backevent_inventory_alert_state")
    .select("id")
    .eq("inventory_item_id", alert.productId)
    .eq("location_id", alert.locationId)
    .eq("alert_level", alert.alertLevel)
    .maybeSingle();

  if (error) throw error;

  if (existing?.id) {
    await supabase
      .from("backevent_inventory_alert_state")
      .update({
        last_sent_at: now.toISOString(),
        last_stock_value: alert.stockValue,
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  await supabase.from("backevent_inventory_alert_state").insert({
    inventory_item_id: alert.productId,
    location_id: alert.locationId,
    alert_level: alert.alertLevel,
    last_sent_at: now.toISOString(),
    last_stock_value: alert.stockValue,
  });
}

async function clearAlertState(supabase: SupabaseClient, productId: string, locationId: string) {
  await supabase
    .from("backevent_inventory_alert_state")
    .delete()
    .eq("inventory_item_id", productId)
    .eq("location_id", locationId);
}

async function getActiveGroupMembers(supabase: SupabaseClient, groupId: string) {
  const { data: memberships, error: membershipsError } = await supabase
    .from("backevent_member_group_members")
    .select("profile_id")
    .eq("group_id", groupId);

  if (membershipsError) {
    throw membershipsError;
  }

  const profileIds = Array.from(new Set((memberships ?? []).map((membership) => membership.profile_id as string).filter(Boolean)));

  if (profileIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("backevent_profiles")
    .select("id,email,full_name,active")
    .in("id", profileIds)
    .eq("active", true);

  if (profilesError) {
    throw profilesError;
  }

  return (profiles ?? []) as ProfileRow[];
}

async function getActiveSubscriptions(supabase: SupabaseClient, userIds: string[]) {
  const { data, error } = await supabase
    .from("backevent_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .eq("active", true);

  if (error) {
    throw error;
  }

  return (data ?? []) as PushSubscriptionRow[];
}

async function createPushLog(
  supabase: SupabaseClient,
  input: {
    member: ProfileRow | null;
    groupId: string;
    title: string;
    body: string;
    status: "sent" | "failed" | "skipped";
    errorMessage: string | null;
  },
) {
  await supabase.from("backevent_push_logs").insert({
    recipient_user_id: input.member?.id ?? null,
    recipient_email: input.member?.email ?? null,
    group_id: input.groupId,
    title: input.title,
    body: input.body,
    status: input.status,
    error_message: input.errorMessage,
  });
}

function buildPayload(alerts: Alert[]) {
  const criticalCount = alerts.filter((alert) => alert.alertLevel === "critical").length;
  const lowCount = alerts.filter((alert) => alert.alertLevel === "low").length;
  const firstAlert = alerts[0];
  const title = criticalCount > 0 ? "Kritisk lageralarm" : "Lavt lager";
  const body =
    alerts.length === 1 && firstAlert
      ? `${firstAlert.productName} i ${firstAlert.locationName}: ${formatNumber(firstAlert.stockValue)} ${firstAlert.unit}`
      : `${criticalCount} kritiske og ${lowCount} lave lageralarmer`;

  return {
    title,
    body,
    url: "/lagerstatus",
  };
}

function isWebPushConfigured() {
  return Boolean(getPublicVapidKey() && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT);
}

function getPublicVapidKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

function isExpiredSubscription(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode = "statusCode" in error ? Number(error.statusCode) : null;
  return statusCode === 404 || statusCode === 410;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Push kunne ikke sendes";
}

function numberOrNull(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toLocaleString("da-DK", { maximumFractionDigits: 1 });
}
