import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import {
  buildReplayWindows,
  isOnlinePosReplayEnabled,
  runHistoricalReplayDryRun,
  validateCleanupConfirmation,
  validateReplayConfirmation,
  type ReplayMode,
} from "@/lib/onlinepos/historical-replay";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ReplayBody = {
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  intervalMinutes?: unknown;
  overlapMinutes?: unknown;
  venue?: unknown;
  cashRegister?: unknown;
  mode?: unknown;
  replayRunId?: unknown;
  confirmation?: unknown;
};

export async function GET(request: Request) {
  const gate = await requireReplayAccess(request);
  if (!gate.ok) return gate.response;
  const defaults = defaultInput();
  return NextResponse.json({
    ok: true,
    enabled: true,
    defaults,
    windows: buildReplayWindows(defaults),
  });
}

export async function POST(request: Request) {
  const gate = await requireReplayAccess(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => null)) as ReplayBody | null;
  const validation = validateBody(body);
  if (!validation.ok) return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });

  const confirmationError = validateReplayConfirmation(validation.input.mode, typeof body?.confirmation === "string" ? body.confirmation : null);
  if (confirmationError) return NextResponse.json({ ok: false, message: confirmationError }, { status: 400 });

  if (validation.input.mode === "test-run") {
    return NextResponse.json({
      ok: false,
      message: "Test-run er bevidst ikke aktiveret endnu. Kør dry-run først og godkend migrations/RPC for historical_replay.",
    }, { status: 400 });
  }

  const result = await runHistoricalReplayDryRun({ supabase: gate.supabase, input: validation.input });
  return NextResponse.json(result);
}

export async function DELETE(request: Request) {
  const gate = await requireReplayAccess(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => null)) as { replayRunId?: unknown; confirmation?: unknown } | null;
  if (typeof body?.replayRunId !== "string" || !body.replayRunId.trim()) {
    return NextResponse.json({ ok: false, message: "Replay run id mangler" }, { status: 400 });
  }
  if (!validateCleanupConfirmation(typeof body.confirmation === "string" ? body.confirmation : null)) {
    return NextResponse.json({ ok: false, message: "Oprydning kræver SLET REPLAYDATA" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    replayRunId: body.replayRunId,
    deletedRows: 0,
    reversedRows: 0,
    message: "Ingen historical_replay test-run data blev slettet. Dry-run opretter ingen data.",
  });
}

async function requireReplayAccess(request: Request):
  Promise<{ ok: true; supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>> } | { ok: false; response: NextResponse }> {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status }) };
  }
  if (!isOnlinePosReplayEnabled()) {
    return { ok: false, response: NextResponse.json({ ok: false, message: "Historical replay er ikke aktiveret" }, { status: 404 }) };
  }
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, response: NextResponse.json({ ok: false, message: "Supabase service role mangler" }, { status: 500 }) };
  }
  return { ok: true, supabase };
}

function defaultInput() {
  return {
    date: "2025-07-17",
    startTime: "17:00",
    endTime: "17:50",
    intervalMinutes: 10,
    overlapMinutes: 2,
    venue: process.env.ONLINEPOS_VENUE_ID ?? null,
  };
}

function validateBody(body: ReplayBody | null) {
  const mode = body?.mode === "test-run" ? "test-run" : "dry-run";
  const input = {
    ...defaultInput(),
    date: typeof body?.date === "string" ? body.date : "2025-07-17",
    startTime: typeof body?.startTime === "string" ? body.startTime : "17:00",
    endTime: typeof body?.endTime === "string" ? body.endTime : "17:50",
    intervalMinutes: numberValue(body?.intervalMinutes) ?? 10,
    overlapMinutes: numberValue(body?.overlapMinutes) ?? 2,
    venue: typeof body?.venue === "string" ? body.venue : process.env.ONLINEPOS_VENUE_ID ?? null,
    cashRegister: typeof body?.cashRegister === "string" && body.cashRegister.trim() ? body.cashRegister.trim() : null,
    mode: mode as ReplayMode,
    replayRunId: typeof body?.replayRunId === "string" && body.replayRunId.trim() ? body.replayRunId.trim() : crypto.randomUUID(),
  };
  try {
    buildReplayWindows(input);
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Replay input er ugyldigt" };
  }
  return { ok: true as const, input };
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
