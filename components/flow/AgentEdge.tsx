"use client";
import { memo, useRef, useState } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Icon } from "../StudioUI";
export type EdgeData = {
  sourceColor: string;
  targetColor: string;
  label?: string;
  active?: boolean;
};
export type VisualEdge = Edge<EdgeData, "agent">;
function AgentEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<VisualEdge>) {
  const [hover, setHover] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { deleteElements } = useReactFlow();
  const [path, centerX, centerY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const from = data?.sourceColor || "#ae53ba",
    to = data?.targetColor || "#2a8af6",
    gradient = "af-edge-gradient-" + id;
  const enter = () => {
    if (leaving.current) clearTimeout(leaving.current);
    setHover(true);
  };
  const leave = () => {
    leaving.current = setTimeout(() => setHover(false), 120);
  };
  return (
    <>
      <defs>
        <linearGradient
          id={gradient}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <path
        className="af-edge-hit"
        d={path}
        onMouseEnter={enter}
        onMouseLeave={leave}
      />
      <path
        className={
          "af-edge" +
          (hover ? " hovered" : "") +
          (selected ? " selected" : "") +
          (data?.active ? " active" : "")
        }
        d={path}
        style={{ stroke: `url(#${gradient})` }}
        onMouseEnter={enter}
        onMouseLeave={leave}
      />
      <EdgeLabelRenderer>
        {data?.label && (
          <span
            className="af-edge-label nodrag nopan"
            style={{
              transform: `translate(${sourceX + 12}px, ${sourceY + 2}px)`,
              color: from,
            }}
          >
            {data.label}
          </span>
        )}
        {(hover || selected) && (
          <div
            className={"af-edge-remove nodrag nopan" + (hover ? " hovered" : "")}
            style={{
              transform: `translate(-50%, -50%) translate(${centerX}px, ${centerY}px)`,
            }}
            onMouseEnter={enter}
            onMouseLeave={leave}
          >
            <button
              type="button"
              title="Remover conexão"
              aria-label="Remover conexão"
              style={{ background: `linear-gradient(to right, ${from}, ${to})` }}
              onClick={(e) => {
                e.stopPropagation();
                void deleteElements({ edges: [{ id }] });
              }}
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
export const AgentEdge = memo(AgentEdgeView);
