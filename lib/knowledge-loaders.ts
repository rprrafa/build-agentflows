import { createHash } from "node:crypto";
import { load } from "cheerio";
import { parse } from "csv-parse/sync";
import {
  RecursiveCharacterTextSplitter,
  CharacterTextSplitter,
} from "@langchain/textsplitters";
import { knowledgeLoader } from "./knowledge-catalog";
import { knowledgeFetch, knowledgeJson, knowledgeUrl } from "./knowledge-http";
import { FlowError } from "./flow-store";
import type { Chunk, Document, SplitterConfig } from "./knowledge-types";
export type SourceFile = { name: string; data: string };
export type Extraction = { documents: Document[]; warnings: string[] };
const MAX_TEXT = 5_000_000;
const MAX_DOCUMENTS = 10000;
const doc = (
  pageContent: string,
  source: string,
  metadata: Record<string, unknown> = {},
): Document => ({ pageContent, metadata: { source, ...metadata } });
const required = (config: Record<string, string>, key: string) => {
  const value = config[key]?.trim();
  if (!value) throw new FlowError(`Preencha ${key}.`);
  return value;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FlowError("Use um objeto JSON válido.");
  return value as Record<string, unknown>;
}
export function jsonObject(value: string): Record<string, unknown> {
  try {
    return object(JSON.parse(value || "{}"));
  } catch {
    throw new FlowError("Use um objeto JSON válido.");
  }
}
export function validateSplitter(value: SplitterConfig) {
  if (
    !value ||
    !["recursive", "character"].includes(value.kind) ||
    !Number.isInteger(value.size) ||
    value.size < 100 ||
    value.size > 8000 ||
    !Number.isInteger(value.overlap) ||
    value.overlap < 0 ||
    value.overlap >= value.size ||
    typeof value.separator !== "string" ||
    value.separator.length > 100
  )
    throw new FlowError(
      "Use fragmentos de 100 a 8.000 caracteres e sobreposição menor que o tamanho.",
    );
  return value;
}
function validateDocs(docs: Document[]) {
  if (
    !Array.isArray(docs) ||
    docs.length > MAX_DOCUMENTS ||
    docs.some(
      (d) =>
        !d ||
        typeof d.pageContent !== "string" ||
        !d.metadata ||
        typeof d.metadata !== "object" ||
        Array.isArray(d.metadata),
    )
  )
    throw new FlowError(
      "A extração deve retornar até 10.000 documentos com pageContent e metadata.",
    );
  if (
    docs.reduce(
      (n, d) => n + d.pageContent.length + JSON.stringify(d.metadata).length,
      0,
    ) > MAX_TEXT
  )
    throw new FlowError(
      "A fonte excede 5 milhões de caracteres. Divida o conteúdo em fontes menores.",
    );
  const result = docs.filter((d) => d.pageContent.trim());
  if (!result.length)
    throw new FlowError(
      "Nenhum texto foi encontrado. Confira a fonte; arquivos digitalizados precisam de reconhecimento de texto.",
    );
  return result;
}
export async function splitDocuments(
  documents: Document[],
  sourceId: string,
  config: SplitterConfig,
  metadata: Record<string, unknown> = {},
): Promise<Chunk[]> {
  validateSplitter(config);
  validateDocs(documents);
  const options = { chunkSize: config.size, chunkOverlap: config.overlap };
  const splitter =
    config.kind === "recursive"
      ? new RecursiveCharacterTextSplitter(options)
      : new CharacterTextSplitter({ ...options, separator: config.separator });
  const chunks: Chunk[] = [];
  for (const document of documents) {
    const parts = await splitter.splitText(document.pageContent);
    for (const part of parts) {
      // Character splitters may emit oversize paragraphs. Bound those deterministically.
      for (let offset = 0; offset < part.length; ) {
        const content = part.slice(offset, offset + config.size);
        const ordinal = chunks.length + 1;
        const combined = { ...document.metadata, ...metadata };
        const hash = createHash("sha256")
          .update(JSON.stringify([sourceId, ordinal, content, combined]))
          .digest("hex");
        chunks.push({
          id: hash,
          sourceId,
          ordinal,
          pageContent: content,
          metadata: combined,
        });
        if (chunks.length > MAX_DOCUMENTS)
          throw new FlowError(
            "A fonte gerou mais de 10.000 fragmentos. Aumente o tamanho ou divida o conteúdo.",
          );
        if (offset + config.size >= part.length) break;
        offset += config.size - config.overlap;
      }
    }
  }
  return chunks;
}
export async function parseKnowledgeFile(
  name: string,
  bytes: Buffer,
  config: Record<string, string> = {},
): Promise<Document[]> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new FlowError("Use arquivos não vazios de até 10 MB.");
  const extension = name.split(".").pop()?.toLowerCase();
  if (["txt", "md", "markdown", "log"].includes(extension || ""))
    return [doc(bytes.toString("utf8"), name)];
  if (extension === "csv") {
    let rows: Record<string, string>[];
    try {
      rows = parse(bytes, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        max_record_size: MAX_TEXT,
      });
    } catch {
      throw new FlowError(
        "Não foi possível ler o CSV. Confira o cabeçalho e as colunas.",
      );
    }
    if (config.column && rows.length && !Object.hasOwn(rows[0], config.column))
      throw new FlowError("A coluna escolhida não existe no CSV.");
    return rows.map((r, i) =>
      doc(
        config.column
          ? r[config.column]
          : Object.entries(r)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n"),
        name,
        { row: i + 2 },
      ),
    );
  }
  if (extension === "json") {
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new FlowError("O arquivo não contém JSON válido.");
    }
    if (config.pointer)
      for (const key of config.pointer.split(".")) value = object(value)[key];
    if (value === undefined)
      throw new FlowError("O caminho informado não existe no JSON.");
    return (Array.isArray(value) ? value : [value]).map((item, index) =>
      doc(
        typeof item === "string" ? item : JSON.stringify(item, null, 2),
        name,
        { index },
      ),
    );
  }
  if (extension === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const result = await extractText(pdf, { mergePages: false });
      return result.text.map((text, i) => doc(text, name, { page: i + 1 }));
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
  if (["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(extension || "")) {
    const { OfficeParser } = await import("officeparser");
    const ast = await OfficeParser.parseOffice(bytes);
    return [doc((await ast.to("text")).value, name)];
  }
  throw new FlowError(
    `Formato não suportado: ${name}. Use texto, CSV, JSON, PDF, DOCX, XLSX, PPTX ou OpenDocument.`,
  );
}
export async function extractKnowledge(
  loaderId: string,
  config: Record<string, string>,
  files: SourceFile[] = [],
  signal?: AbortSignal,
  transport = { json: knowledgeJson, bytes: knowledgeFetch },
): Promise<Extraction> {
  const loader = knowledgeLoader(loaderId);
  if (!loader) throw new FlowError("Escolha uma opção de extração válida.");
  for (const field of loader.fields)
    if (field.required && !config[field.key]?.trim())
      throw new FlowError(`Preencha ${field.label}.`);
  const limit = Number(config.limit || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new FlowError("Use um limite de 1 a 100 documentos.");
  const warnings: string[] = [];
  let documents: Document[] = [];
  const limited = () =>
    warnings.push(
      `O limite de ${limit} documentos foi alcançado. Aumente o limite ou divida a fonte para importar o restante.`,
    );
  const auth: Record<string, string> = config.token
    ? { Authorization: `Bearer ${config.token}` }
    : {};
  const json = <T>(
    url: string,
    options: Parameters<typeof knowledgeJson>[1] = {},
  ) => transport.json<T>(url, { ...options, signal });
  if (loader.accept) {
    if (!files.length || files.length > 20)
      throw new FlowError("Adicione entre 1 e 20 arquivos.");
    for (const f of files) {
      if (
        !loader.accept
          .split(",")
          .includes("." + f.name.split(".").pop()?.toLowerCase())
      )
        throw new FlowError(
          `O arquivo ${f.name} não é compatível com ${loader.name}.`,
        );
      documents.push(
        ...(await parseKnowledgeFile(
          f.name,
          Buffer.from(f.data, "base64"),
          config,
        )),
      );
    }
  } else if (loaderId === "plain")
    documents = [doc(required(config, "text"), "Texto adicionado")];
  else if (loaderId === "cheerio") {
    const first = knowledgeUrl(required(config, "url"));
    const queue = [first.href];
    const seen = new Set<string>();
    while (queue.length && documents.length < limit) {
      signal?.throwIfAborted();
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const $ = load((await transport.bytes(url, { signal })).toString("utf8"));
      if (limit > 1)
        $("a[href]").each((_i, element) => {
          try {
            const next = new URL($(element).attr("href")!, url);
            next.hash = "";
            if (
              next.origin === first.origin &&
              !seen.has(next.href) &&
              !queue.includes(next.href) &&
              queue.length < 1000
            )
              queue.push(next.href);
          } catch {}
        });
      $("script,style,nav,footer,noscript").remove();
      $("br").replaceWith("\n");
      $("p,div,li,h1,h2,h3,section,tr").append("\n");
      let text: string;
      try {
        text = $(config.selector || "body")
          .text()
          .replace(/[ \t]+/g, " ")
          .replace(/\n\s*\n+/g, "\n\n")
          .trim();
      } catch {
        throw new FlowError("O seletor CSS não é válido.");
      }
      if (text) documents.push(doc(text, url, { title: $("title").text() }));
      if (seen.size >= 100) break;
    }
    if (queue.length) limited();
  } else if (loaderId === "firecrawl") {
    const result = await json<{
      success: boolean;
      data: { markdown?: string; metadata?: Record<string, unknown> };
    }>("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: auth,
      body: { url: required(config, "url"), formats: ["markdown"] },
    });
    if (!result.success)
      throw new FlowError("O FireCrawl não conseguiu extrair a página.");
    documents = [
      doc(result.data?.markdown || "", config.url, result.data?.metadata),
    ];
  } else if (loaderId === "spider") {
    const bytes = await transport.bytes("https://api.spider.cloud/crawl", {
      method: "POST",
      headers: auth,
      body: { url: config.url, limit, return_format: "markdown" },
      signal,
    });
    // Spider supports both JSON arrays and streamed JSONL responses.
    const text = bytes.toString("utf8").trim();
    let result: { content?: string; url?: string; status?: number }[];
    try {
      if (text.startsWith("[")) result = JSON.parse(text);
      else
        result = text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    } catch {
      throw new FlowError("O Spider retornou conteúdo inválido.", 502);
    }
    if (!Array.isArray(result))
      throw new FlowError("Resposta inesperada do Spider.");
    documents = result.map((r) => doc(r.content || "", r.url || config.url));
    if (result.length >= limit) limited();
  } else if (loaderId === "apify") {
    const run = await json<{
      data: { id: string; status: string; defaultDatasetId: string };
    }>(
      "https://api.apify.com/v2/acts/apify~website-content-crawler/runs?waitForFinish=60",
      {
        method: "POST",
        headers: auth,
        body: { startUrls: [{ url: config.url }], maxCrawlPages: limit },
      },
    );
    let state = run.data;
    for (
      let i = 0;
      !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(state.status) &&
      i < 8;
      i++
    )
      state = (
        await json<typeof run>(
          `https://api.apify.com/v2/actor-runs/${encodeURIComponent(state.id)}?waitForFinish=30`,
          { headers: auth },
        )
      ).data;
    if (state.status !== "SUCCEEDED")
      throw new FlowError(
        `A extração Apify não concluiu (${state.status}). Consulte a execução no Apify antes de repetir.`,
      );
    const items = await json<
      {
        text?: string;
        markdown?: string;
        url?: string;
        metadata?: Record<string, unknown>;
      }[]
    >(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(state.defaultDatasetId)}/items?limit=${limit}`,
      { headers: auth },
    );
    documents = items.map((item) =>
      doc(
        item.markdown || item.text || "",
        item.url || config.url,
        item.metadata,
      ),
    );
    if (items.length >= limit) limited();
  } else if (loaderId === "searchapi") {
    const result = await json<{
      organic_results?: { title: string; link: string; snippet?: string }[];
    }>(
      `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(required(config, "query"))}`,
      { headers: auth },
    );
    documents = (result.organic_results || []).map((r) =>
      doc(`${r.title}\n${r.snippet || ""}`, r.link, {
        title: r.title,
        query: config.query,
      }),
    );
  } else if (loaderId === "github") {
    const repo = required(config, "repository")
      .replace(/^https:\/\/github.com\//, "")
      .replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
      throw new FlowError("Informe o repositório como organização/nome.");
    const headers = {
      ...auth,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const branch =
      config.branch ||
      (
        await json<{ default_branch: string }>(
          `https://api.github.com/repos/${repo}`,
          { headers },
        )
      ).default_branch;
    const tree = await json<{
      truncated: boolean;
      tree: { path: string; type: string; size?: number }[];
    }>(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers },
    );
    const items = tree.tree.filter(
      (item) =>
        item.type === "blob" &&
        (!config.path ||
          item.path === config.path ||
          item.path.startsWith(config.path.replace(/\/$/, "") + "/")) &&
        /\.(md|txt|json|csv|tsx?|jsx?|py|ya?ml|html|css|sql|sh|go|rs|java)$/i.test(
          item.path,
        ),
    );
    for (const item of items.slice(0, limit)) {
      const value = await json<{ content?: string; encoding?: string }>(
        `https://api.github.com/repos/${repo}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
        { headers },
      );
      if (value.encoding !== "base64" || !value.content)
        throw new FlowError(
          `O GitHub não retornou o conteúdo de ${item.path}. Arquivos grandes precisam ser importados separadamente.`,
        );
      documents.push(
        doc(
          Buffer.from(value.content, "base64").toString("utf8"),
          `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${item.path}`,
          { path: item.path, repository: repo },
        ),
      );
    }
    if (tree.truncated || items.length > limit) limited();
  } else if (loaderId === "google-sheets") {
    const id = required(config, "spreadsheetId");
    const range = required(config, "range");
    const result = await json<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`,
      { headers: auth },
    );
    documents = (result.values || []).map((row, i) =>
      doc(
        row.join(" | "),
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`,
        { range, rowInRange: i + 1 },
      ),
    );
  } else if (loaderId === "google-drive") {
    if (!!config.fileId === !!config.folderId)
      throw new FlowError("Informe um arquivo ou uma pasta do Google Drive.");
    type DriveFile = { id: string; name: string; mimeType: string };
    let items: DriveFile[];
    if (config.fileId)
      items = [
        await json<DriveFile>(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.fileId)}?fields=id,name,mimeType&supportsAllDrives=true`,
          { headers: auth },
        ),
      ];
    else {
      if (!/^[\w-]+$/.test(config.folderId))
        throw new FlowError("ID de pasta inválido.");
      const result = await json<{ files: DriveFile[]; nextPageToken?: string }>(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${config.folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`)}&fields=files(id,name,mimeType),nextPageToken&pageSize=${limit}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: auth },
      );
      items = result.files;
      if (result.nextPageToken) limited();
    }
    for (const item of items) {
      const native = item.mimeType.startsWith("application/vnd.google-apps.");
      const exportType = item.mimeType.endsWith("spreadsheet")
        ? [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xlsx",
          ]
        : item.mimeType.endsWith("presentation")
          ? [
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              ".pptx",
            ]
          : ["text/plain", ".txt"];
      const url =
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}` +
        (native
          ? `/export?mimeType=${encodeURIComponent(exportType[0])}`
          : "?alt=media&supportsAllDrives=true");
      const bytes = await transport.bytes(url, { headers: auth, signal });
      const parsed = await parseKnowledgeFile(
        native ? item.name + exportType[1] : item.name,
        bytes,
      );
      documents.push(
        ...parsed.map((d) => ({
          ...d,
          metadata: {
            ...d.metadata,
            source: `https://drive.google.com/file/d/${item.id}/view`,
            fileName: item.name,
          },
        })),
      );
    }
  } else if (loaderId === "s3" || loaderId === "s3-directory") {
    const { S3Client, GetObjectCommand, ListObjectsV2Command } = await import(
      "@aws-sdk/client-s3"
    );
    const client = new S3Client({
      region: required(config, "region"),
      credentials: {
        accessKeyId: required(config, "accessKeyId"),
        secretAccessKey: required(config, "secretAccessKey"),
        sessionToken: config.sessionToken || undefined,
      },
    });
    try {
      const Bucket = required(config, "bucket");
      let keys = [config.key];
      if (loaderId === "s3-directory") {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: config.prefix || undefined,
            MaxKeys: limit,
          }),
          { abortSignal: signal },
        );
        keys = (response.Contents || []).flatMap((x) =>
          x.Key && !x.Key.endsWith("/") ? [x.Key] : [],
        );
        if (response.IsTruncated) limited();
      }
      for (const Key of keys) {
        const item = await client.send(new GetObjectCommand({ Bucket, Key }), {
          abortSignal: signal,
        });
        if (!item.Body || (item.ContentLength || 0) > 10 * 1024 * 1024) {
          item.Body?.transformToWebStream().cancel();
          throw new FlowError("O objeto S3 está vazio ou excede 10 MB.");
        }
        const parts: Uint8Array[] = [];
        let size = 0;
        const reader = item.Body.transformToWebStream().getReader();
        try {
          while (true) {
            const { done, value: part } = await reader.read();
            if (done) break;
            size += part.byteLength;
            if (size > 10 * 1024 * 1024)
              throw new FlowError("O objeto S3 excede 10 MB.");
            parts.push(part);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        documents.push(
          ...(await parseKnowledgeFile(Key, Buffer.concat(parts))).map((d) => ({
            ...d,
            metadata: { ...d.metadata, source: `s3://${Bucket}/${Key}` },
          })),
        );
      }
    } finally {
      client.destroy();
    }
  } else if (loaderId === "custom") {
    const input = jsonObject(config.input || "{}");
    const { Sandbox } = await import("@e2b/code-interpreter");
    const sandbox = await Sandbox.create({
      apiKey: required(config, "token"),
      timeoutMs: 60000,
    });
    try {
      signal?.throwIfAborted();
      const execution = await sandbox.runCode(
        `const input = ${JSON.stringify(input)};\nconst result = await (async () => {\n${required(config, "code")}\n})();\nconsole.log("__KNOWLEDGE_RESULT__" + JSON.stringify(result));`,
        { language: "javascript", timeoutMs: 45000 },
      );
      if (execution.error)
        throw new FlowError(
          "O extrator personalizado falhou. Confira o código e as variáveis de entrada.",
        );
      const output =
        execution.logs.stdout.join("\n").split("__KNOWLEDGE_RESULT__").pop() ||
        "";
      try {
        documents = JSON.parse(output);
      } catch {
        throw new FlowError(
          "O código deve retornar uma lista de documentos com pageContent e metadata.",
        );
      }
    } finally {
      await sandbox.kill();
    }
  }
  signal?.throwIfAborted();
  return { documents: validateDocs(documents), warnings };
}
