import { FlowError } from "./flow-store";
import { knowledgeJson } from "./knowledge-http";
import { embeddingDimensions } from "./knowledge-providers";
import type { IndexConfig } from "./knowledge-types";
export function validateVectors(value: unknown, count: number): number[][] {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    !value.length ||
    value.some(
      (v) =>
        !Array.isArray(v) ||
        !v.length ||
        v.length > 65536 ||
        v.length !== value[0].length ||
        v.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)) ||
        v.every((n: number) => n === 0),
    )
  )
    throw new FlowError(
      "O serviço retornou embeddings inválidos ou incompletos.",
      502,
    );
  return value;
}
export async function embedKnowledge(
  config: IndexConfig["embeddings"],
  texts: string[],
  signal?: AbortSignal,
  purpose: "document" | "query" = "document",
) {
  if (!texts.length) return [];
  if (config.provider !== "ollama" && !config.apiKey)
    throw new FlowError("Configure a chave do serviço de embeddings.");
  const prepared = config.stripNewLines
    ? texts.map((t) => t.replace(/\r?\n/g, " "))
    : texts;
  const timeout = AbortSignal.timeout(config.timeout || 120000);
  const options = {
    method: "POST",
    infrastructure: true,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  };
  const dimensions = embeddingDimensions(config);
  let vectors: number[][];
  if (config.provider === "gemini") {
    const model = `models/${config.model}`;
    const secondGeneration = config.model === "gemini-embedding-2";
    const response = await knowledgeJson<{
      embeddings: { values: number[] }[];
    }>(`${config.url}/${model}:batchEmbedContents`, {
      ...options,
      headers: { "x-goog-api-key": config.apiKey! },
      body: {
        requests: prepared.map((text) => ({
          model,
          content: {
            parts: [
              {
                text: secondGeneration
                  ? purpose === "query"
                    ? `task: search result | query: ${text}`
                    : `title: none | text: ${text}`
                  : text,
              },
            ],
          },
          ...(secondGeneration
            ? {}
            : {
                taskType:
                  purpose === "query"
                    ? "RETRIEVAL_QUERY"
                    : "RETRIEVAL_DOCUMENT",
              }),
          outputDimensionality: dimensions,
        })),
      },
    });
    vectors = validateVectors(
      response.embeddings?.map((v) => v.values),
      texts.length,
    );
  } else if (config.provider === "ollama") {
    const response = await knowledgeJson<{ embeddings: number[][] }>(
      `${config.url}/api/embed`,
      {
        ...options,
        headers: config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {},
        body: { model: config.model, input: prepared, truncate: false },
      },
    );
    vectors = validateVectors(response.embeddings, texts.length);
  } else {
    const response = await knowledgeJson<{
      data: { index: number; embedding: number[] | string }[];
    }>(`${config.url}/embeddings`, {
      ...options,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: {
        model: config.model,
        input: prepared,
        ...(config.provider === "voyage"
          ? { input_type: purpose, truncation: false }
          : { encoding_format: config.encodingFormat || "float" }),
        ...(dimensions &&
        config.provider === "openai" &&
        config.model.startsWith("text-embedding-3-")
          ? { dimensions }
          : {}),
      },
    });
    if (
      !Array.isArray(response.data) ||
      response.data.length !== texts.length ||
      new Set(response.data.map((v) => v.index)).size !== texts.length ||
      response.data.some(
        (v) =>
          !Number.isInteger(v.index) || v.index < 0 || v.index >= texts.length,
      )
    )
      throw new FlowError(
        "O serviço de embeddings retornou posições inválidas.",
        502,
      );
    vectors = validateVectors(
      response.data.sort((a, b) => a.index - b.index).map((v) => decodeEmbedding(v.embedding)),
      texts.length,
    );
  }
  if (dimensions && vectors.some((v) => v.length !== dimensions))
    throw new FlowError(
      "O modelo retornou um tamanho de vetor diferente do esperado. Confira o modelo e o endereço do serviço.",
      502,
    );
  return vectors;
}

function decodeEmbedding(value: number[] | string): number[] {
  if (typeof value !== "string") return value;
  if (!value || value.length > 349528 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new FlowError("O serviço retornou um embedding base64 inválido.", 502);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length % 4 !== 0 || bytes.length === 0 || bytes.toString("base64") !== value)
    throw new FlowError("O serviço retornou um embedding base64 inválido.", 502);
  return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}
