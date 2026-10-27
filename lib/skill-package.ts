// Leitura de habilidades enviadas: um SKILL.md ou um .zip com a pasta da habilidade (pasta = name do SKILL.md).
// Só texto UTF-8 fica disponível ao modelo; binários e arquivos grandes demais são listados como não disponíveis.
import { unzipSync } from "fflate";
import {
  MAX_SKILL_DESCRIPTION, MAX_SKILL_FILE_CHARS, MAX_SKILL_FILES, MAX_SKILL_MD_CHARS, MAX_SKILL_TEXT_CHARS, MAX_SKILL_UPLOAD_BYTES,
  skillNameProblem,
} from "./skill-settings";

export class SkillPackageError extends Error {}

export type SkillFile = { path: string; content: string };
export type SkillPackage = {
  name: string;
  description: string;
  /** Instruções do SKILL.md, sem o cabeçalho YAML. */
  body: string;
  files: SkillFile[];
  skipped: string[];
};

const fail = (message: string): never => { throw new SkillPackageError(message); };

function unquote(raw: string) {
  if (raw.startsWith('"')) {
    const quoted = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(raw);
    try { return JSON.parse(`"${quoted![1].replace(/\t/g, "\\t")}"`) as string; } catch { return fail("O cabeçalho YAML do SKILL.md tem aspas não fechadas."); }
  }
  if (raw.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(raw);
    if (!quoted) fail("O cabeçalho YAML do SKILL.md tem aspas não fechadas.");
    return quoted![1].replace(/''/g, "'");
  }
  return raw.replace(/\s+#.*$/, "");
}

/** Campos de primeiro nível do cabeçalho YAML (texto simples, entre aspas ou em bloco | e >). Mapas e listas aninhados são ignorados. */
export function frontmatterFields(yaml: string): Record<string, string> {
  const lines = yaml.split("\n");
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    const raw = (match[2] || "").trim();
    const continuation: string[] = [];
    while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) continuation.push(lines[++i]);
    while (continuation.length && !continuation[continuation.length - 1].trim()) continuation.pop();
    if (/^[|>][+-]?[0-9]?$/.test(raw)) {
      const indent = Math.min(...continuation.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
      const content = continuation.map((l) => l.slice(indent));
      fields[key] = raw[0] === "|" ? content.join("\n") : content.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    } else if (!raw) {
      // Mapa ou lista aninhados (metadata, por exemplo): não são texto.
      if (continuation.some((l) => /^\s+(?:-\s|[A-Za-z0-9_-]+:)/.test(l))) continue;
      fields[key] = continuation.map((l) => l.trim()).join(" ");
    } else {
      // Texto em várias linhas (simples ou entre aspas) é unido por espaços, como no YAML.
      fields[key] = unquote([raw, ...continuation.map((l) => l.trim())].join(" ").trim());
    }
  }
  return fields;
}

/** Valida o SKILL.md: cabeçalho YAML com name e description, seguido das instruções em Markdown. */
export function parseSkillMarkdown(text: string, folder?: string) {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (normalized.length > MAX_SKILL_MD_CHARS) fail(`O SKILL.md pode ter até ${MAX_SKILL_MD_CHARS.toLocaleString("pt-BR")} caracteres. Mova o material de referência para outros arquivos do pacote.`);
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) fail("O SKILL.md precisa começar com um cabeçalho YAML entre linhas ---, com name e description.");
  const fields = frontmatterFields(match![1]);
  const name = (fields.name || "").trim();
  const description = (fields.description || "").trim();
  const problem = skillNameProblem(name);
  if (problem) fail(problem);
  if (!description) fail("O SKILL.md precisa de um campo description no cabeçalho YAML, dizendo o que a habilidade faz e quando usá-la.");
  if (description.length > MAX_SKILL_DESCRIPTION) fail(`A description da habilidade pode ter até ${MAX_SKILL_DESCRIPTION} caracteres.`);
  if (folder !== undefined && folder !== name) fail(`A pasta do .zip (“${folder}”) precisa ter o mesmo nome da habilidade no SKILL.md (“${name}”).`);
  const body = normalized.slice(match![0].length).trim();
  if (!body) fail("O SKILL.md precisa de instruções depois do cabeçalho YAML.");
  return { name, description, body };
}

const decoder = new TextDecoder("utf-8", { fatal: true });
function text(bytes: Uint8Array) {
  try {
    const value = decoder.decode(bytes);
    return value.includes("\0") ? null : value.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  } catch { return null; }
}
const ignored = (path: string) => path.startsWith("__MACOSX/") || /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);

