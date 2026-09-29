import type { KnowledgeField, LoaderDefinition } from "./knowledge-types";
const url: KnowledgeField = {
  key: "url",
  label: "Endereço",
  required: true,
  placeholder: "https://exemplo.com",
};
const token: KnowledgeField = {
  key: "token",
  label: "Chave de acesso",
  type: "secret",
  required: true,
};
const limit: KnowledgeField = {
  key: "limit",
  label: "Máximo de documentos",
  type: "number",
  placeholder: "20",
  help: "Entre 1 e 100. A extração avisa se esse limite for alcançado.",
};
const bucket: KnowledgeField[] = [
  { key: "bucket", label: "Bucket", required: true },
  { key: "region", label: "Região", required: true, placeholder: "us-east-1" },
  {
    key: "accessKeyId",
    label: "Access key ID",
    type: "secret",
    required: true,
  },
  {
    key: "secretAccessKey",
    label: "Secret access key",
    type: "secret",
    required: true,
  },
  { key: "sessionToken", label: "Token de sessão (opcional)", type: "secret" },
];
const file = (
  id: string,
  name: string,
  description: string,
  accept: string,
  fields: KnowledgeField[] = [],
): LoaderDefinition => ({ id, name, description, accept, fields });
export const KNOWLEDGE_LOADERS: LoaderDefinition[] = (
  [
    {
      id: "apify",
      name: "Apify Website Content Crawler",
      description:
        "Extrai páginas de um site com o ator Website Content Crawler.",
      fields: [url, token, limit],
    },
    {
      id: "cheerio",
      name: "Cheerio Web Scraper",
      description: "Lê páginas HTML e acompanha links do mesmo site.",
      fields: [
        url,
        {
          key: "selector",
          label: "Seletor CSS",
          placeholder: "main",
          help: "Em branco, extrai o corpo da página.",
        },
        limit,
      ],
    },
    file(
      "csv",
      "Csv File",
      "Transforma cada linha da tabela em um documento.",
      ".csv",
      [
        {
          key: "column",
          label: "Coluna de conteúdo (opcional)",
          help: "Em branco, inclui todas as colunas.",
        },
      ],
    ),
    {
      id: "custom",
      name: "Custom Document Loader",
      description:
        "Executa JavaScript em ambiente remoto isolado E2B e recebe documentos.",
      fields: [
        { ...token, label: "Chave E2B" },
        {
          key: "code",
          label: "Função JavaScript",
          type: "textarea",
          required: true,
          placeholder:
            'return [{ pageContent: "Meu conteúdo", metadata: { source: "Minha fonte" } }];',
          help: "Use return para devolver uma lista com pageContent e metadata. Variáveis de entrada ficam em input.",
        },
        {
          key: "input",
          label: "Variáveis de entrada (JSON)",
          type: "textarea",
          placeholder: "{}",
        },
      ],
    },
    file(
      "docx",
      "Docx File",
      "Extrai o texto de documentos Word no formato DOCX.",
      ".docx",
    ),
    {
      id: "firecrawl",
      name: "FireCrawl",
      description: "Converte uma página em texto com o Firecrawl.",
      fields: [url, token],
    },
    {
      id: "github",
      name: "Github",
      description:
        "Lê arquivos de texto de um repositório e preserva o caminho de origem.",
      fields: [
        {
          key: "repository",
          label: "Repositório",
          required: true,
          placeholder: "organizacao/repositorio",
        },
        { key: "branch", label: "Branch ou referência", placeholder: "main" },
        { key: "path", label: "Pasta ou arquivo (opcional)" },
        {
          ...token,
          required: false,
          label: "Token GitHub (para repositórios privados)",
        },
        limit,
      ],
    },
    {
      id: "google-drive",
      name: "Google Drive",
      description:
        "Importa um arquivo ou os arquivos de uma pasta do Google Drive.",
      fields: [
        { key: "fileId", label: "ID do arquivo (ou informe uma pasta)" },
        { key: "folderId", label: "ID da pasta" },
        {
          ...token,
          label: "Token OAuth Google",
          help: "Precisa de permissão de leitura no Drive.",
        },
        limit,
      ],
    },
    {
      id: "google-sheets",
      name: "Google Sheets",
      description: "Extrai linhas de um intervalo de uma planilha Google.",
      fields: [
        { key: "spreadsheetId", label: "ID da planilha", required: true },
        {
          key: "range",
          label: "Intervalo",
          required: true,
          placeholder: "Página1!A1:F1000",
        },
        { ...token, label: "Token OAuth Google" },
      ],
    },
    file(
      "json",
      "JSON File",
      "Cria documentos a partir de objetos ou listas JSON.",
      ".json",
      [
        {
          key: "pointer",
          label: "Caminho da lista (opcional)",
          placeholder: "dados.itens",
        },
      ],
    ),
    file(
      "excel",
      "Microsoft Excel",
      "Extrai o conteúdo de planilhas Excel.",
      ".xlsx,.ods",
    ),
    file(
      "powerpoint",
      "Microsoft Power Point",
      "Extrai o texto de apresentações, incluindo notas.",
      ".pptx,.odp",
    ),
    file(
      "word",
      "Microsoft Word",
      "Extrai o conteúdo de documentos Word e OpenDocument.",
      ".docx,.odt",
    ),
    file(
      "pdf",
      "PDF File",
      "Extrai o texto por página. PDFs digitalizados precisam de texto reconhecido previamente.",
      ".pdf",
    ),
    {
      id: "plain",
      name: "Plain Text",
      description: "Adicione conteúdo colando ou escrevendo o texto.",
      fields: [
        { key: "text", label: "Texto", type: "textarea", required: true },
      ],
    },
    {
      id: "s3",
      name: "S3",
      description: "Importa um objeto de um bucket Amazon S3.",
      fields: [
        ...bucket,
        { key: "key", label: "Chave do objeto", required: true },
      ],
    },
    {
      id: "s3-directory",
      name: "S3 Directory",
      description: "Importa os arquivos de um prefixo de um bucket Amazon S3.",
      fields: [
        ...bucket,
        { key: "prefix", label: "Prefixo da pasta (opcional)" },
        limit,
      ],
    },
    {
      id: "searchapi",
      name: "SearchAPI For Web Search",
      description:
        "Transforma resultados de uma pesquisa web em documentos com referência.",
      fields: [{ key: "query", label: "Pesquisa", required: true }, token],
    },
    {
      id: "spider",
      name: "Spider Document Loaders",
      description: "Extrai páginas de um site usando o Spider.",
      fields: [url, token, limit],
    },
    file(
      "text",
      "TextFile",
      "Importa arquivos de texto e Markdown.",
      ".txt,.md,.markdown,.log",
    ),
  ] satisfies LoaderDefinition[]
).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
export function knowledgeLoaderIcon(id: string) {
  return `/knowledge-icons/loaders-${id}.${id === "firecrawl" ? "png" : "svg"}`;
}
export function knowledgeLoader(id: string) {
  return KNOWLEDGE_LOADERS.find((item) => item.id === id);
}
