import React, { useState } from "react";
import axios from "axios";
import EVConfig from "./EVConfig";

export default function RoutePlanner({ setStations, setRoute }) {
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
    <div>
      {/* ✅ EV CONFIG PANEL */}
      <EVConfig onConfigChange={setEvData} />

      {/* Existing inputs */}
      <input
        placeholder="From"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />

      <input
        placeholder="To"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />

      <button onClick={handleRoute}>Find Route</button>
    </div>
  );
}