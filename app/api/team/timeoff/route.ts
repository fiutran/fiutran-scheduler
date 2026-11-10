import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/server/session";
import { addTimeOff, currentPersonId, removeTimeOff } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const ID = /^off-[A-Za-z0-9-]{1,60}$/;

/** Saves one of your time-off blocks so the whole team sees it. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Sign in by connecting your calendar." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: string; startUtc?: string; endUtc?: string; reason?: string } | null;
  const start = body?.startUtc ? Date.parse(body.startUtc) : NaN;
  const end = body?.endUtc ? Date.parse(body.endUtc) : NaN;
  if (!body?.id || !ID.test(body.id) || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 31 * 864e5) {
    return NextResponse.json({ error: "Invalid time off" }, { status: 400 });
  }
  await addTimeOff({
    id: body.id,
    personId: me,
    startUtc: new Date(start).toISOString(),
    endUtc: new Date(end).toISOString(),
    reason: (body.reason ?? "").trim().slice(0, 120) || "Not working",
  });
  return NextResponse.json({ ok: true });
}

/** Removes one of your own blocks: DELETE ?id=… */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const me = await currentPersonId();
  if (!me) return NextResponse.json({ error: "Sign in by connecting your calendar." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await removeTimeOff(me, id);
  return NextResponse.json({ ok: true });
}
