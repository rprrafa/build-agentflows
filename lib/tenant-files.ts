import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tenantId } from "./tenant-context";

/** Filesystem namespace, including Codex, uploads, tool files and local vector indexes. */
export function privateDataDirectory(...parts: string[]) {
  const owner = tenantId();
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_-]+$/.test(part)) throw new Error("Diretório privado inválido.");
  }
  const configured = resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || join(process.cwd(), "data"));
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  // The configured root is operator-controlled and may legitimately be a mounted symlink.
  // No link below it may redirect a tenant's path to another user's files.
  let directory = realpathSync(configured);
  for (const part of [...(owner ? ["users", owner] : []), ...parts]) {
    directory = join(directory, part);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Diretório privado inseguro.");
  }
  return directory;
}
