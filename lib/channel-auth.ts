import { randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig, setConfig } from "./store";
import { currentTenant, withTenantJob } from "./tenant-context";
import { saasDatabase } from "./saas-db";
import { AuthError } from "./saas-security";
import { consumeRateLimit, rateLimitClient } from "./saas-rate-limit";
import { httpError } from "./saas-http";

export type Channel = "whatsapp" | "elevenlabs";
export const channelKeyName = (channel: Channel) => `${channel.toUpperCase()}_WEBHOOK_CHAVE`;
const PATTERN = /^ch_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/;
export function channelKey(channel: Channel) {
  const owner = currentTenant().user.id, key = channelKeyName(channel);
  const existing = getConfig(key);
  if (existing?.match(PATTERN)?.[1] === owner) return existing;
  const token = `ch_${owner}.${randomBytes(32).toString("base64url")}`;
  setConfig(key, token);
  return token;
}
export function channelKeyMatches(channel: Channel, received: string | null) {
  const expected = getConfig(channelKeyName(channel));
  return !!received && !!expected && received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
/** The prefix routes verification; only the complete, encrypted per-user secret authenticates. */
export async function channelApi(req: Request, channel: Channel, action: () => Promise<Response>) {
  try {
    const db = saasDatabase();
    await consumeRateLimit(db, `channel:ip:${rateLimitClient(req.headers)}`, 180, 60);
    const q = new URL(req.url).searchParams;
    const token = channel === "whatsapp" && req.method === "GET" ? q.get("hub.verify_token") : q.get("chave");
    const owner = token?.match(PATTERN)?.[1];
    if (!owner) throw new AuthError("Aviso não autorizado.", 401);
    return await withTenantJob(db, owner, async () => {
      if (!channelKeyMatches(channel, token)) throw new AuthError("Aviso não autorizado.", 401);
      await consumeRateLimit(db, `channel:user:${owner}`, 60, 60);
      const result = await action();
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "private, no-store"); headers.set("Referrer-Policy", "no-referrer");
      return new Response(result.body, { status: result.status, headers });
    });
  } catch (error) { return httpError(error); }
}
