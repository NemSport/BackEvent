import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import {
  createMemberGroupForAdmin,
  getMemberAdminClient,
  listMembersForAdmin,
  parseMemberGroupInput,
} from "@/lib/backevent/member-admin";

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: true, groups: [], memberships: [], mockMode: true });
  }

  try {
    const data = await listMembersForAdmin(admin);
    return NextResponse.json({ ok: true, groups: data.groups, memberships: data.memberships });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: true, groupId: "mock-group-created", mockMode: true });
  }

  try {
    const input = parseMemberGroupInput(await request.json());
    const groupId = await createMemberGroupForAdmin(admin, auth.userId, input);
    return NextResponse.json({ ok: true, groupId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Kunne ikke gemme gruppe";
}
