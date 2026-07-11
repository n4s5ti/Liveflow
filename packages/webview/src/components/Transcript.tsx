import React, { useRef, useEffect, useState } from "react";
import { useLiveflowStore } from "@/store";

export function Transcript() {
  const transcripts = useLiveflowStore((s) => s.transcripts);
  const handoffs = useLiveflowStore((s) => s.handoffs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Merge transcripts and handoffs into a single timeline
  const timeline = React.useMemo(() => {
    const items: Array<
      | { kind: "transcript"; data: (typeof transcripts)[0] }
      | { kind: "handoff"; data: (typeof handoffs)[0] }
    > = [];

    for (const t of transcripts) {
      items.push({ kind: "transcript", data: t });
    }
    for (const h of handoffs) {
      items.push({ kind: "handoff", data: h });
    }

    // Sort by timestamp
    items.sort((a, b) => {
      const ta = a.kind === "transcript" ? a.data.timestamp : a.data.timestamp;
      const tb = b.kind === "transcript" ? b.data.timestamp : b.data.timestamp;
      return ta.localeCompare(tb);
    });

    return items;
  }, [transcripts, handoffs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline.length, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  if (timeline.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 24, marginBottom: 4 }}>💬</div>
        <div>No conversation yet</div>
        <div style={{ fontSize: 11, color: "#666" }}>
          Speech transcripts will appear here
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: "auto", padding: 8 }}
      >
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontWeight: 600 }}>
          CONVERSATION
        </div>

        {timeline.map((item, i) => {
          if (item.kind === "handoff") {
            return (
              <div
                key={`h-${i}`}
                style={{
                  textAlign: "center",
                  padding: "6px 0",
                  margin: "4px 0",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "#888",
                    background: "#333",
                    padding: "3px 10px",
                    borderRadius: 10,
                  }}
                >
                  🔄 {item.data.old_agent_name} → {item.data.new_agent_name}
                </span>
              </div>
            );
          }

          const t = item.data;
          const isUser = t.speaker === "user";

          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-start" : "flex-end",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: isUser ? "12px 12px 12px 2px" : "12px 12px 2px 12px",
                  background: isUser ? "#2a3a4a" : "#3a2a4a",
                  opacity: t.is_final ? 1 : 0.5,
                  transition: "opacity 0.3s",
                }}
              >
                {/* Speaker label */}
                <div
                  style={{
                    fontSize: 10,
                    color: isUser ? "#3b82f6" : "#a855f7",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {isUser ? "User" : `Agent (${t.agent_id || "?"})`}
                  {!t.is_final && (
                    <span style={{ color: "#666", fontWeight: 400 }}> · typing...</span>
                  )}
                </div>

                {/* Message text */}
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--liveflow-editor-foreground, #ccc)",
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {t.text}
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: 9, color: "#666", marginTop: 4, textAlign: "right" }}>
                  {new Date(t.timestamp).toLocaleTimeString()}
                  {t.language && ` · ${t.language}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <div style={{ textAlign: "center", padding: 4 }}>
          <button
            onClick={() => {
              setAutoScroll(true);
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
            style={{
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 12,
              border: "1px solid #555",
              background: "#333",
              color: "#ccc",
              cursor: "pointer",
            }}
          >
            ↓ Scroll to latest
          </button>
        </div>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  fontSize: 13,
  textAlign: "center",
};
