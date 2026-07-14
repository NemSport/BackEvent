import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";

export async function POST(request: Request, context: { params: Promise<{ returnId: string }> }) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  if (!auth.canControl || !auth.supabase) return NextResponse.json({ ok: false, message: "Kun ejer kan gøre dette" }, { status: 403 });

  const { returnId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: string; note?: string };
  const reviewed = body.action !== "reopen";
  const { error } = await auth.supabase
    .from("backevent_returns")
    .update({ control_status: reviewed ? "reviewed" : "open" })
    .eq("id", returnId);

  if (error) return NextResponse.json({ ok: false, message: "Retur kunne ikke opdateres" }, { status: 500 });

  await auth.supabase.from("backevent_return_history").insert({
    return_id: returnId,
    action: reviewed ? "marked_reviewed" : "reopened",
    actor_user_id: auth.userId,
    actor_name: auth.userEmail,
    metadata: { note: body.note ?? null },
  });

  return NextResponse.json({ ok: true });
}
