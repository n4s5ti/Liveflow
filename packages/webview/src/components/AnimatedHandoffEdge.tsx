import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

/**
 * A custom ReactFlow edge that shows an animated particle traveling
 * from source to target when a handoff is in progress.
 *
 * Props (via data):
 *  - animated: boolean — whether the particle is currently traveling
 *  - color: string — edge stroke color
 *  - label: string — tool name shown on the edge
 */
export function AnimatedHandoffEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const isAnimated = !!(data as any)?.animated;
  const color = (data as any)?.color || "#888";
  const label = (data as any)?.label as string | undefined;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      {/* Base edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isAnimated ? "#22c55e" : color,
          strokeWidth: isAnimated ? 3 : 1.5,
          strokeDasharray: isAnimated ? undefined : "6,4",
          opacity: isAnimated ? 1 : 0.6,
          transition: "stroke 0.3s, stroke-width 0.3s",
        }}
      />

      {/* Animated particle */}
      {isAnimated && (
        <g>
          <circle r="5" fill="#22c55e" filter="url(#particle-glow)">
            <animateMotion
              dur="1s"
              repeatCount="2"
              path={edgePath}
              rotate="auto"
            />
          </circle>
          {/* Trail particle (smaller, delayed) */}
          <circle r="3" fill="#22c55e" opacity="0.5">
            <animateMotion
              dur="1s"
              repeatCount="2"
              path={edgePath}
              rotate="auto"
              begin="0.15s"
            />
          </circle>
          {/* Glow filter */}
          <defs>
            <filter id="particle-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
        </g>
      )}

      {/* Edge label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              fontSize: 9,
              fontFamily: "monospace",
              color: isAnimated ? "#22c55e" : "#888",
              background: isAnimated
                ? "rgba(34, 197, 94, 0.15)"
                : "var(--liveflow-editor-background, #1e1e1e)",
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${isAnimated ? "#22c55e44" : "#333"}`,
              whiteSpace: "nowrap",
              transition: "all 0.3s ease",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
