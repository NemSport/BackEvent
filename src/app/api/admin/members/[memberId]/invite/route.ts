import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { getMemberAdminClient, sendMemberInvitation } from "@/lib/backevent/member-admin";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
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
    await sendMemberInvitation(admin, auth.userId, memberId);
    return NextResponse.json({ ok: true, memberId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Kunne ikke sende invitation";
}
