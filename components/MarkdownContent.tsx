"use client";
import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
export const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }) {
  return <div className="markdown-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => typeof src === "string" && /^\/api\/attachments\/[0-9a-f-]{36}$/.test(src)
      ? <a href={src} target="_blank" rel="noopener noreferrer"><Image src={src} alt={alt || "Imagem gerada"} width={1024} height={1024} unoptimized style={{ maxWidth: "100%", width: "auto", height: "auto", maxHeight: 600 }} /></a>
      : <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">{alt || "Abrir imagem"}</a>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  }}>{children}</Markdown></div>;
});
