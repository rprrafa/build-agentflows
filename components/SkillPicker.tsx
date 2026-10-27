"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_AGENT_SKILLS, type SkillSummary } from "@/lib/skill-settings";
import { Icon, Modal, request } from "./StudioUI";
import { MarkdownContent } from "./MarkdownContent";

type SkillDetails = SkillSummary & { body: string };
const tokens = (value: number) => `≈ ${value.toLocaleString("pt-BR")} tokens`;
const splitIds = (value: string) => value.split(",").map((id) => id.trim()).filter(Boolean);

// Fecha o menu por clique fora ou Esc, como os demais menus do editor.
function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open, close]);
  return ref;
}

/** Habilidades do Agente: o modelo recebe nome e descrição e carrega o SKILL.md sob demanda. */
export function SkillPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tipId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<SkillSummary[] | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uploading, setUploading] = useState(false),
    [menu, setMenu] = useState(false),
    [cardMenu, setCardMenu] = useState<string | null>(null),
    [viewing, setViewing] = useState<SkillDetails | null>(null),
    [deleting, setDeleting] = useState(false);
  const addRef = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  const cardRef = useDismiss<HTMLUListElement>(cardMenu !== null, () => setCardMenu(null));
  const ids = splitIds(value);
  useEffect(() => {
    let alive = true;
    void request<SkillSummary[]>("/api/skills")
      .then((list) => { if (alive) setSkills(list); })
      .catch((e) => { if (alive) { setSkills([]); setError(e instanceof Error ? e.message : "Não foi possível carregar as habilidades."); } });
    return () => { alive = false; };
  }, []);
  const selected = ids.map((id) => skills?.find((skill) => skill.id === id) || { id, missing: true as const });
  const available = (skills || []).filter((skill) => !ids.includes(skill.id));
  const chosen = selected.filter((skill): skill is SkillSummary => !("missing" in skill));
  const save = (next: string[]) => onChange(next.join(","));

  async function upload(file: File) {
    setUploading(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/skills", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar a habilidade.");
      const skill = data as SkillSummary & { replaced: boolean };
      setSkills((list) => [...(list || []).filter((item) => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name)));
      if (!ids.includes(skill.id)) {
        if (ids.length >= MAX_AGENT_SKILLS) throw new Error(`A habilidade foi salva na conta, mas o agente já tem ${MAX_AGENT_SKILLS} habilidades.`);
        save([...ids, skill.id]);
      }
      setNotice(skill.replaced ? `Habilidade “${skill.name}” atualizada. Agentes que já a usam recebem a nova versão nas próximas execuções.` : `Habilidade “${skill.name}” adicionada.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar a habilidade.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function open(id: string) {
    setError("");
    try { setViewing(await request<SkillDetails>(`/api/skills/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir a habilidade."); }
  }
  async function remove(skill: SkillSummary) {
    setDeleting(true); setError("");
    try {
      await request(`/api/skills/${skill.id}`, "DELETE");
      setSkills((list) => (list || []).filter((item) => item.id !== skill.id));
      save(ids.filter((id) => id !== skill.id));
      setViewing(null);
      setNotice(`Habilidade “${skill.name}” excluída da conta.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir a habilidade."); }
    finally { setDeleting(false); }
  }
  const pick = () => { setMenu(false); fileInput.current?.click(); };
  const fixed = chosen.reduce((sum, skill) => sum + skill.headerTokens, 0);
  const onDemand = chosen.reduce((sum, skill) => sum + skill.bodyTokens, 0);

  return (
    <section className="skill-picker node-fields" aria-label="Habilidades do agente">
      <div className="skill-picker-title">
        <strong>Habilidades</strong>
        <span className="skill-info" tabIndex={0} aria-describedby={tipId}>
          <Icon name="info" size={16} />
          <span role="tooltip" id={tipId}>As habilidades dão ao seu agente recursos especializados e reutilizáveis, empacotados como um arquivo SKILL.md ou um .zip com uma pasta de habilidade de nível superior que contém o manifesto SKILL.md e arquivos relacionados. O agente recebe só o nome e a descrição e carrega o conteúdo quando a tarefa pede.</span>
        </span>
        <div className="skill-add" ref={addRef}>
          <button type="button" className="skill-add-main" onClick={pick} disabled={uploading || ids.length >= MAX_AGENT_SKILLS}>
            {uploading ? <span className="studio-spinner" /> : <Icon name="plus" size={16} />}{uploading ? "Enviando…" : "Adicionar"}
          </button>
          <button type="button" className="skill-add-toggle" aria-haspopup="menu" aria-expanded={menu} aria-label="Mais opções para adicionar habilidades" onClick={() => setMenu(!menu)} disabled={uploading || ids.length >= MAX_AGENT_SKILLS}>
            <Icon name="chevron" size={14} />
          </button>
          {menu && <div className="skill-menu" role="menu">
            <button type="button" role="menuitem" onClick={pick}><Icon name="upload" size={15} />Enviar SKILL.md ou .zip</button>
            {!!available.length && <span className="skill-menu-heading">Habilidades da conta</span>}
            {available.map((skill) => <button type="button" role="menuitem" key={skill.id} onClick={() => { setMenu(false); save([...ids, skill.id]); }} title={skill.description}>
              <Icon name="skill" size={15} /><span>{skill.name}</span>
            </button>)}
            {skills === null && <span className="skill-menu-heading">Carregando habilidades…</span>}
          </div>}
        </div>
      </div>
      <input ref={fileInput} type="file" hidden accept=".md,.zip,text/markdown,application/zip" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
      {error && <p className="studio-error" role="alert">{error}</p>}
      {notice && <p className="skill-notice" role="status">{notice}</p>}
      {!ids.length && <small>Nenhuma habilidade. Envie um SKILL.md (com name e description no cabeçalho YAML) ou um .zip com a pasta da habilidade.</small>}
      {!!selected.length && <ul className="skill-list" ref={cardRef}>
        {selected.map((skill) => "missing" in skill ? <li className="skill-card missing" key={skill.id}>
          <div className="skill-card-main"><Icon name="skill" size={22} /><span><strong>Habilidade não encontrada</strong><small>{skills === null ? "Carregando…" : "Foi excluída da conta. Remova-a deste agente."}</small></span></div>
          <button type="button" className="skill-card-more" aria-label="Remover habilidade não encontrada" onClick={() => save(ids.filter((id) => id !== skill.id))}><Icon name="trash" size={16} /></button>
        </li> : <li className="skill-card" key={skill.id}>
          <button type="button" className="skill-card-main" onClick={() => void open(skill.id)} aria-label={`Ver habilidade ${skill.name}`}>
            <Icon name="skill" size={22} />
            <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
            <Icon name="chevron" size={16} />
          </button>
          <div className="skill-card-actions">
            <button type="button" className="skill-card-more" aria-haspopup="menu" aria-expanded={cardMenu === skill.id} aria-label={`Ações de ${skill.name}`} onClick={() => setCardMenu(cardMenu === skill.id ? null : skill.id)}><Icon name="more" size={18} /></button>
            {cardMenu === skill.id && <div className="skill-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setCardMenu(null); void open(skill.id); }}><Icon name="book" size={15} />Ver conteúdo</button>
              <button type="button" role="menuitem" onClick={() => { setCardMenu(null); pick(); }}><Icon name="upload" size={15} />Enviar nova versão</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setCardMenu(null); save(ids.filter((id) => id !== skill.id)); }}><Icon name="close" size={15} />Remover do agente</button>
            </div>}
          </div>
        </li>)}
      </ul>}
      {!!chosen.length && <small className="skill-tokens">Em toda chamada: {tokens(fixed)} (nomes e descrições). Sob demanda: até {tokens(onDemand)} quando o agente carrega os SKILL.md, mais os arquivos que ele ler.</small>}
      {viewing && <Modal title={viewing.name} wide className="skill-dialog" onClose={() => !deleting && setViewing(null)}>
        <p className="skill-dialog-description">{viewing.description}</p>
        <dl className="skill-dialog-info">
          <div><dt>Sempre enviado</dt><dd>{tokens(viewing.headerTokens)}</dd></div>
          <div><dt>Ao carregar o SKILL.md</dt><dd>{tokens(viewing.bodyTokens)}</dd></div>
          <div><dt>Atualizada em</dt><dd>{new Date(viewing.updatedAt).toLocaleString("pt-BR")}</dd></div>
        </dl>
        {!!viewing.files.length && <><h3>Arquivos lidos sob demanda</h3><ul className="skill-dialog-files">{viewing.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul></>}
        {!!viewing.skipped.length && <><h3>Não disponíveis ao agente</h3><ul className="skill-dialog-files">{viewing.skipped.map((file) => <li key={file}><code>{file}</code></li>)}</ul></>}
        <h3>SKILL.md</h3>
        <div className="skill-dialog-body"><MarkdownContent>{viewing.body}</MarkdownContent></div>
        <div className="skill-dialog-actions">
          <button type="button" className="studio-button destructive" disabled={deleting} onClick={() => void remove(viewing)}>
            <Icon name="trash" size={15} />{deleting ? "Excluindo…" : "Excluir da conta"}
          </button>
          <small>Só é possível excluir quando nenhum fluxo salvo usa a habilidade.</small>
        </div>
      </Modal>}
    </section>
  );
}
