import test from "node:test";
import assert from "node:assert/strict";
import { generateMedia, mediaOutputUrl, type MediaRequest } from "./media-provider";
import { MEDIA_MODELS, validateMediaConfig } from "./media-models";
import { knowledgeFetch } from "./knowledge-http";

const signal = () => new AbortController().signal;
for (const model of MEDIA_MODELS) {
  test(`${model.provider}: autenticação, uma submissão, polling e download sem vazar chave`, async () => {
    const requests: { url: string; init?: RequestInit }[] = [], submitted: MediaRequest[] = [];
    const bytes = Buffer.from("image bytes"), key = "owner-private-key";
    const result = await generateMedia({ model: model.id, key, prompt: "Uma paisagem", signal: signal(), onSubmitted: async (request) => { submitted.push(request); } }, {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        const headers = new Headers(init?.headers);
        assert.equal(init?.redirect, "error");
        assert.equal(headers.get(model.provider === "muapi" ? "x-api-key" : "authorization"), model.provider === "muapi" ? key : `${model.provider === "replicate" ? "Bearer" : "Key"} ${key}`);
        if (requests.length === 1) {
          const body = JSON.parse(String(init?.body));
          assert.equal(model.provider === "replicate" ? body.input.prompt : body.prompt, "Uma paisagem");
          assert.equal(init?.method, "POST");
          return Response.json({ id: "request-1", request_id: "request-1", status: "processing", status_url: "https://evil.example/steal", cancel_url: "https://evil.example/steal" });
        }
        assert.equal(submitted.length, 1, "identificação persistida antes de consultar");
        assert.equal(init?.method, "GET");
        return Response.json({ status: model.provider === "replicate" ? "succeeded" : "completed", output: "https://cdn.example/image.png", outputs: ["https://cdn.example/image.png"], images: [{ url: "https://cdn.example/image.png" }] });
      },
      download: async (url, options) => { assert.equal(url, "https://cdn.example/image.png"); assert.equal(options?.headers, undefined); assert.equal(options?.maxBytes, 10485760); return bytes; },
      pause: async () => {},
    });
    assert.deepEqual(result, [bytes]);
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, model.provider === "replicate" ? /\/v1\/predictions\/request-1$/ : model.provider === "higgsfield" ? /\/requests\/request-1\/status$/ : /\/api\/v1\/predictions\/request-1\/result$/);
    assert.ok(requests.every((request) => !request.url.includes("evil.example")));
  });
  test(`${model.provider}: cancelar interrompe consultas, sem nova geração`, async () => {
    const controller = new AbortController(), requests: string[] = [];
    await assert.rejects(generateMedia({ model: model.id, key: "private", prompt: "Teste", signal: controller.signal,
      onSubmitted: async () => { controller.abort(); },
    }, {
      fetch: async (url, init) => {
        requests.push(String(url));
        assert.equal(init?.signal?.aborted, false, "cancelamento remoto usa sinal independente");
        return requests.length === 1 ? Response.json({ id: "id-1", request_id: "id-1", status: "queued" }) : new Response(null, { status: 202 });
      },
      download: async () => { throw new Error("não deve baixar"); }, pause: async () => { throw new Error("não deve consultar"); },
    }), /pode continuar no provedor/);
    assert.equal(requests.length, model.provider === "muapi" ? 1 : 2);
    if (requests.length === 2) assert.ok(requests[1].endsWith("/id-1/cancel"));
  });
}

