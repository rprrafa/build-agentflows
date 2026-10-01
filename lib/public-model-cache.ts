import { redisClient } from "./saas-queue";

const HOUR = 3600_000;
type Entry<T> = { at: number; value: T };
/** Only the unauthenticated OpenRouter catalogue belongs here. Never pass user data. */
export function publicModelCache<T>(load: () => Promise<T>, now = Date.now) {
  let local: Entry<T> | undefined;
  let pending: Promise<T> | undefined;
  const key = "agentflows:public:openrouter-models:v2";
  return async (force = false): Promise<T> => {
    if (!force && local && now() - local.at < HOUR) return local.value;
    if (pending) return pending;
    pending = (async () => {
      if (!force && process.env.REDIS_URL) {
        try {
          const raw = await (await redisClient()).get(key);
          if (raw) {
            const entry = JSON.parse(raw) as Entry<T>;
            if (typeof entry.at === "number" && Array.isArray(entry.value) && entry.value.length) {
              local = entry;
              if (now() - entry.at < HOUR) return entry.value;
            }
          }
        } catch { /* Redis is optional; the in-process cache still serves all users. */ }
      }
      try {
        const value = await load();
        local = { at: now(), value };
        if (process.env.REDIS_URL) {
          try { await (await redisClient()).set(key, JSON.stringify(local), { EX: 24 * 3600 }); } catch { /* Keep local result. */ }
        }
        return value;
      } catch (error) {
        // A temporary upstream outage must not empty the editor's catalogue.
        if (local && now() - local.at < 24 * HOUR) return local.value;
        throw error;
      }
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
