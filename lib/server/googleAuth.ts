/**
 * Server-only Google OAuth + Calendar helpers. No database: tokens live in an
 * AES-256-GCM encrypted, httpOnly cookie keyed by AUTH_SECRET.
 *
 * Required env vars (set in Vercel → Project → Settings → Environment Variables):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET (any long random string)
 * Without them the app keeps running on sample data and Google stays simulated.
 */
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  // Read your events and create the meetings you send. Nothing else in your Google account.
  "https://www.googleapis.com/auth/calendar.events",
];

const SESSION_COOKIE = "fs_google";
export const STATE_COOKIE = "fs_google_state";

export type GoogleSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  email: string;
};

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);
}

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

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function readSession(): Promise<GoogleSession | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? unseal<GoogleSession>(value) : null;
}

export async function writeSession(session: GoogleSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, seal(session), { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

/** Exchanges an auth code or refresh token at Google's token endpoint. */
export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };
}

export class NotConnectedError extends Error {}

/** A valid session, refreshing the access token when it's about to expire. */
export async function activeSession(): Promise<GoogleSession> {
  const session = await readSession();
  if (!session) throw new NotConnectedError("Google Calendar is not connected");
  if (session.expiresAt - 60_000 > Date.now()) return session;
  if (!session.refreshToken) throw new NotConnectedError("Google session expired; connect again");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken });
  const next = { ...session, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  await writeSession(next);
  return next;
}

/** Calls the Google Calendar API v3 with the signed-in user's token. */
export async function calendarFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await activeSession();
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
}

/** Rejects cross-site POSTs (defence in depth on top of the SameSite=Lax cookie). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}
