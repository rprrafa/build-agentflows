"use client";
import { useState } from "react";
import type { KnowledgeChoice } from "@/lib/knowledge-providers";
import { Icon, Modal } from "./StudioUI";
export function KnowledgeLogo({ src }: { src: string }) {
  // Logos locais da referência Flowise.
  return (
    <span className="knowledge-provider-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={32} height={32} />
    </span>
  );
}
export function KnowledgeProviderSelect({
  title,
  value,
  options,
  disabled,
  onChange,
}: {
  title: string;
  value: string;
  options: KnowledgeChoice[];
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const selected = options.find((p) => p.id === value);
  const shown = options.filter((p) =>
    p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="knowledge-provider-select">
      <span>{title}</span>
      <button
        type="button"
        className="knowledge-provider-trigger"
        disabled={disabled}
        aria-label={title}
        aria-haspopup="dialog"
        onClick={() => {
          setSearch("");
          setOpen(true);
        }}
      >
        {selected && <KnowledgeLogo src={selected.icon} />}
        <span>
          <strong>
            {selected?.name ||
              (value === "local"
                ? "Armazenamento local (configuração anterior)"
                : value === "none"
                  ? "Sem Record Manager (configuração anterior)"
                  : "Selecionar")}
          </strong>
          {selected && <small>{selected.description}</small>}
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {open && (
        <Modal
          title={title}
          wide
          className="knowledge-modal"
          onClose={() => setOpen(false)}
        >
          <div className="studio-search knowledge-provider-search">
            <Icon name="search" size={18} />
            <input
              autoFocus
              aria-label={`Buscar ${title.toLocaleLowerCase()}`}
              placeholder="Buscar"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />
          </div>
          <div className="knowledge-provider-options">
            {shown.map((p) => (
              <button
                type="button"
                key={p.id}
                aria-pressed={p.id === value}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <KnowledgeLogo src={p.icon} />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.description}</small>
                </span>
                {p.id === value && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
          {!shown.length && <p>Nenhuma opção encontrada.</p>}
        </Modal>
      )}
    </div>
  );
}
