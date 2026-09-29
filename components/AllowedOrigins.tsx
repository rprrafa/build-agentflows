"use client";
import { useId } from "react";
import { Icon, IconButton } from "./StudioUI";

export function AllowedOrigins({ origins, onChange, disabled = false, description, emptyText }: {
  origins: string[];
  onChange: (origins: string[]) => void;
  disabled?: boolean;
  description: string;
  emptyText: string;
}) {
  const id = useId();
  return <section className="allowed-origins" aria-labelledby={id}>
    <div className="allowed-origins-description">
      <h3 id={id}>Domínios permitidos</h3>
      <p>{description}</p>
    </div>
    <div className="allowed-origins-editor">
      <div className="allowed-origins-heading">
        <span>{origins.length} de 20 domínios</span>
        <button type="button" className="studio-button" disabled={disabled || origins.length >= 20} onClick={() => onChange([...origins, ""])}>
          <Icon name="plus" size={16} />Adicionar domínio
        </button>
      </div>
      {origins.length ? <ul className="allowed-origins-list">
        {origins.map((origin, index) => <li key={index}>
          <Icon name="link" size={17} />
          <input aria-label={`Domínio permitido ${index + 1}`} type="url" autoComplete="off" spellCheck={false} placeholder="https://app.exemplo.com" value={origin} disabled={disabled} onChange={(event) => onChange(origins.map((value, i) => i === index ? event.target.value : value))} />
          <IconButton icon="trash" label={`Remover domínio ${index + 1}`} disabled={disabled} onClick={() => onChange(origins.filter((_, i) => i !== index))} />
        </li>)}
      </ul> : <div className="allowed-origins-empty">{emptyText}</div>}
      <small>Use o endereço completo com https://, sem caminhos. Para testes locais, use http://localhost com a porta.</small>
    </div>
  </section>;
}
