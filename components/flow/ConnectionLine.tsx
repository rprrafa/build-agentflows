"use client";
import { getBezierPath, type ConnectionLineComponentProps } from "@xyflow/react";
import { NODE_STYLE } from "@/lib/flow-presets";
import { outputLabel } from "@/lib/flow-graph";
import { CHEVRON, type VisualNode } from "./AgentNode";
// Linha desenhada enquanto o usuário arrasta uma conexão: cor do bloco de origem,
// seta na ponta e o nome da saída (Sim, Não, Repetir...) junto ao ponto de partida.
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  fromNode,
  fromHandle,
}: ConnectionLineComponentProps<VisualNode>) {
  const kind = fromNode?.data.kind;
  const color = kind ? NODE_STYLE[kind].color : "#6557d2";
  const label = kind ? outputLabel(kind, fromHandle?.id, fromNode.data.config) : "";
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  return (
    <g className="af-connection">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      <g transform={`translate(${toX - 10}, ${toY - 10}) scale(0.8)`}>
        <path d={CHEVRON} fill={color} />
      </g>
      {label && (
        <text
          x={fromX + 8}
          y={fromY + 16}
          fill={color}
          fontSize={9}
          fontWeight={700}
        >
          {label}
        </text>
      )}
    </g>
  );
}
