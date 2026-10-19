import { NextResponse } from "next/server";
import { isGoogleConfigured, readSession } from "@/lib/server/googleAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isGoogleConfigured();
  const session = configured ? await readSession() : null;
  return NextResponse.json({
    configured,
    connected: Boolean(session),
    email: session?.email ?? null,
    name: session?.name ?? null,
    firstName: session?.firstName ?? null,
  });
}
