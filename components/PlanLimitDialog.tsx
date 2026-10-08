"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, Modal, PLAN_LIMIT_EVENT, type PlanLimitDetail } from "./StudioUI";

/** Mounted once in the root layout; any request that hits a beta limit opens it. */
export function PlanLimitDialog() {
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);
  useEffect(() => {
    const open = (event: Event) => setDetail((event as CustomEvent<PlanLimitDetail>).detail);
    window.addEventListener(PLAN_LIMIT_EVENT, open);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, open);
  }, []);
  if (!detail) return null;
  return (
    <Modal title="Limite do beta atingido" onClose={() => setDetail(null)} className="plan-limit-modal">
      <div className="plan-limit-body">
        <span className="plan-limit-icon"><Icon name="spark" size={22} /></span>
        <p>{detail.message}</p>
        <p className="plan-limit-pitch">No AI Action, suas execuções mensais e seus fluxos são ilimitados.</p>
      </div>
      <div className="plan-limit-actions">
        <Link className="studio-button" href="/minha-conta" onClick={() => setDetail(null)}>Ver meus limites</Link>
        <a className="studio-button primary" href={detail.upgradeUrl} target="_blank" rel="noopener noreferrer" autoFocus>Faça parte do AI Action</a>
      </div>
    </Modal>
  );
}
