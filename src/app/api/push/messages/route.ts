import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type PushMessageRow = {
  id: string;
  recipient_user_id: string;
  recipient_email: string | null;
  sender_name: string | null;
  group_id: string | null;
  title: string;
  body: string;
  target_url: string;
  category: string;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, unreadCount: 0, messages: [] });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100);

  const [messagesResponse, unreadResponse] = await Promise.all([
    auth.supabase
      .from("backevent_push_messages")
      .select("id,recipient_user_id,recipient_email,sender_name,group_id,title,body,target_url,category,read_at,deleted_at,created_at")
      .eq("recipient_user_id", auth.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("backevent_push_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", auth.userId)
      .is("deleted_at", null)
      .is("read_at", null),
  ]);

  if (messagesResponse.error || unreadResponse.error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente beskeder" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    unreadCount: unreadResponse.count ?? 0,
    messages: ((messagesResponse.data ?? []) as PushMessageRow[]).map(toMessage),
  });
}

function toMessage(row: PushMessageRow) {
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email,
    senderName: row.sender_name,
    groupId: row.group_id,
    title: row.title,
    body: row.body,
    targetUrl: row.target_url,
    category: row.category,
    readAt: row.read_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    unread: !row.read_at,
  };
}
