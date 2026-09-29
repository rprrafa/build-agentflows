import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { emailInvalido, senhaFraca } from "./conta-comum";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

export function normalizedEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || emailInvalido(value)) throw new AuthError("Escreva um e-mail válido.");
  return value.trim().toLowerCase();
}
export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 256) throw new AuthError("Informe uma senha com até 256 caracteres.");
  const error = senhaFraca(value);
  if (error) throw new AuthError(error);
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function passwordHash(password: string) {
  validatePassword(password);
  const salt = randomBytes(16);
  return `scrypt$16384$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: unknown, stored: string | null) {
  if (typeof password !== "string" || password.length > 256) return false;
  const parts = stored?.split("$");
  const valid = parts?.length === 4 && parts[0] === "scrypt" && parts[1] === "16384"
    && /^[a-f0-9]{32}$/.test(parts[2]) && /^[a-f0-9]{128}$/.test(parts[3]);
  // Equal KDF work for unknown accounts and accounts with no local password.
  const key = await derive(password, valid ? Buffer.from(parts[2], "hex") : Buffer.alloc(16));
  return !!valid && timingSafeEqual(key, Buffer.from(parts[3], "hex"));
}

export function encryptionKey() {
  const raw = process.env.CHAVE_MESTRA?.trim() || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) throw new Error("CHAVE_MESTRA deve conter exatamente 32 bytes em base64.");
  return key;
}

/** AAD binds each ciphertext to its owner and purpose; copying database rows cannot swap secrets. */
export function seal(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}
export function unseal(value: string, context: string) {
  const [version, iv, tag, data, extra] = value.split(":");
  if (version !== "v2" || !iv || !tag || data === undefined || extra !== undefined) throw new Error("Credencial cifrada inválida.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function appOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("APP_URL deve ser a origem HTTPS pública do aplicativo.");
  }
  return url.origin;
}