/** Lê o arquivo enviado: SKILL.md isolado ou .zip com a pasta da habilidade. */
export function parseSkillUpload(fileName: string, bytes: Uint8Array): SkillPackage {
  if (!bytes.length) fail("O arquivo está vazio.");
  if (bytes.length > MAX_SKILL_UPLOAD_BYTES) fail("O arquivo da habilidade pode ter até 5 MB.");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) {
    if (lower.split(/[\\/]/).pop() !== "skill.md") fail("Envie um arquivo chamado SKILL.md ou um pacote .zip que inclua o SKILL.md.");
    const content = text(bytes);
    if (content === null) fail("O SKILL.md precisa estar em texto UTF-8.");
    return { ...parseSkillMarkdown(content!), files: [], skipped: [] };
  }
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!lower.endsWith(".zip") || !zip) fail("Envie um arquivo SKILL.md ou um pacote .zip que inclua o SKILL.md.");
  let declared = 0, count = 0;
  const tooLarge: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/") || ignored(file.name)) return false;
        if (++count > MAX_SKILL_FILES + 1) fail(`O pacote pode ter até ${MAX_SKILL_FILES} arquivos.`);
        // Arquivos grandes demais nem são descompactados: protege contra pacotes que se expandem muito.
        if (file.originalSize > MAX_SKILL_FILE_CHARS * 4) { tooLarge.push(file.name); return false; }
        declared += file.originalSize;
        if (declared > MAX_SKILL_TEXT_CHARS * 4) fail("O conteúdo descompactado do pacote é grande demais. Mantenha só os arquivos de texto que a habilidade usa.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SkillPackageError) throw error;
    return fail("Não foi possível abrir o .zip. Compacte a pasta da habilidade novamente e envie outra vez.");
  }
  const paths = [...Object.keys(entries), ...tooLarge];
  for (const path of paths)
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === ".") || /[\0-\x1f]/.test(path))
      fail("O .zip tem um caminho de arquivo inválido. Compacte a pasta da habilidade novamente.");
  const manifests = paths.filter((path) => /^[^/]+\/SKILL\.md$/i.test(path));
  if (paths.some((path) => /^SKILL\.md$/i.test(path)) && !manifests.length)
    fail("No .zip, o SKILL.md precisa estar dentro de uma pasta com o nome da habilidade (por exemplo, minha-habilidade/SKILL.md).");
  if (!manifests.length) fail("O .zip precisa incluir uma pasta com o SKILL.md (por exemplo, minha-habilidade/SKILL.md).");
  if (manifests.length > 1) fail("O .zip deve ter uma única habilidade: encontramos mais de um SKILL.md.");
  const [folder] = manifests[0].split("/");
  if (tooLarge.includes(manifests[0])) fail(`O SKILL.md pode ter até ${MAX_SKILL_MD_CHARS.toLocaleString("pt-BR")} caracteres.`);
  const manifest = text(entries[manifests[0]]);
  if (manifest === null) fail("O SKILL.md precisa estar em texto UTF-8.");
  const skill = parseSkillMarkdown(manifest!, folder);
  const files: SkillFile[] = [];
  const skipped: string[] = [];
  let total = manifest!.length;
  for (const path of paths.sort()) {
    if (path === manifests[0]) continue;
    if (!path.startsWith(folder + "/")) { skipped.push(`${path} (fora da pasta ${folder})`); continue; }
    const relative = path.slice(folder.length + 1);
    if (tooLarge.includes(path)) { skipped.push(`${relative} (maior que ${MAX_SKILL_FILE_CHARS.toLocaleString("pt-BR")} caracteres)`); continue; }
    const content = text(entries[path]);
    if (content === null) { skipped.push(`${relative} (não é texto)`); continue; }
    if (content.length > MAX_SKILL_FILE_CHARS) { skipped.push(`${relative} (maior que ${MAX_SKILL_FILE_CHARS.toLocaleString("pt-BR")} caracteres)`); continue; }
    total += content.length;
    if (total > MAX_SKILL_TEXT_CHARS) fail(`Os arquivos de texto do pacote podem somar até ${MAX_SKILL_TEXT_CHARS.toLocaleString("pt-BR")} caracteres.`);
    files.push({ path: relative, content });
  }
  return { ...skill, files, skipped };
}
