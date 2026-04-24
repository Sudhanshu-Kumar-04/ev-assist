import React, { useState, useEffect } from "react";

export default function EVConfig({ onConfigChange }) {
  const [battery, setBattery] = useState(100); // %
  const [capacity, setCapacity] = useState(60); // kWh
  const [efficiency, setEfficiency] = useState(6); // km/kWh
  const [reservePct, setReservePct] = useState(15);
  const [targetChargePct, setTargetChargePct] = useState(80);
  const [legSafetyFactor, setLegSafetyFactor] = useState(0.85);

  // Send data to parent whenever values change
  useEffect(() => {
    onConfigChange({
      battery: Number(battery),
      capacity: Number(capacity),
      efficiency: Number(efficiency),
      reservePct: Number(reservePct),
      targetChargePct: Number(targetChargePct),
      legSafetyFactor: Number(legSafetyFactor),
    });
  }, [
    battery,
    capacity,
    efficiency,
    reservePct,
    targetChargePct,
    legSafetyFactor,
  ]);

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>⚡ EV Configuration</h3>

      <div style={styles.field}>
        <label>Battery (%)</label>
        <input
          type="number"
          value={battery}
          min="0"
          max="100"
          onChange={(e) => setBattery(e.target.value)}
        />
      </div>

      <div style={styles.field}>
        <label>Battery Capacity (kWh)</label>
        <input
          type="number"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </div>

      <div style={styles.field}>
        <label>Efficiency (km/kWh)</label>
        <input
          type="number"
          value={efficiency}
          onChange={(e) => setEfficiency(e.target.value)}
        />
      </div>

      <div style={styles.field}>
        <label>Reserve Battery (%)</label>
        <input
          type="number"
          value={reservePct}
          min="5"
          max="40"
          onChange={(e) => setReservePct(e.target.value)}
        />
      </div>

      <div style={styles.field}>
        <label>Charge Target (%)</label>
        <input
          type="number"
          value={targetChargePct}
          min="40"
          max="100"
          onChange={(e) => setTargetChargePct(e.target.value)}
        />
      </div>

      <div style={styles.field}>
        <label>Leg Safety Factor (0.65-0.95)</label>
        <input
          type="number"
          step="0.05"
          value={legSafetyFactor}
          min="0.65"
          max="0.95"
          onChange={(e) => setLegSafetyFactor(e.target.value)}
        />
      </div>
    </div>
  );
}

// Simple styling (you can replace with Tailwind later)
const styles = {
  container: {
    padding: "15px",
    border: "1px solid #ddd",
    borderRadius: "10px",
    marginBottom: "15px",
    background: "#f9f9f9",
  },
  heading: {
    marginBottom: "10px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    marginBottom: "10px",
  },
};
