"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon, IconButton, Modal, request } from "./StudioUI";
import {
  describeSchedule, formatScheduleInstant, scheduleDraft, SCHEDULE_FREQUENCIES, SCHEDULE_STATUS_LABEL, SCHEDULES_PER_FLOW, WEEKDAYS,
  type FlowSchedule, type ScheduleDefinition, type ScheduleStatus,
} from "@/lib/flow-schedules";

// Prompts agendados do Início. O diálogo do bloco mostra só o resumo; criar, editar, pausar,
// executar e excluir acontecem no modal "Gerenciar agendamentos". Cada ação grava na hora pela
// API própria do fluxo, sem passar pelo grafo nem pelo botão Salvar do editor.

const endpoint = (flowId: string, id?: string) => `/api/flows/${encodeURIComponent(flowId)}/agendamentos${id ? "/" + encodeURIComponent(id) : ""}`;
const GROUPS: ScheduleStatus[] = ["active", "paused", "ended"];
const GROUP_LABEL: Record<ScheduleStatus, string> = { active: "Ativos", paused: "Pausados", ended: "Encerrados" };
const SUMMARY_LIMIT = 3;

function nextLabel(s: FlowSchedule) {
  if (s.status === "active" && s.nextRunAt) return `Próxima execução em ${formatScheduleInstant(s.nextRunAt)}`;
  if (s.status === "paused") return "Pausado";
  return "Sem próximas execuções";
}

/** Resumo exibido no diálogo do Início. */
export function ScheduleSummary({ flowId }: { flowId?: string }) {
  const [schedules, setSchedules] = useState<FlowSchedule[] | null>(null);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const load = useCallback(() => {
    if (!flowId) return;
    request<{ agendamentos: FlowSchedule[] }>(endpoint(flowId)).then((r) => { setSchedules(r.agendamentos); setError(""); })
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar os agendamentos."));
  }, [flowId]);
  useEffect(load, [load]);
  const active = (schedules || []).filter((s) => s.status === "active");
  const shown = [...active, ...(schedules || []).filter((s) => s.status !== "active")].slice(0, SUMMARY_LIMIT);
  return (
    <section className="node-fields schedule-summary">
      <strong>Prompts agendados</strong>
      <small>Envie prompts ao fluxo em horários definidos. Cada envio vira uma execução própria, sem alterar as chamadas pela API.</small>
      {!flowId ? <small>Salve o fluxo para agendar prompts.</small> : error ? <small role="alert">{error}</small> : schedules === null ? <small>Carregando…</small> : <>
        {schedules.length > 0 && <ul className="schedule-summary-list">
          {shown.map((s) => <li key={s.id} className={s.status}>
            <Icon name="clock" size={16} />
            <div><span title={s.prompt}>{s.prompt}</span><small>{nextLabel(s)}</small></div>
          </li>)}
          {schedules.length > shown.length && <li className="more"><small>Mais {schedules.length - shown.length} {schedules.length - shown.length === 1 ? "agendamento" : "agendamentos"}</small></li>}
        </ul>}
        <button type="button" className="studio-button" onClick={() => setManaging(true)}>
          <Icon name={schedules.length ? "clock" : "plus"} size={16} />
          {schedules.length ? `Gerenciar agendamentos (${schedules.length})` : "Agendar prompt"}
        </button>
      </>}
      {managing && flowId && <ScheduleManager flowId={flowId} initial={schedules} startNew={!schedules?.length}
        onChange={setSchedules} onClose={() => { setManaging(false); load(); }} />}
    </section>
  );
}

