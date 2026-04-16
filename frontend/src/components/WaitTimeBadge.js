import React from "react";
import { useWaitTime } from "../hooks/useWaitTime";

const COLOR_STYLES = {
  green:  { background: "#d1fae5", color: "#065f46", border: "1px solid #6ee7b7" },
  yellow: { background: "#fef9c3", color: "#713f12", border: "1px solid #fde68a" },
  orange: { background: "#ffedd5", color: "#7c2d12", border: "1px solid #fdba74" },
  red:    { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

export default function WaitTimeBadge({ station }) {
  const { prediction, loading } = useWaitTime(station);

  if (loading) return (
    <span style={badge("#f3f4f6", "#6b7280")}>⏳ Estimating...</span>
  );

  if (!prediction) return null;

  const style = COLOR_STYLES[prediction.color] || COLOR_STYLES.green;

  return (
    <span style={{ ...baseBadge, ...style }}>
      🕐 {prediction.label}
    </span>
  );
}

const baseBadge = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
};

function badge(bg, color) {
  return { ...baseBadge, background: bg, color, border: `1px solid ${color}` };
}