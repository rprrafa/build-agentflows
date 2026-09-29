"use client";
import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
export const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }) {
  return <div className="markdown-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer">{alt || "Abrir imagem"}</a>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  }}>{children}</Markdown></div>;
});
