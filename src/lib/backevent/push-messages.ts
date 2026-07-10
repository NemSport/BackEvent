import type { SupabaseClient } from "@supabase/supabase-js";

export type PushMessageCategory = "general" | "group" | "inventory_alert" | "test";

export type PushMessageInput = {
  recipientUserId: string;
  recipientEmail?: string | null;
  senderUserId?: string | null;
  senderName?: string | null;
  groupId?: string | null;
  title: string;
  body: string;
  targetUrl?: string;
  category?: PushMessageCategory;
};

export async function createPushMessage(supabase: SupabaseClient, input: PushMessageInput) {
  const id = crypto.randomUUID();
  const targetUrl = input.targetUrl ?? "/notifikationer";
  const { error } = await supabase
    .from("backevent_push_messages")
    .insert({
      id,
      recipient_user_id: input.recipientUserId,
      recipient_email: input.recipientEmail ?? null,
      sender_user_id: input.senderUserId ?? null,
      sender_name: input.senderName ?? null,
      group_id: input.groupId ?? null,
      title: input.title,
      body: input.body,
      target_url: targetUrl,
      category: input.category ?? "general",
    });

  if (error) {
    throw error;
  }

  return {
    id,
    targetUrl,
  };
}

export function buildMessageUrl(messageId: string | null | undefined) {
  return messageId ? `/notifikationer/${messageId}` : "/notifikationer";
}

export function pushPayload(input: { title: string; body: string; messageId?: string | null; url?: string | null }) {
  return {
    title: input.title,
    body: input.body,
    messageId: input.messageId ?? null,
    url: input.url ?? buildMessageUrl(input.messageId),
  };
}

export function isOperationalGroupName(groupName: string) {
  const normalized = groupName.toLowerCase();
  return ["lager", "bar", "drift", "hold", "ansvarlig"].some((part) => normalized.includes(part));
}
