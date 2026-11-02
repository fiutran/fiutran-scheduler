/**
 * Encryption (AES-256-GCM keyed by AUTH_SECRET) and cookies.
 * Without a database, each connected calendar lives in its own encrypted cookie.
 * With the shared database, connections are stored there (also encrypted) and the
 * browser only keeps "fs_me": which team member it is signed in as.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { CalendarProvider } from "@/lib/types";

export type LiveSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  email: string;
  name?: string;
  firstName?: string;
  /** Provider-specific data, e.g. iCloud's app-specific password and calendar URLs. */
  extra?: Record<string, unknown>;
};

// "fs_google" predates Outlook support; keeping it means existing Google connections survive.
const SESSION_COOKIE: Record<CalendarProvider, string> = { google: "fs_google", outlook: "fs_outlook", icloud: "fs_icloud" };
const ME_COOKIE = "fs_me";
export const stateCookie = (p: CalendarProvider) => `${SESSION_COOKIE[p]}_state`;

function key(): Buffer {
  return createHash("sha256").update(process.env.AUTH_SECRET ?? "").digest();
}

export function seal(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(value: string): T | null {
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function readSession(p: CalendarProvider): Promise<LiveSession | null> {
  const value = (await cookies()).get(SESSION_COOKIE[p])?.value;
  return value ? unseal<LiveSession>(value) : null;
}

export async function writeSession(p: CalendarProvider, session: LiveSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE[p], seal(session), { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSession(p: CalendarProvider): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE[p]);
}

/** Rejects cross-site POSTs (defence in depth on top of the SameSite=Lax cookie). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

/** Reads an id_token's claims. Only used on tokens received directly from the provider over TLS. */
export function idTokenClaims(idToken?: string): Record<string, string> {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}

/** Which team member this browser is signed in as (set when they connect a calendar with a team email). */
export async function readMe(): Promise<string | null> {
  const value = (await cookies()).get(ME_COOKIE)?.value;
  return value ? (unseal<{ personId: string }>(value)?.personId ?? null) : null;
}

export async function writeMe(personId: string): Promise<void> {
  (await cookies()).set(ME_COOKIE, seal({ personId }), { ...cookieOptions, maxAge: 60 * 60 * 24 * 90 });
}

export async function clearMe(): Promise<void> {
  (await cookies()).delete(ME_COOKIE);
}
