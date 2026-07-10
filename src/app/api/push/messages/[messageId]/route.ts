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

export async function GET(request: Request, context: { params: Promise<{ messageId: string }> }) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { messageId } = await context.params;

  if (!auth.supabase) {
    return NextResponse.json({ ok: false, message: "Besked findes ikke" }, { status: 404 });
  }

  const { data, error } = await auth.supabase
    .from("backevent_push_messages")
    .select("id,recipient_user_id,recipient_email,sender_name,group_id,title,body,target_url,category,read_at,deleted_at,created_at")
    .eq("recipient_user_id", auth.userId)
    .eq("id", messageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente besked" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Besked findes ikke" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: toMessage(data as PushMessageRow) });
}

export async function PATCH(request: Request, context: { params: Promise<{ messageId: string }> }) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { messageId } = await context.params;

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, message: null });
  }

  const { data, error } = await auth.supabase
    .from("backevent_push_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", auth.userId)
    .eq("id", messageId)
    .is("deleted_at", null)
    .select("id,recipient_user_id,recipient_email,sender_name,group_id,title,body,target_url,category,read_at,deleted_at,created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke markere besked som læst" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Besked findes ikke" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: toMessage(data as PushMessageRow) });
}

export async function DELETE(request: Request, context: { params: Promise<{ messageId: string }> }) {
  const auth = await requireBackEventRole(request, "frivillig");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { messageId } = await context.params;

  if (!auth.supabase) {
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await auth.supabase
    .from("backevent_push_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("recipient_user_id", auth.userId)
    .eq("id", messageId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke slette besked" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, message: "Besked findes ikke" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
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
