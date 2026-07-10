import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailCategories, messageToEmailHtml, sendBackEventEmail, type BackEventEmailCategory } from "@/lib/backevent/email";
import { requireBackEventRole } from "@/lib/backevent/server-auth";

type SendEmailBody = {
  recipients?: unknown;
  subject?: unknown;
  message?: unknown;
  category?: unknown;
};

type EmailLogRow = {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  category: BackEventEmailCategory;
  status: "pending" | "sent" | "failed";
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  if (!auth.supabase) {
    return NextResponse.json({ ok: true, logs: [] });
  }

  const { data, error } = await auth.supabase
    .from("backevent_email_logs")
    .select("id,recipient_email,recipient_name,subject,category,status,error_message,sent_at,created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente email-log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, logs: data.map(toEmailLog) });
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");

  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as SendEmailBody | null;
  const validation = validateBody(body);

  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  const { recipients, subject, message, category } = validation;
  let sent = 0;
  let failed = 0;
  const results: Array<{ recipient: string; status: "sent" | "failed"; errorMessage: string | null }> = [];

  for (const recipient of recipients) {
    let logId: string | null = null;

    try {
      logId = await createEmailLog(auth.supabase, {
        recipientEmail: recipient,
        subject,
        category,
      });

      await sendBackEventEmail({
        to: recipient,
        subject,
        text: message,
        html: messageToEmailHtml(message),
        category,
      });

      sent += 1;
      results.push({ recipient, status: "sent", errorMessage: null });
      await updateEmailLog(auth.supabase, logId, { status: "sent", errorMessage: null });
    } catch (error) {
      const errorMessage = safeErrorMessage(error);
      failed += 1;
      results.push({ recipient, status: "failed", errorMessage });
      await updateEmailLog(auth.supabase, logId, { status: "failed", errorMessage });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    sent,
    failed,
    results,
  });
}

function validateBody(body: SendEmailBody | null):
  | { ok: false; message: string }
  | { ok: true; recipients: string[]; subject: string; message: string; category: "general_message" } {
  if (!body) {
    return { ok: false, message: "Ugyldig forespørgsel" };
  }

  if (!Array.isArray(body.recipients)) {
    return { ok: false, message: "Vælg mindst én modtager" };
  }

  const recipients = Array.from(
    new Set(body.recipients.filter((recipient): recipient is string => typeof recipient === "string").map((recipient) => recipient.trim().toLowerCase())),
  ).filter(Boolean);

  if (recipients.length === 0) {
    return { ok: false, message: "Vælg mindst én modtager" };
  }

  if (recipients.length > 100) {
    return { ok: false, message: "Vælg højst 100 modtagere ad gangen" };
  }

  if (recipients.some((recipient) => !isValidEmail(recipient))) {
    return { ok: false, message: "En eller flere emailadresser er ugyldige" };
  }

  if (typeof body.subject !== "string" || body.subject.trim().length < 2) {
    return { ok: false, message: "Udfyld emne" };
  }

  if (typeof body.message !== "string" || body.message.trim().length < 2) {
    return { ok: false, message: "Udfyld besked" };
  }

  if (body.category !== "general_message" || !emailCategories.includes(body.category)) {
    return { ok: false, message: "Ukendt email-kategori" };
  }

  return {
    ok: true,
    recipients,
    subject: body.subject.trim().slice(0, 200),
    message: body.message.trim(),
    category: "general_message",
  };
}

async function createEmailLog(
  supabase: SupabaseClient | null,
  input: { recipientEmail: string; subject: string; category: BackEventEmailCategory },
) {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("backevent_email_logs")
    .insert({
      recipient_email: input.recipientEmail,
      subject: input.subject,
      category: input.category,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error("Email-log kunne ikke oprettes");
  }

  return data.id as string;
}

async function updateEmailLog(
  supabase: SupabaseClient | null,
  logId: string | null,
  input: { status: "sent" | "failed"; errorMessage: string | null },
) {
  if (!supabase || !logId) {
    return;
  }

  await supabase
    .from("backevent_email_logs")
    .update({
      status: input.status,
      error_message: input.errorMessage,
      sent_at: input.status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", logId);
}

function toEmailLog(row: EmailLogRow) {
  return {
    id: row.id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    subject: row.subject,
    category: row.category,
    status: row.status,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Email kunne ikke sendes";
}
