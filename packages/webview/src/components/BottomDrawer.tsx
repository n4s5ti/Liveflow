import React, { useState } from "react";
import { ToolTimeline } from "./ToolTimeline";
import { Transcript } from "./Transcript";
import { ChatInspector } from "./ChatInspector";

const TABS = [
  { id: "tools", label: "🔧 Tools", component: ToolTimeline },
  { id: "transcript", label: "💬 Transcript", component: Transcript },
  { id: "context", label: "📋 Context", component: ChatInspector },
] as const;

/**
 * A collapsible bottom drawer that holds the secondary panels
 * (Tools, Transcript, Chat Context) in a tabbed interface.
 * The drawer can be collapsed to a thin bar or expanded to take
 * up to 40% of the viewport height.
 */
export function BottomDrawer() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("tools");

  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.component ?? ToolTimeline;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid #333",
        background: "var(--liveflow-editor-background, #1e1e1e)",
        transition: "height 0.3s ease",
        height: expanded ? "40vh" : 36,
        minHeight: 36,
        maxHeight: "60vh",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Tab bar / header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          flexShrink: 0,
          background: "#1a1a24",
          borderBottom: expanded ? "1px solid #333" : "none",
          userSelect: "none",
        }}
      >
        {/* Tabs */}
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (activeTab === tab.id && expanded) {
                setExpanded(false);
              } else {
                setActiveTab(tab.id);
                setExpanded(true);
              }
            }}
            style={{
              padding: "0 14px",
              height: "100%",
              fontSize: 11,
              fontWeight: activeTab === tab.id && expanded ? 600 : 400,
              color: activeTab === tab.id && expanded ? "#fff" : "#888",
              background: activeTab === tab.id && expanded ? "#252530" : "transparent",
              borderBottom:
                activeTab === tab.id && expanded ? "2px solid #6366f1" : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </button>
        ))}

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginLeft: "auto",
            padding: "0 12px",
            height: "100%",
            fontSize: 12,
            color: "#666",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {expanded ? "▾" : "▴"}
        </button>
      </div>

      {/* Panel content */}
      {expanded && (
        <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
          <ActiveComponent />
        </div>
      )}
    </div>
  );
}
