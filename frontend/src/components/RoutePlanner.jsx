import React, { useState } from "react";
import axios from "axios";
import EVConfig from "./EVConfig";

export default function RoutePlanner({
  setStations,
  setRoute,
  isMobile = false,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [evData, setEvData] = useState({
    battery: 100,
    capacity: 60,
    efficiency: 6,
  });

  const handleRoute = async () => {
    console.log("EV DATA:", evData); // 🔥 check in console

    // your existing route logic here
  };

  return (
    <div
      style={{
        padding: "12px",
        position: "absolute",
        top: isMobile ? "168px" : "100px",
        left: "10px",
        right: "10px",
        zIndex: 999,
        backgroundColor: "rgba(255, 255, 255, 0.98)",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
        maxWidth: "calc(100vw - 20px)",
      }}
    >
      {/* ✅ EV CONFIG PANEL */}
      <EVConfig onConfigChange={setEvData} />

      {/* Existing inputs - responsive layout */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: isMobile ? "nowrap" : "wrap",
          flexDirection: isMobile ? "column" : "row",
          alignItems: "center",
          marginTop: "12px",
        }}
      >
        <input
          placeholder="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{
            flex: isMobile ? "none" : "1",
            width: isMobile ? "100%" : "auto",
            minWidth: isMobile ? "100%" : "120px",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        />

        <input
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{
            flex: isMobile ? "none" : "1",
            width: isMobile ? "100%" : "auto",
            minWidth: isMobile ? "100%" : "120px",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        />

        <button
          onClick={handleRoute}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            background: "#2563eb",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "14px",
            whiteSpace: "nowrap",
            minWidth: isMobile ? "100%" : "110px",
            width: isMobile ? "100%" : "auto",
          }}
        >
          Find Route
        </button>
      </div>
    </div>
  );
}
