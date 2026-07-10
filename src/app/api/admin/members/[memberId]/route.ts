import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { getMemberAdminClient, parseMemberInput, updateMember } from "@/lib/backevent/member-admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { memberId } = await params;
  const admin = getMemberAdminClient();

  if (!admin) {
    return NextResponse.json({ ok: true, memberId, mockMode: true });
  }

  try {
    const input = parseMemberInput(await request.json());
    await updateMember(admin, auth.userId, memberId, input);
    return NextResponse.json({ ok: true, memberId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Kunne ikke gemme medlem";
}
