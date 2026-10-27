// Habilidades (skills) do Agente: regras puras, compartilhadas com o navegador e a validação do grafo.
// Formato aberto Agent Skills (agentskills.io): SKILL.md com name/description no YAML; pacote .zip com uma pasta de mesmo nome.

/** Nome: 1 a 64 caracteres, letras minúsculas, números e hífens, sem hífen no início, no fim ou repetido. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME = 64;
export const MAX_SKILL_DESCRIPTION = 1024;
/** Habilidades por Agente. */
export const MAX_AGENT_SKILLS = 20;
/** Habilidades por conta. */
export const MAX_ACCOUNT_SKILLS = 100;
export const MAX_SKILL_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_SKILL_MD_CHARS = 100_000;
export const MAX_SKILL_FILE_CHARS = 200_000;
export const MAX_SKILL_TEXT_CHARS = 1_000_000;
export const MAX_SKILL_FILES = 200;
/** Trecho devolvido por leitura de arquivo da habilidade; arquivos maiores são lidos em partes. */
export const SKILL_READ_CHARS = 20_000;

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  /** Arquivos além do SKILL.md, carregáveis sob demanda. */
  files: string[];
  /** Arquivos do pacote que não são texto e não ficam disponíveis ao modelo. */
  skipped: string[];
  /** Estimativa de tokens do cabeçalho (sempre enviado) e do SKILL.md (enviado ao carregar). */
  headerTokens: number;
  bodyTokens: number;
  updatedAt: string;
};

/** Linha do catálogo que o modelo recebe em toda chamada: nome e descrição. */
export const skillHeader = (skill: { name: string; description: string }) => `- ${skill.name}: ${skill.description}`;

/** Estimativa aproximada (≈4 caracteres por token), usada só para exibição; o consumo real vem do provedor. */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids das habilidades escolhidas no bloco (config.skills, separados por vírgula). Lança em formato inválido. */
export function skillIds(config: Record<string, string>): string[] {
  const ids = (config.skills || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > MAX_AGENT_SKILLS) throw new Error(`Use até ${MAX_AGENT_SKILLS} habilidades por agente.`);
  if (ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) throw new Error("A lista de habilidades do agente está inválida.");
  return ids;
}

export function skillNameProblem(name: string): string | null {
  if (!name) return "O SKILL.md precisa de um campo name no cabeçalho YAML.";
  if (name.length > MAX_SKILL_NAME) return `O name da habilidade pode ter até ${MAX_SKILL_NAME} caracteres.`;
  if (!SKILL_NAME.test(name)) return `O name “${name}” deve usar só letras minúsculas, números e hífens, sem hífen no início, no fim ou repetido.`;
  return null;
}
