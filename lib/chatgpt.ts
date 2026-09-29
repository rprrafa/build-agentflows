/** Official Codex App Server protocol, pinned to @openai/codex 0.155.1.
 * Auth and turns use a private stdio child, never a browser token or unofficial endpoint.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { tenantId } from "./tenant-context";
import { privateDataDirectory } from "./tenant-files";

import { tokenUsage, type TokenUsage } from "./token-usage";
import { normalizeUsage } from "./account-usage";
import type { ModelCapability } from "./model-capabilities";

type Json = Record<string, unknown>;
type Message = {
  id?: number | string;
  method?: string;
  params?: Json;
  result?: unknown;
  error?: { message: string };
};
export type ChatAccount = {
  type: string;
  email?: string;
  planType?: string;
} | null;
export type DeviceLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};
export type AgentTool = {
  name: string;
  description: string;
  schema: unknown;
  call: (args: unknown) => Promise<string>;
};
type ActiveTurn = {
  resolve: (text: string) => void;
  reject: (e: Error) => void;
  text: string;
  turnId?: string;
  tools: AgentTool[];
  calls: number;
  onText?: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ChatGPTBridge {
  private readonly owner = tenantId();
  private launcher?: () => ChildProcessWithoutNullStreams;
  constructor(launcher?: () => ChildProcessWithoutNullStreams) {
    this.launcher = launcher;
  }
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private turns = new Map<string, ActiveTurn>();
  private login: DeviceLogin | null = null;
  private loginError: string | null = null;
  private workspace = "";

  private async start() {
    if (tenantId() !== this.owner) throw new Error("Esta conexão ChatGPT pertence a outra conta.");
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const data = privateDataDirectory();
      const codexHome = join(data, "chatgpt");
      this.workspace = join(data, "agent-workspace");
      mkdirSync(codexHome, { recursive: true, mode: 0o700 });
      mkdirSync(this.workspace, { recursive: true, mode: 0o700 });
      // Allowlist environment: never inherit app credentials, user's Codex auth or other providers.
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: codexHome,
        CODEX_HOME: codexHome,
        LANG: "en_US.UTF-8",
        TERM: "dumb",
        NODE_ENV: "production",
      };
      const require = createRequire(join(process.cwd(), "package.json"));
      const cli = require.resolve("@openai/codex/bin/codex.js");
      const child = this.launcher
        ? this.launcher()
        : spawn(
            process.execPath,
            [
              cli,
              "app-server",
              "--listen",
              "stdio://",
              "-c",
              'cli_auth_credentials_store="file"',
              "-c",
              "features.shell_tool=false",
              "-c",
              "features.unified_exec=false",
              "-c",
              "features.code_mode=false",
              "-c",
              // O host também despacha ferramentas dinâmicas, mesmo sem code mode.
              "features.code_mode_host=true",
              "-c",
              "features.multi_agent=false",
              "-c",
              'web_search="disabled"',
            ],
            { cwd: this.workspace, env, stdio: "pipe" },
          );
      this.child = child;
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          void this.receive(JSON.parse(line) as Message).catch(() => {
            // A child may close while an in-flight tool is returning.
          });
        } catch {
          /* non-protocol output is ignored, never sent to the browser */
        }
      });
      child.stderr.on("data", () => {});
      child.once("error", () => {
        if (this.child === child)
          this.failed(
            new Error(
              "Não foi possível iniciar a conexão ChatGPT no servidor.",
            ),
          );
      });
      child.once("exit", () => {
        if (this.child === child)
          this.failed(
            new Error("A conexão ChatGPT foi interrompida. Tente novamente."),
          );
      });
      await this.rpc("initialize", {
        clientInfo: {
          name: "build_agentflows",
          title: "Build Agentflows",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      });
      this.send({ method: "initialized" });
    })();
    try {
      await this.ready;
    } catch (e) {
      this.close();
      throw e;
    }
  }
  private send(value: unknown) {
    if (!this.child?.stdin.writable)
      throw new Error("A conexão ChatGPT não está disponível.");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  private rpc<T = unknown>(method: string, params: Json = {}): Promise<T> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("O ChatGPT demorou para responder. Tente novamente."));
      }, 30000);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private failed(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const t of this.turns.values()) {
      clearTimeout(t.timer);
      t.reject(error);
    }
    this.turns.clear();
    this.child = null;
    this.ready = null;
    this.login = null;
  }
  private async receive(m: Message) {
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(Number(m.id));
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(Number(m.id));
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
      return;
    }
    const p = m.params || {};
    const threadId = String(p.threadId || "");
    const turn = this.turns.get(threadId);
    if (m.id !== undefined && m.method) {
      if (m.method === "item/tool/call" && turn) {
        const tool = turn.tools.find((t) => t.name === p.tool);
        try {
          if (!tool || ++turn.calls > 12)
            throw new Error(
              "Ferramenta não autorizada ou limite de chamadas atingido.",
            );
          const text = await tool.call(p.arguments);
          this.send({
            id: m.id,
            result: {
              contentItems: [{ type: "inputText", text }],
              success: true,
            },
          });
        } catch (e) {
          this.send({
            id: m.id,
            result: {
              contentItems: [
                {
                  type: "inputText",
                  text: e instanceof Error ? e.message : "A ferramenta falhou.",
                },
              ],
              success: false,
            },
          });
        }
        return;
      }
      // No filesystem, shell, external approval or browser interaction from an agent block.
      this.send({
        id: m.id,
        error: {
          code: -32601,
          message: "Esta operação não está habilitada no Build Agentflows.",
        },
      });
      return;
    }
    if (m.method === "account/login/completed") {
      this.login = null;
      this.loginError = p.success
        ? null
        : String(p.error || "Não foi possível entrar. Gere um novo código.");
    }
    if (m.method === "thread/tokenUsage/updated" && turn) {
      const usage = tokenUsage((p.tokenUsage as Json)?.total, "chatgpt");
      if (usage) turn.onUsage?.(usage);
    }
    if (m.method === "item/agentMessage/delta" && turn) {
      turn.text += String(p.delta || "");
      turn.onText?.(turn.text);
    }
    if (m.method === "item/completed" && turn) {
      const item = p.item as Json;
      if (item?.type === "agentMessage" && typeof item.text === "string") {
        turn.text = item.text;
        turn.onText?.(turn.text);
      }
    }
    if (m.method === "turn/started" && turn)
      turn.turnId = String((p.turn as Json)?.id || "");
    if (m.method === "turn/completed" && turn) {
      clearTimeout(turn.timer);
      this.turns.delete(threadId);
      const result = p.turn as Json;
      if (result?.status === "completed" && turn.text.trim())
        turn.resolve(turn.text);
      else
        turn.reject(
          new Error(
            ((result?.error as Json)?.message as string) ||
              "O ChatGPT não concluiu a resposta. Tente novamente.",
          ),
        );
    }
  }
  async account(): Promise<{
    account: ChatAccount;
    login: DeviceLogin | null;
    error: string | null;
  }> {
    await this.start();
    const r = await this.rpc<{ account: ChatAccount }>("account/read", {
      refreshToken: false,
    });
    return {
      account: r.account?.type === "chatgpt" ? r.account : null,
      login: this.login,
      error: this.loginError,
    };
  }
  async usage() {
    if (!(await this.account()).account) throw new Error("Conecte sua conta ChatGPT para consultar os limites.");
    return normalizeUsage(await this.rpc("account/rateLimits/read"));
  }
  async beginLogin(): Promise<DeviceLogin> {
    await this.start();
    if (this.turns.size)
      throw new Error("Aguarde os agentes terminarem antes de trocar a conta.");
    if (this.login) return this.login;
    this.loginError = null;
    const r = await this.rpc<DeviceLogin>("account/login/start", {
      type: "chatgptDeviceCode",
    });
    const u = new URL(r.verificationUrl);
    if (u.protocol !== "https:" || u.hostname !== "auth.openai.com")
      throw new Error(
        "O ChatGPT devolveu um endereço de autenticação inesperado.",
      );
    this.login = r;
    return r;
  }
  async cancelLogin() {
    await this.start();
    if (this.login)
      await this.rpc("account/login/cancel", { loginId: this.login.loginId });
    this.login = null;
  }
  async logout() {
    await this.start();
    if (this.turns.size)
      throw new Error("Cancele ou aguarde as execuções antes de desconectar.");
    await this.cancelLogin();
    await this.rpc("account/logout");
    this.loginError = null;
  }
  async models(): Promise<ModelCapability[]> {
    await this.start();
    const r = await this.rpc<{
      data: { id: string; model: string; displayName: string; inputModalities?: string[]; isDefault?: boolean }[];
    }>("model/list", { limit: 100, includeHidden: false });
    return r.data.map((m) => ({
      id: m.model || m.id,
      name: m.displayName || m.model,
      inputModalities: m.inputModalities || ["text", "image"],
      isDefault: m.isDefault ?? r.data.length === 1,
    }));
  }
  async run({
    system,
    prompt,
    model,
    tools = [],
    images = [],
    signal,
    onText,
    onUsage,
    timeoutMs = 180000,
    webSearch = false,
  }: {
    system: string;
    prompt: string;
    model?: string;
    tools?: AgentTool[];
    images?: string[];
    signal?: AbortSignal;
    onText?: (text: string) => void;
    onUsage?: (usage: TokenUsage) => void;
    timeoutMs?: number;
    webSearch?: boolean;
  }): Promise<string> {
    // The child lives longer than a request. Bind callbacks to this turn's context,
    // not to the request that originally started its stdout event listener.
    tools = tools.map((tool) => ({ ...tool, call: AsyncLocalStorage.bind(tool.call) }));
    if (onText) onText = AsyncLocalStorage.bind(onText);
    if (onUsage) onUsage = AsyncLocalStorage.bind(onUsage);
    await this.start();
    if (!(await this.account()).account)
      throw new Error("Conecte sua conta ChatGPT para executar este agente.");
    if (signal?.aborted) throw new Error("Execução cancelada.");
    if (images.length) {
      const models = await this.models();
      const selected = model ? models.find((m) => m.id === model) : models.find((m) => m.isDefault);
      if (!selected?.inputModalities.includes("image")) throw new Error("Este modelo não tem suporte confirmado a imagens. Escolha um modelo com imagens no bloco.");
      model = selected.id;
    }
    const r = await this.rpc<{ thread: { id: string } }>("thread/start", {
      ...(model ? { model } : {}),
      cwd: this.workspace,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      environments: [],
      baseInstructions:
        "Você executa uma etapa de um fluxo de agentes. Responda em português. Use somente as ferramentas explicitamente fornecidas. Não use terminal, arquivos, navegador ou outras capacidades do sistema.",
      developerInstructions: system,
      dynamicTools: tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
      })),
      config: {
        "features.shell_tool": false,
        "features.unified_exec": false,
        "features.code_mode": false,
        "features.code_mode_host": true,
        "features.multi_agent": false,
        web_search: webSearch ? "live" : "disabled",
      },
    });
    const id = r.thread.id;
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, text?: string) => {
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(text!);
      };
      const abort = () => {
        const t = this.turns.get(id);
        if (t) {
          if (t.turnId)
            void this.rpc("turn/interrupt", {
              threadId: id,
              turnId: t.turnId,
            }).catch(() => {});
          clearTimeout(t.timer);
          this.turns.delete(id);
          finish(new Error("Execução cancelada."));
        }
      };
      const timer = setTimeout(() => {
        abort();
      }, Math.max(1, Math.min(timeoutMs, 3600000)));
      this.turns.set(id, {
        resolve: (text) => finish(undefined, text),
        reject: (error) => finish(error),
        text: "",
        tools,
        calls: 0,
        onText,
        onUsage,
        timer,
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      void this.rpc<{ turn: { id: string } }>("turn/start", {
        threadId: id,
        input: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image", url }))],
        environments: [],
      })
        .then((result) => {
          const t = this.turns.get(id);
          if (t) t.turnId = result.turn.id;
          else
            void this.rpc("turn/interrupt", {
              threadId: id,
              turnId: result.turn.id,
            }).catch(() => {});
        })
        .catch((e) => {
          const t = this.turns.get(id);
          if (t) {
            clearTimeout(t.timer);
            this.turns.delete(id);
            finish(e);
          }
        });
    });
  }
  close() {
    this.child?.kill();
    this.failed(new Error("Conexão encerrada."));
  }
  get busy() { return this.turns.size > 0 || this.pending.size > 0 || !!this.login; }
}
const globalChat = globalThis as typeof globalThis & {
  agentflowsChatGPT?: ChatGPTBridge;
  agentflowsChatGPTRevision?: string;
  agentflowsChatGPTTenants?: Map<string, { bridge: ChatGPTBridge; touched: number }>;
};
export function chatGPT(): ChatGPTBridge {
  const owner = tenantId();
  if (owner) {
    const clients = globalChat.agentflowsChatGPTTenants ??= new Map();
    for (const [key, entry] of clients) {
      if (!entry.bridge.busy && Date.now() - entry.touched > 15 * 60_000) {
        entry.bridge.close(); clients.delete(key);
      }
    }
    let entry = clients.get(owner);
    if (!entry) {
      if (clients.size >= 4) {
        const idle = [...clients].filter(([, value]) => !value.bridge.busy).sort((a, b) => a[1].touched - b[1].touched)[0];
        if (!idle) throw new Error("Todas as conexões ChatGPT estão ocupadas. Aguarde e tente novamente.");
        idle[1].bridge.close(); clients.delete(idle[0]);
      }
      entry = { bridge: new ChatGPTBridge(), touched: Date.now() };
      clients.set(owner, entry);
    }
    entry.touched = Date.now();
    return entry.bridge;
  }
  // O hot reload preserva globais: descarte processos iniciados com o host desativado.
  if (globalChat.agentflowsChatGPT && globalChat.agentflowsChatGPTRevision !== "tool-host-1") {
    globalChat.agentflowsChatGPT.close();
    globalChat.agentflowsChatGPT = undefined;
  }
  globalChat.agentflowsChatGPTRevision = "tool-host-1";
  return (globalChat.agentflowsChatGPT ??= new ChatGPTBridge());
}