function ScheduleManager({ flowId, initial, startNew, onChange, onClose }: {
  flowId: string; initial: FlowSchedule[] | null; startNew: boolean; onChange: (items: FlowSchedule[]) => void; onClose: () => void;
}) {
  // Começa com a lista do resumo e a atualiza em seguida (o worker muda próximas execuções e resultados).
  const [items, setItems] = useState<FlowSchedule[] | null>(initial);
  const [editing, setEditing] = useState<FlowSchedule | "new" | null>(startNew ? "new" : null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; runId?: string } | null>(null);
  const update = (next: FlowSchedule[]) => { setItems(next); onChange(next); };
  useEffect(() => {
    request<{ agendamentos: FlowSchedule[] }>(endpoint(flowId)).then((r) => update(r.agendamentos))
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível carregar os agendamentos."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);
  async function act(id: string, action: () => Promise<void>) {
    setBusy(id); setError(""); setNotice(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(""); }
  }
  const replace = (s: FlowSchedule) => update((items || []).map((x) => x.id === s.id ? s : x));
  const closeMenu = (target: EventTarget) => { const menu = (target as Element).closest("details"); if (menu) (menu as HTMLDetailsElement).open = false; };

  if (editing) return <ScheduleForm flowId={flowId} schedule={editing === "new" ? null : editing}
    onCancel={() => { if (items?.length || editing !== "new" || !startNew) setEditing(null); else onClose(); }}
    onSaved={(s) => { update(editing === "new" ? [...(items || []), s] : (items || []).map((x) => x.id === s.id ? s : x)); setEditing(null); setNotice({ text: editing === "new" ? "Agendamento criado." : "Agendamento atualizado." }); }}
    onClose={onClose} />;

  const full = (items?.length || 0) >= SCHEDULES_PER_FLOW;
  return (
    <Modal wide className="schedule-modal" onClose={onClose} title={
      <div className="schedule-modal-title">
        <span className="schedule-modal-icon"><Icon name="clock" size={20} /></span>
        <h2>Gerenciar agendamentos</h2>
        <button type="button" className="studio-button" disabled={!items || full} title={full ? `Até ${SCHEDULES_PER_FLOW} agendamentos por fluxo` : undefined}
          onClick={() => { setNotice(null); setError(""); setEditing("new"); }}>
          <Icon name="pencil" size={16} />Novo
        </button>
      </div>
    }>
      <div className="schedule-manager">
        {error && <p className="studio-error" role="alert">{error}</p>}
        {notice && <p className="schedule-notice" role="status">{notice.text}{notice.runId && <> <Link href={`/r/${notice.runId}`} target="_blank">Acompanhar execução</Link></>}</p>}
        {items === null ? !error && <p>Carregando…</p> : items.length === 0 ? <p>Nenhum prompt agendado. Use <strong>Novo</strong> para criar o primeiro.</p> :
          GROUPS.map((group) => {
            const list = items.filter((s) => s.status === group);
            if (!list.length) return null;
            return <section key={group} className="schedule-group">
              <h3>{GROUP_LABEL[group]}</h3>
              <ul>{list.map((s) => <li key={s.id} className={"schedule-row " + s.status}>
                {deleting === s.id ? <div className="schedule-confirm">
                  <span>Excluir este agendamento? As execuções já feitas continuam no histórico.</span>
                  <button type="button" className="studio-button subtle" onClick={() => setDeleting(null)}>Cancelar</button>
                  <button type="button" className="studio-button destructive" disabled={busy === s.id} onClick={() => act(s.id, async () => {
                    await request(endpoint(flowId, s.id), "DELETE");
                    update(items.filter((x) => x.id !== s.id)); setDeleting(null); setNotice({ text: "Agendamento excluído." });
                  })}>Excluir</button>
                </div> : <>
                  <div className="schedule-row-text">
                    <strong title={s.prompt}>{s.prompt}</strong>
                    <small>{nextLabel(s)} · {describeSchedule(s)}</small>
                    {s.lastError ? <small className="schedule-row-error">Última tentativa: {s.lastError}</small>
                      : s.lastRunId && s.lastRunAt ? <small>Última execução em {formatScheduleInstant(s.lastRunAt)} · <Link href={`/r/${s.lastRunId}`} target="_blank">ver resultado</Link></small> : null}
                  </div>
                  <span className={"schedule-status " + s.status}>{busy === s.id ? <span className="studio-spinner" /> : <Icon name={s.status === "active" ? "loop" : s.status === "paused" ? "pause" : "check"} size={16} />}{SCHEDULE_STATUS_LABEL[s.status]}</span>
                  <details className="card-menu schedule-menu" onClick={(e) => { if ((e.target as Element).closest("button")) closeMenu(e.target); }}>
                    <summary aria-label={"Ações do agendamento " + s.prompt.slice(0, 40)}><Icon name="more" /></summary>
                    <div>
                      <button type="button" disabled={!!busy} onClick={() => act(s.id, async () => {
                        const { run } = await request<{ run: { id: string } }>(endpoint(flowId, s.id) + "/executar", "POST");
                        replace({ ...s, lastRunAt: new Date().toISOString(), lastRunId: run.id, lastError: undefined });
                        setNotice({ text: "Execução iniciada.", runId: run.id });
                      })}><Icon name="play" size={16} />Executar agora</button>
                      <button type="button" onClick={() => { setNotice(null); setEditing(s); }}><Icon name="pencil" size={16} />Editar agendamento</button>
                      {s.status !== "ended" && <button type="button" disabled={!!busy} onClick={() => act(s.id, async () => {
                        replace((await request<{ agendamento: FlowSchedule }>(endpoint(flowId, s.id), "PATCH", { active: s.status !== "active" })).agendamento);
                      })}><Icon name={s.status === "active" ? "pause" : "play"} size={16} />{s.status === "active" ? "Pausar" : "Retomar"}</button>}
                      <button type="button" className="danger" onClick={() => setDeleting(s.id)}><Icon name="trash" size={16} />Excluir</button>
                    </div>
                  </details>
                </>}
              </li>)}</ul>
            </section>;
          })}
        <p className="schedule-footnote">Horários de Brasília. Cada agendamento executa o último fluxo salvo como uma conversa nova e conta no limite mensal de execuções.</p>
      </div>
    </Modal>
  );
}

function ScheduleForm({ flowId, schedule, onCancel, onSaved, onClose }: {
  flowId: string; schedule: FlowSchedule | null; onCancel: () => void; onSaved: (s: FlowSchedule) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleDefinition>(() => schedule
    ? { prompt: schedule.prompt, startDate: schedule.startDate, time: schedule.time, frequency: schedule.frequency, weekdays: schedule.weekdays, until: schedule.until }
    : scheduleDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<ScheduleDefinition>) => { setDraft((d) => ({ ...d, ...patch })); setError(""); };
  const weekdays = draft.weekdays.length ? draft.weekdays : [0, 1, 2, 3, 4, 5, 6];
  async function save() {
    setBusy(true); setError("");
    try {
      const value = { ...draft, weekdays: draft.frequency === "day" ? weekdays : [], until: draft.frequency === "once" ? null : draft.until };
      const { agendamento } = schedule
        ? await request<{ agendamento: FlowSchedule }>(endpoint(flowId, schedule.id), "PUT", value)
        : await request<{ agendamento: FlowSchedule }>(endpoint(flowId), "POST", value);
      onSaved(agendamento);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return (
    <Modal className="schedule-modal" onClose={() => { if (!busy) onClose(); }} title={
      <div className="schedule-modal-title">
        <IconButton icon="undo" label="Voltar aos agendamentos" onClick={onCancel} />
        <h2>{schedule ? "Editar agendamento" : "Novo agendamento"}</h2>
      </div>
    }>
      <div className="schedule-form">
        <label className="schedule-prompt">Prompt
          <textarea data-autofocus value={draft.prompt} rows={4} maxLength={20000} placeholder="Ex.: Liste os compromissos que assumi hoje em e-mails e reuniões."
            onChange={(e) => set({ prompt: e.target.value })} />
        </label>
        <fieldset className="schedule-when">
          <legend>Agendar</legend>
          <p className="schedule-description"><Icon name="loop" size={16} />{describeSchedule({ ...draft, weekdays })}</p>
          <div className="schedule-line">
            <span>Iniciar</span>
            <input type="date" aria-label="Data de início" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            <span>em</span>
            <input type="time" aria-label="Horário" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
          <div className="schedule-line">
            <span>Cada</span>
            <select aria-label="Repetir" value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as ScheduleDefinition["frequency"] })}>
              {SCHEDULE_FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {draft.frequency === "day" && <div className="schedule-weekdays" role="group" aria-label="Dias da semana">
              {WEEKDAYS.map((name, day) => {
                const on = weekdays.includes(day);
                return <button key={day} type="button" aria-pressed={on} aria-label={name} title={name} className={on ? "on" : ""}
                  onClick={() => set({ weekdays: on ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort() })}>{name[0]}</button>;
              })}
            </div>}
          </div>
          {draft.frequency !== "once" && <div className="schedule-line">
            <span>Até</span>
            <input type="date" aria-label="Data final" value={draft.until || ""} min={draft.startDate} onChange={(e) => set({ until: e.target.value || null })} />
            {draft.until ? <IconButton icon="trash" label="Remover data final" onClick={() => set({ until: null })} /> : <small>Sem data final</small>}
          </div>}
          <small>Horário de Brasília.</small>
        </fieldset>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="studio-button subtle" disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="button" className="studio-button primary" disabled={busy || !draft.prompt.trim()} onClick={save}>{busy ? "Salvando…" : schedule ? "Salvar alterações" : "Criar agendamento"}</button>
        </div>
      </div>
    </Modal>
  );
}