test("submissão ambígua não é repetida e erros não revelam segredos", async () => {
  let count = 0;
  for (const response of [null, new Response("private-key secret prompt", { status: 401 })]) {
    await assert.rejects(generateMedia({ model: MEDIA_MODELS[0].id, key: "private-key", prompt: "secret prompt", signal: signal(), onSubmitted: async () => {} }, {
      fetch: async () => { count++; if (!response) throw new Error("private-key secret prompt"); return response; }, download: async () => Buffer.alloc(0), pause: async () => {},
    }), (error: Error) => { assert.doesNotMatch(error.message, /private-key|secret prompt/); return true; });
  }
  assert.equal(count, 2);
});
test("Replicate aceita referência inline e autentica apenas seu domínio de entrega", async () => {
  for (const host of ["replicate.delivery", "output.replicate.delivery", "replicate.delivery.evil.example"]) {
    await generateMedia({ model: MEDIA_MODELS[0].id, key: "token", prompt: "Edite", images: ["data:image/png;base64,YQ=="], signal: signal(), onSubmitted: async () => {} }, {
      fetch: async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)).input.image_input, ["data:image/png;base64,YQ=="]);
        return Response.json({ id: "id", status: "succeeded", output: [`https://${host}/image.png`] });
      },
      download: async (_url, options) => { assert.equal(options?.headers?.Authorization, host.endsWith("evil.example") ? undefined : "Bearer token"); return Buffer.from("png"); }, pause: async () => {},
    });
  }
});
test("modelos e recursos incompatíveis são recusados antes de qualquer cobrança", async () => {
  let calls = 0;
  const dependencies = { fetch: async () => { calls++; return Response.json({}); }, download: async () => Buffer.alloc(0), pause: async () => {} };
  for (const [model, images, prompt] of [["replicate:arbitrary/path", [], "Teste"], [MEDIA_MODELS[1].id, ["data:image/png;base64,YQ=="], "Teste"], [MEDIA_MODELS[0].id, ["https://private.example/file"], "Teste"], [MEDIA_MODELS[0].id, [], "x".repeat(20001)]] as [string, string[], string][]) {
    await assert.rejects(generateMedia({ model, images, prompt, key: "x", signal: signal(), onSubmitted: async () => {} }, dependencies));
  }
  assert.equal(calls, 0);
  for (const config of [{ tools: "builtin:http" }, { memoryType: "conversationSummary" }, { knowledgeBase: "base" }] as Record<string, string>[])
    assert.throws(() => validateMediaConfig({ model: MEDIA_MODELS[0].id, ...config }));
  validateMediaConfig({ model: MEDIA_MODELS[0].id, memoryType: "windowSize" });
});
test("respostas inválidas, excesso de bytes e saída sem imagens falham sem baixar", async () => {
  for (const response of [new Response("not json"), new Response("x".repeat(1024 * 1024 + 1)), Response.json({ id: "../steal", status: "queued" }), Response.json({ id: "id", status: "failed", error: "private-key" }), Response.json({ id: "id", status: "succeeded", output: [] })]) {
    await assert.rejects(generateMedia({ model: MEDIA_MODELS[0].id, key: "private-key", prompt: "Teste", signal: signal(), onSubmitted: async () => {} }, {
      fetch: async () => response, download: async () => { throw new Error("não deve baixar"); }, pause: async () => {},
    }), (error: Error) => { assert.doesNotMatch(error.message, /private-key|não deve baixar/); return true; });
  }
  for (const url of ["http://example.com/image", "https://user:pass@example.com/image", "file:///tmp/file", "data:image/png;base64,YQ=="]) assert.throws(() => mediaOutputUrl(url));
});

test("download real recusa endereços internos antes de abrir conexão", async () => {
  for (const host of ["127.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]"]) {
    await assert.rejects(generateMedia({ model: MEDIA_MODELS[0].id, key: "token", prompt: "Teste", signal: signal(), onSubmitted: async () => {} }, {
      fetch: async () => Response.json({ id: "id", status: "succeeded", output: `https://${host}/image.png` }),
      download: knowledgeFetch, pause: async () => {},
    }), /endereço público/);
  }
});

test("falha ao persistir identificação cancela a solicitação sem consultar ou reenviar", async () => {
  const requests: string[] = [];
  await assert.rejects(generateMedia({ model: MEDIA_MODELS[0].id, key: "token", prompt: "Teste", signal: signal(), onSubmitted: async () => { throw new Error("lease expirada"); } }, {
    fetch: async (url) => { requests.push(String(url)); return Response.json({ id: "id", status: "starting" }); },
    download: async () => { throw new Error("não deve baixar"); }, pause: async () => { throw new Error("não deve consultar"); },
  }), /lease expirada/);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].endsWith("/v1/predictions/id/cancel"));
});
