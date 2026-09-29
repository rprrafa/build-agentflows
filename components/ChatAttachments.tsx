"use client";
import Image from "next/image";
import { fileSize, type Attachment } from "@/lib/attachment-types";
import { Icon } from "./StudioUI";

export function ChatAttachments({ items, onRemove, disabled }: {
  items: Attachment[]; onRemove?: (id: string) => void; disabled?: boolean;
}) {
  if (!items.length) return null;
  return <ul className="chat-attachments" aria-label="Anexos da mensagem">
    {items.map((a) => <li key={a.id}>
      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" title={`Abrir ${a.name}`}>
        {a.kind === "image" ? <Image src={`/api/attachments/${a.id}`} alt="" width={40} height={40} unoptimized /> : <span className="attachment-document"><Icon name="book" size={20} /></span>}
        <span><strong>{a.name}</strong><small>{fileSize(a.size)}{a.kind === "document" ? " · texto extraído" : ""}</small></span>
      </a>
      {onRemove && <button type="button" disabled={disabled} aria-label={`Remover ${a.name}`} onClick={() => onRemove(a.id)}><Icon name="close" size={14} /></button>}
    </li>)}
  </ul>;
}
