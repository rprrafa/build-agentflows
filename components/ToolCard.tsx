"use client";
import { useId, useState, type ReactNode } from "react";
import { Icon, IconButton } from "./StudioUI";
export function ToolCard({ title, status, kind, onRemove, initiallyOpen = true, children }: {
  title: string; status: string; kind: "tool" | "mcp"; onRemove?: () => void; initiallyOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return <section className="agent-tool-card" aria-label={title}>
    <header>
      <button type="button" className="tool-card-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="tool-card-icon"><Icon name={kind === "mcp" ? "link" : "tool"} size={18} /></span>
        <span className="tool-card-heading"><strong>{title}</strong><small>{status}</small></span>
        <span className={open ? "tool-card-chevron open" : "tool-card-chevron"}><Icon name="chevron" size={16} /></span>
      </button>
      {onRemove && <IconButton icon="trash" label={`Remover ${title} deste agente`} onClick={onRemove} />}
    </header>
    <div id={id} className="tool-card-body" hidden={!open}>{children}</div>
  </section>;
}
