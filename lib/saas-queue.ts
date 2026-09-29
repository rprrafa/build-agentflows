import { createClient } from "redis";

const newClient = () => createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true, commandOptions: { timeout: 2000 }, socket: { connectTimeout: 2000, reconnectStrategy: false } });
type Connection = ReturnType<typeof newClient>;
let connection: Connection | undefined;
let connecting: Promise<Connection> | undefined;
const KEY = "agentflows:jobs:v1";
async function client() {
  if (!process.env.REDIS_URL) throw new Error("Configure REDIS_URL.");
  if (connection?.isReady) return connection;
  if (connecting) return connecting;
  if (connection?.isOpen) connection.destroy();
  const next = newClient();
  next.on("error", () => {}); // Never log connection URLs/passwords.
  connection = next;
  connecting = next.connect().then(() => next).finally(() => { connecting = undefined; });
  return connecting;
}
/** Queue contains opaque job IDs only. The database handles authorization, leases and recovery. */
export async function notifyJob(id: string) {
  try {
    const redis = await client();
    await redis.multi().rPush(KEY, id).lTrim(KEY, -2000, -1).exec();
    return true;
  } catch { return false; } // Accepted PostgreSQL jobs remain available to the worker's reconciliation.
}
export async function nextJobNotification() {
  try { return await (await client()).lPop(KEY); } catch { return null; }
}
export async function queueReady() { try { return await (await client()).ping() === "PONG"; } catch { return false; } }
export function closeQueue() { if (connection?.isOpen) connection.destroy(); connection = undefined; }
