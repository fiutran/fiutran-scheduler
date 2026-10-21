/**
 * Encrypted, httpOnly cookie per connected calendar (no database).
 * AES-256-GCM keyed by AUTH_SECRET; one cookie per provider.
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
};

// "fs_google" predates Outlook support; keeping it means existing Google connections survive.
const SESSION_COOKIE: Record<CalendarProvider, string> = { google: "fs_google", outlook: "fs_outlook" };
export const stateCookie = (p: CalendarProvider) => `${SESSION_COOKIE[p]}_state`;

function key(): Buffer {
  return createHash("sha256").update(process.env.AUTH_SECRET ?? "").digest();
}

function seal(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal<T>(value: string): T | null {
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
