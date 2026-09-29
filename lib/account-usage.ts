export type UsageWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type UsageBucket = { limitId: string | null; limitName: string | null; primary: UsageWindow | null; secondary: UsageWindow | null };
export type ChatGPTUsage = { buckets: UsageBucket[]; updatedAt: string };
// Only quota fields are exposed; tokens, account identifiers and backend messages stay private.
export function normalizeUsage(value: unknown): ChatGPTUsage {
  const data = (value || {}) as Record<string, unknown>;
  const map = data.rateLimitsByLimitId;
  const snapshots = map && typeof map === "object" && Object.keys(map).length ? Object.values(map) : [data.rateLimits];
  const window = (v: unknown): UsageWindow | null => {
    if (!v || typeof v !== "object") return null;
    const w = v as Record<string, unknown>;
    if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return null;
    return { usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
      windowDurationMins: typeof w.windowDurationMins === "number" && w.windowDurationMins > 0 ? w.windowDurationMins : null,
      resetsAt: typeof w.resetsAt === "number" && w.resetsAt > 0 && w.resetsAt < 8640000000000 ? w.resetsAt : null };
  };
  return { updatedAt: new Date().toISOString(), buckets: snapshots.filter((s) => s && typeof s === "object").map((s) => ({
    limitId: typeof s.limitId === "string" ? s.limitId : null,
    limitName: typeof s.limitName === "string" ? s.limitName : null,
    primary: window(s.primary), secondary: window(s.secondary),
  })) };
}
