import webPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMessageUrl, createPushMessage, pushPayload } from "./push-messages";

const ALERT_GROUP_NAME = "Lageransvarlige";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export type InventoryAlertRunType = "manual" | "cron";
export type InventoryAlertRunStatus = "success" | "partial" | "failed" | "skipped";
export type AlertLevel = "low" | "critical";

export type InventoryAlert = {
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

export type InventoryAlertRunResult = {
  ok: boolean;
  checkedItems: number;
  lowCount: number;
  criticalCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  suppressedCount: number;
  alerts: InventoryAlert[];
  groupId?: string;
  groupName?: string;
  memberCount?: number;
  subscriptionCount?: number;
  runStatus: InventoryAlertRunStatus;
  message?: string;
};

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
  product_id: string;
  location_id: string;
  low_threshold: number | string | null;
  critical_threshold: number | string | null;
  alerts_enabled: boolean | null;
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

type CalculatedAlerts = {
  checkedItems: number;
  alerts: InventoryAlert[];
};

export async function runInventoryAlerts(
  supabase: SupabaseClient,
  options: { runType: InventoryAlertRunType },
): Promise<InventoryAlertRunResult> {
  const now = new Date();

  try {
    const group = await ensureAlertGroup(supabase);
    const calculated = await calculateAlerts(supabase);
    const lowCount = calculated.alerts.filter((alert) => alert.alertLevel === "low").length;
    const criticalCount = calculated.alerts.filter((alert) => alert.alertLevel === "critical").length;
    const sendableAlerts: InventoryAlert[] = [];
    let skippedCount = 0;
    let suppressedCount = 0;

    for (const alert of calculated.alerts) {
      const canSend = await shouldSendAlert(supabase, alert, now);
      if (canSend) {
        sendableAlerts.push(alert);
      } else {
        skippedCount += 1;
        suppressedCount += 1;
        alert.skippedReason = "Sendt inden for 6 timer";
      }
    }

    const members = await getActiveGroupMembers(supabase, group.id);
    const subscriptions = members.length > 0 ? await getActiveSubscriptions(supabase, members.map((member) => member.id)) : [];
    const membersWithSubscriptions = new Set(subscriptions.map((subscription) => subscription.user_id));
    const payload = buildPayload(sendableAlerts);
    const memberMessageIds = new Map<string, string>();
    let sentCount = 0;
    let failedCount = 0;

    if (sendableAlerts.length > 0) {
      for (const member of members) {
        const message = await createPushMessage(supabase, {
          recipientUserId: member.id,
          recipientEmail: member.email,
          senderName: "BackEvent",
          groupId: group.id,
          title: payload.title,
          body: payload.body,
          targetUrl: "/lagerstatus",
          category: "inventory_alert",
        });
        memberMessageIds.set(member.id, message.id);
      }
    }

    for (const member of members) {
      if (!membersWithSubscriptions.has(member.id) && sendableAlerts.length > 0) {
        skippedCount += 1;
        await createPushLog(supabase, {
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
          await createPushLog(supabase, {
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

        for (const subscription of subscriptions) {
          const member = members.find((item) => item.id === subscription.user_id) ?? null;
          const messageId = member ? memberMessageIds.get(member.id) ?? null : null;

          try {
            await webPush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth,
              },
            },
              JSON.stringify(pushPayload({
                title: payload.title,
                body: payload.body,
                messageId,
                url: buildMessageUrl(messageId),
              })),
            );
            sentCount += 1;
            await createPushLog(supabase, {
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
              await supabase.from("backevent_push_subscriptions").update({ active: false }).eq("id", subscription.id);
            }
            await createPushLog(supabase, {
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
            await updateAlertState(supabase, alert, now);
          }
        }
      }
    }

    const runStatus = getRunStatus({ sendableAlerts, sentCount, failedCount, skippedCount });
    const result: InventoryAlertRunResult = {
      ok: failedCount === 0,
      checkedItems: calculated.checkedItems,
      lowCount,
      criticalCount,
      sentCount,
      skippedCount,
      failedCount,
      suppressedCount,
      alerts: calculated.alerts,
      groupId: group.id,
      groupName: group.name,
      memberCount: members.length,
      subscriptionCount: subscriptions.length,
      runStatus,
      message: buildRunMessage(runStatus),
    };

    await createRunLog(supabase, options.runType, result);
    return result;
  } catch (error) {
    const result: InventoryAlertRunResult = {
      ok: false,
      checkedItems: 0,
      lowCount: 0,
      criticalCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      suppressedCount: 0,
      alerts: [],
      runStatus: "failed",
      message: safeErrorMessage(error),
    };

    await createRunLog(supabase, options.runType, result).catch(() => undefined);
    return result;
  }
}

export async function getLatestInventoryAlertRun(supabase: SupabaseClient, runType?: InventoryAlertRunType) {
  let query = supabase
    .from("backevent_inventory_alert_runs")
    .select("id,run_type,status,checked_items,sent_alerts,suppressed_alerts,failed_count,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (runType) {
    query = query.eq("run_type", runType);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? {
        id: data.id,
        runType: data.run_type as InventoryAlertRunType,
        status: data.status as InventoryAlertRunStatus,
        checkedItems: data.checked_items,
        sentAlerts: data.sent_alerts,
        suppressedAlerts: data.suppressed_alerts,
        failedCount: data.failed_count,
        errorMessage: data.error_message,
        createdAt: data.created_at,
      }
    : null;
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

async function calculateAlerts(supabase: SupabaseClient): Promise<CalculatedAlerts> {
  const [productsResponse, locationsResponse, balancesResponse, settingsResponse] = await Promise.all([
    supabase.from("backevent_products").select("id,name,unit,tracking_mode,active").eq("active", true).eq("tracking_mode", "inventory"),
    supabase.from("backevent_locations").select("id,name,type,active").eq("active", true),
    supabase.from("backevent_stock_balances").select("product_id,location_id,quantity"),
    supabase
      .from("backevent_location_product_thresholds")
      .select("id,product_id,location_id,low_threshold,critical_threshold,alerts_enabled")
      .eq("alerts_enabled", true),
  ]);

  if (productsResponse.error || locationsResponse.error || balancesResponse.error || settingsResponse.error) {
    throw productsResponse.error ?? locationsResponse.error ?? balancesResponse.error ?? settingsResponse.error;
  }

  const products = ((productsResponse.data ?? []) as ProductRow[]).filter((product) => product.active !== false);
  const locations = ((locationsResponse.data ?? []) as LocationRow[]).filter((location) => location.active !== false && location.type === "container");
  const balances = (balancesResponse.data ?? []) as BalanceRow[];
  const settings = (settingsResponse.data ?? []) as AlertSettingRow[];
  const alerts: InventoryAlert[] = [];
  let checkedItems = 0;

  for (const balance of balances) {
    const product = products.find((item) => item.id === balance.product_id);
    const location = locations.find((item) => item.id === balance.location_id);

    if (!product || !location) {
      continue;
    }

    checkedItems += 1;
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

  return { checkedItems, alerts };
}

function findSetting(settings: AlertSettingRow[], productId: string, locationId: string) {
  return settings.find((setting) => setting.product_id === productId && setting.location_id === locationId) ?? null;
}

async function shouldSendAlert(supabase: SupabaseClient, alert: InventoryAlert, now: Date) {
  const { data, error } = await supabase
    .from("backevent_inventory_alert_state")
    .select("id,last_sent_at,last_stock_value")
    .eq("inventory_item_id", alert.productId)
    .eq("location_id", alert.locationId)
    .eq("alert_level", alert.alertLevel)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.last_sent_at) {
    return true;
  }

  return now.getTime() - new Date(data.last_sent_at).getTime() >= SIX_HOURS_MS;
}

async function updateAlertState(supabase: SupabaseClient, alert: InventoryAlert, now: Date) {
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

async function createRunLog(supabase: SupabaseClient, runType: InventoryAlertRunType, result: InventoryAlertRunResult) {
  await supabase.from("backevent_inventory_alert_runs").insert({
    run_type: runType,
    status: result.runStatus,
    checked_items: result.checkedItems,
    sent_alerts: result.sentCount,
    suppressed_alerts: result.suppressedCount,
    failed_count: result.failedCount,
    error_message: result.runStatus === "failed" || result.runStatus === "partial" ? result.message ?? null : null,
  });
}

function buildPayload(alerts: InventoryAlert[]) {
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

function getRunStatus(input: { sendableAlerts: InventoryAlert[]; sentCount: number; failedCount: number; skippedCount: number }): InventoryAlertRunStatus {
  if (input.failedCount > 0 && input.sentCount > 0) {
    return "partial";
  }

  if (input.failedCount > 0) {
    return "failed";
  }

  if (input.sendableAlerts.length === 0 && input.skippedCount > 0) {
    return "skipped";
  }

  return "success";
}

function buildRunMessage(status: InventoryAlertRunStatus) {
  if (status === "partial") return "Lageralarm delvist sendt";
  if (status === "failed") return "Lageralarm fejlede";
  if (status === "skipped") return "Lageralarm undertrykt";
  return "Lageralarm kørt";
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
