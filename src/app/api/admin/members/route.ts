import { NextResponse } from "next/server";
import { requireBackEventRole } from "@/lib/backevent/server-auth";
import { createMember, getMemberAdminClient, listMembersForAdmin, parseMemberInput } from "@/lib/backevent/member-admin";

export async function GET(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({
      ok: true,
      members: [
        {
          id: "mock-user",
          fullName: "Mock mode",
          email: "mock@backevent.local",
          phone: null,
          role: "ejer",
          active: true,
          invitationStatus: "accepted",
          invitationSentAt: null,
          invitationAcceptedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          pushSubscriptionCount: 1,
          createdAt: new Date().toISOString(),
          groups: [],
        },
      ],
      groups: [],
      memberships: [],
      auditLogs: [],
      mockMode: true,
    });
  }

  try {
    const data = await listMembersForAdmin(admin);
    return NextResponse.json({ ok: true, ...data });
  } catch {
    return NextResponse.json({ ok: false, message: "Kunne ikke hente medlemmer" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireBackEventRole(request, "ejer");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message, debug: auth.debug }, { status: auth.status });
  }

  const admin = getMemberAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: true, memberId: "mock-created", mockMode: true });
  }

  try {
    const input = parseMemberInput(await request.json());
    const memberId = await createMember(admin, auth.userId, input);
    return NextResponse.json({ ok: true, memberId });
  } catch (error) {
    return NextResponse.json({ ok: false, message: safeErrorMessage(error) }, { status: 400 });
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : "Kunne ikke gemme medlem";
}
