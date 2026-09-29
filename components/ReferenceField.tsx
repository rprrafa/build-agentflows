"use client";
import { useRef, useState } from "react";
export type Reference = { value: string; label: string; hint?: string };
// Campo de texto com autocompletar: ao digitar "{{" aparece a lista de referências (entrada,
// resultado anterior, variáveis e blocos do fluxo) e a escolha entra como {{...}} no lugar certo.
export function ReferenceField({
  value,
  onChange,
  references,
  multiline = false,
  rows = 3,
  placeholder,
  type = "text",
  spellCheck,
  ariaLabel,
  showOnFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  references: Reference[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  type?: string;
  spellCheck?: boolean;
  ariaLabel?: string;
  showOnFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [start, setStart] = useState(0);
  const replacementEnd = useRef<number | null>(null);
  const options =
    query === null
      ? []
      : references.filter((r) =>
          (r.value + " " + r.label).toLowerCase().includes(query.toLowerCase()),
        );
  const current = options.length ? Math.min(active, options.length - 1) : 0;
  function detect(text: string, caret: number) {
    replacementEnd.current = null;
    const before = text.slice(0, caret);
    const open = before.lastIndexOf("{{");
    if (open === -1 || before.slice(open).includes("}}")) {
      setQuery(null);
      return;
    }
    const q = before.slice(open + 2);
    if (/[\n]/.test(q) || q.length > 40) {
      setQuery(null);
      return;
    }
    setStart(open);
    setQuery(q);
  }
  function showReferences(el: HTMLInputElement | HTMLTextAreaElement) {
    const caret = el.selectionStart ?? 0;
    detect(el.value, caret);
    if (!showOnFocus) return;
    const before = el.value.slice(0, caret), open = before.lastIndexOf("{{");
    if (open >= 0 && !before.slice(open).includes("}}")) return;
    // A click inside an existing reference replaces that reference as a whole.
    const token = [...el.value.matchAll(/\{\{[^{}]*\}\}/g)].find((match) => match.index <= caret && match.index + match[0].length >= caret);
    setStart(token ? token.index : caret);
    replacementEnd.current = token ? token.index + token[0].length : el.selectionEnd ?? caret;
    setQuery(""); setActive(0);
  }
  function pick(r: Reference) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = value.slice(0, start) + r.value + value.slice(replacementEnd.current ?? caret);
    onChange(next);
    setQuery(null);
    replacementEnd.current = null;
    const pos = start + r.value.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }
  const shared = {
    value,
    placeholder,
    "aria-label": ariaLabel,
    "aria-autocomplete": "list" as const,
    "aria-expanded": options.length > 0,
    onChange: (
      e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
    ) => {
      onChange(e.target.value);
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!options.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((current + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((current - 1 + options.length) % options.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[current]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
      }
    },
    onBlur: () => setQuery(null),
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => { if (showOnFocus) showReferences(e.currentTarget); },
    onClick: (e: React.MouseEvent<HTMLTextAreaElement | HTMLInputElement>) => showReferences(e.currentTarget),
  };
  return (
    <div className="reference-field">
      {multiline ? (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          rows={rows}
          spellCheck={spellCheck}
          {...shared}
        />
      ) : (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type={type}
          spellCheck={spellCheck}
          {...shared}
        />
      )}
      {options.length > 0 && (
        <ul className="reference-menu" role="listbox">
          {options.map((r, i) => (
            <li
              key={r.value}
              role="option"
              aria-selected={i === current}
              className={i === current ? "active" : ""}
              onPointerDown={(e) => e.preventDefault()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); pick(r); }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>{r.label}</strong>
              <code>{r.value}</code>
              {r.hint && <small>{r.hint}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
