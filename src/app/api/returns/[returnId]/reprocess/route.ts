import { NextResponse } from "next/server";
import { requireReturnAccess } from "@/lib/backevent/return-access";

export async function POST(request: Request, context: { params: Promise<{ returnId: string }> }) {
  const auth = await requireReturnAccess(request);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  if (!auth.canControl || !auth.supabase) return NextResponse.json({ ok: false, message: "Kun ejer kan gøre dette" }, { status: 403 });

  const { returnId } = await context.params;
  const { data: lines, error } = await auth.supabase
    .from("backevent_return_lines")
    .select("id")
    .eq("return_id", returnId)
    .in("processing_status", ["registered", "requires_review", "failed"]);

  if (error) return NextResponse.json({ ok: false, message: "Returlinjer kunne ikke hentes" }, { status: 500 });

  let processed = 0;
  for (const line of lines ?? []) {
    const { data } = await auth.supabase.rpc("backevent_process_return_line", { p_return_line_id: line.id });
    if ((data as { ok?: boolean } | null)?.ok) processed += 1;
  }

  await auth.supabase.from("backevent_return_history").insert({
    return_id: returnId,
    action: "reprocessed",
    actor_user_id: auth.userId,
    actor_name: auth.userEmail,
    metadata: { processed },
  });

  return NextResponse.json({ ok: true, processed });
}
