/**
 * Shared database: Upstash Redis over its REST API (no driver needed on Vercel).
 *
 * Turned on by creating an Upstash Redis store in Vercel → Storage, which adds
 * KV_REST_API_URL and KV_REST_API_TOKEN (UPSTASH_REDIS_REST_URL / _TOKEN also work).
 * Without them the app keeps everything in each browser, as before.
 */
import "server-only";

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function dbConfigured(): boolean {
  return Boolean(url() && token() && process.env.AUTH_SECRET);
}

async function command<T>(...args: (string | number)[]): Promise<T> {
  const res = await fetch(url(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Database request failed (${res.status})`);
  const body = (await res.json()) as { result?: T; error?: string };
  if (body.error) throw new Error(`Database error: ${body.error}`);
  return body.result as T;
}

export const dbGet = (key: string) => command<string | null>("GET", key);
export const dbSet = (key: string, value: string) => command<string>("SET", key, value);
export const dbDel = (key: string) => command<number>("DEL", key);
