import type { Ferramenta } from "./mcp";
import { listFlows, getRun } from "./flow-store";
import { startRun, resumeRun } from "./flow-runtime";
export const NOME_SERVIDOR = "build-agentflows";
export const FERRAMENTAS: Ferramenta[] = [
  {
    nome: "listar_fluxos",
    descricao: "Lista fluxos publicados disponíveis para integração.",
    schema: { type: "object", properties: {} },
    executar: async () =>
      listFlows()
        .filter((f) => f.published)
        .map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          version: f.version,
        })),
  },
  {
    nome: "executar_fluxo",
    descricao:
      "Executa o fluxo salvo, quando suas integrações estão ativas. Pode aguardar aprovação humana.",
    schema: {
      type: "object",
      properties: { id: { type: "string" }, input: { type: "string" } },
      required: ["id", "input"],
    },
    executar: async (a) => {
      const r = await startRun(String(a.id), a.input, true);
      return {
        id: r.id,
        status: r.status,
        output: r.output,
        error: r.error,
        demo: r.demo,
      };
    },
  },
  {
    nome: "consultar_execucao",
    descricao: "Consulta resultado e etapas de uma execução.",
    schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    executar: async (a) => {
      const r = getRun(String(a.id));
      return {
        id: r.id,
        status: r.status,
        output: r.output,
        error: r.error,
        trace: r.trace,
      };
    },
  },
  {
    nome: "responder_aprovacao",
    descricao:
      "Retoma uma execução aguardando decisão humana explicitamente autorizada: yes aprova, no rejeita.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        decision: { type: "string", enum: ["yes", "no"] },
      },
      required: ["id", "decision"],
    },
    executar: async (a) => {
      const r = await resumeRun(String(a.id), a.decision);
      return { id: r.id, status: r.status, output: r.output, error: r.error };
    },
  },
];
