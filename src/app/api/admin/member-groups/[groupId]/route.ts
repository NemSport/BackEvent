import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import {
  deleteMemberGroupForAdmin,
  getMemberAdminClient,
  parseMemberGroupInput,
  updateMemberGroupForAdmin,
} from "@/lib/backevent/member-admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { groupId } = await params;
  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: true, groupId, mockMode: true });
  }

  try {
    const input = parseMemberGroupInput(await request.json());
    await updateMemberGroupForAdmin(admin, auth.userId, groupId, input);
    return NextResponse.json({ ok: true, groupId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const { groupId } = await params;
  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: true, groupId, mockMode: true });
  }

  try {
    await deleteMemberGroupForAdmin(admin, auth.userId, groupId);
    return NextResponse.json({ ok: true, groupId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Kunne ikke gemme gruppe";
}
