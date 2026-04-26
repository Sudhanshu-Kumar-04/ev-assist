import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function CostEstimator({ station, onClose }) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    battery_capacity_kwh: user?.battery_capacity_kwh || "",
    range_km: user?.range_km || "",
    current_battery_pct: 20,
    target_battery_pct: 80,
    cost_per_kwh: 12,
    session_fee_inr: 0,
    idle_fee_inr_per_min: 0,
    expected_idle_minutes: 0,
    gst_percent: 18,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const estimate = useCallback(async () => {
    if (!form.battery_capacity_kwh) return;
    setLoading(true);
    try {
      const res = await axios.post(
        "/chargers/estimate-cost",
        { ...form, power_kw: station.power_kw }
      );
      setResult(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [form, station?.power_kw]);

  // Auto-estimate when form is complete
  useEffect(() => {
    if (form.battery_capacity_kwh && station?.power_kw) {
      estimate();
    }
  }, [estimate, form.battery_capacity_kwh, form.current_battery_pct, form.target_battery_pct, station?.power_kw]);

  const handle = e => setForm({ ...form, [e.target.name]: e.target.value });

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <button style={s.close} onClick={onClose}>✕</button>
        <h3 style={s.title}>⚡ Charging Cost Estimator</h3>

        {/* Station info */}
        <div style={s.stationBadge}>
          <span style={{ fontWeight: 600 }}>{station.name}</span>
          <span style={s.powerBadge}>{station.power_kw} kW</span>
        </div>

        {/* Battery sliders */}
        <div style={s.sliderSection}>
          <div style={s.sliderRow}>
            <label style={s.label}>
              Current Battery
              <span style={s.pctBadge}>{form.current_battery_pct}%</span>
            </label>
            <input type="range" name="current_battery_pct" min="0" max="90" step="5"
              value={form.current_battery_pct} onChange={handle}
              style={s.slider} />
          </div>

          <div style={s.sliderRow}>
            <label style={s.label}>
              Charge To
              <span style={{ ...s.pctBadge, background: "#dbeafe", color: "#1d4ed8" }}>
                {form.target_battery_pct}%
              </span>
            </label>
            <input type="range" name="target_battery_pct"
              min={parseInt(form.current_battery_pct) + 5} max="100" step="5"
              value={form.target_battery_pct} onChange={handle}
              style={s.slider} />
          </div>

          {/* Battery visual bar */}
          <div style={s.batteryBar}>
            <div style={{
              ...s.batteryFill,
              width: `${form.current_battery_pct}%`,
              background: form.current_battery_pct < 20 ? "#ef4444" : "#f59e0b"
            }} />
            <div style={{
              ...s.batteryCharge,
              left: `${form.current_battery_pct}%`,
              width: `${form.target_battery_pct - form.current_battery_pct}%`,
            }} />
            <span style={s.batteryLabel}>{form.current_battery_pct}% → {form.target_battery_pct}%</span>
          </div>
        </div>

        {/* Vehicle inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={s.label}>Battery (kWh)</label>
            <input style={s.input} name="battery_capacity_kwh" type="number"
              placeholder="e.g. 30.2" value={form.battery_capacity_kwh} onChange={handle} />
          </div>
          <div>
            <label style={s.label}>Range (km)</label>
            <input style={s.input} name="range_km" type="number"
              placeholder="e.g. 312" value={form.range_km} onChange={handle} />
          </div>
        </div>

        <div>
          <label style={s.label}>Cost per kWh (₹)</label>
          <input style={s.input} name="cost_per_kwh" type="number"
            placeholder="12" value={form.cost_per_kwh} onChange={handle} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={s.label}>Session Fee (₹)</label>
            <input style={s.input} name="session_fee_inr" type="number"
              placeholder="0" value={form.session_fee_inr} onChange={handle} />
          </div>
          <div>
            <label style={s.label}>GST (%)</label>
            <input style={s.input} name="gst_percent" type="number"
              placeholder="18" value={form.gst_percent} onChange={handle} />
          </div>
          <div>
            <label style={s.label}>Idle Fee / min (₹)</label>
            <input style={s.input} name="idle_fee_inr_per_min" type="number"
              placeholder="0" value={form.idle_fee_inr_per_min} onChange={handle} />
          </div>
          <div>
            <label style={s.label}>Expected Idle (min)</label>
            <input style={s.input} name="expected_idle_minutes" type="number"
              placeholder="0" value={form.expected_idle_minutes} onChange={handle} />
          </div>
        </div>

        <button style={s.btn} onClick={estimate} disabled={loading || !form.battery_capacity_kwh}>
          {loading ? "Calculating..." : "Calculate"}
        </button>

        {/* Results */}
        {result && (
          <div style={s.results}>
            <p style={s.resultsTitle}>Charging Estimate</p>
            <div style={s.resultsGrid}>
              <ResultCard icon="⏱️" label="Charging Time" value={result.chargingTimeFormatted} color="#2563eb" />
              <ResultCard icon="💰" label="Total Cost" value={`₹${result.totalCostInr ?? result.estimatedCostInr}`} color="#059669" />
              <ResultCard icon="⚡" label="Energy Needed" value={`${result.energyNeededKwh} kWh`} color="#d97706" />
              {result.rangeAddedKm && (
                <ResultCard icon="🛣️" label="Range Added" value={`+${result.rangeAddedKm} km`} color="#7c3aed" />
              )}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#14532d", lineHeight: 1.55 }}>
              <div>Energy: ₹{result.energyCostInr ?? result.estimatedCostInr}</div>
              <div>Session fee: ₹{result.sessionFeeInr ?? 0}</div>
              <div>Idle estimate: ₹{result.idlePenaltyEstimateInr ?? 0}</div>
              <div>Tax ({result.gstPercent ?? 0}%): ₹{result.taxInr ?? 0}</div>
              <div style={{ fontWeight: 700, marginTop: 3 }}>Total payable: ₹{result.totalCostInr ?? result.estimatedCostInr}</div>
            </div>
            <p style={s.disclaimer}>
              * Estimate based on {station.power_kw}kW charger at 90% efficiency.
              Actual cost may vary by operator.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ icon, label, value, color }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 10px", textAlign: "center", border: `1px solid ${color}22` }}>
      <div style={{ fontSize: 22 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{label}</div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3500 },
  modal: { background: "#fff", borderRadius: 16, padding: "24px 20px", width: 400, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, position: "relative" },
  close: { position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
  title: { margin: 0, fontSize: 17, fontWeight: 700 },
  stationBadge: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f1f5f9", borderRadius: 8, padding: "8px 12px", fontSize: 13 },
  powerBadge: { background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 700 },
  sliderSection: { display: "flex", flexDirection: "column", gap: 10, background: "#f8fafc", borderRadius: 10, padding: 12 },
  sliderRow: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280", display: "flex", justifyContent: "space-between", alignItems: "center" },
  pctBadge: { background: "#fef9c3", color: "#854d0e", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700 },
  slider: { width: "100%", accentColor: "#2563eb" },
  batteryBar: { position: "relative", height: 24, background: "#e5e7eb", borderRadius: 6, overflow: "hidden", marginTop: 4 },
  batteryFill: { position: "absolute", left: 0, top: 0, height: "100%", transition: "width 0.3s", borderRadius: "6px 0 0 6px" },
  batteryCharge: { position: "absolute", top: 0, height: "100%", background: "#22c55e", opacity: 0.7, transition: "all 0.3s" },
  batteryLabel: { position: "absolute", width: "100%", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#1e293b", lineHeight: "24px" },
  input: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, outline: "none", boxSizing: "border-box", marginTop: 4 },
  btn: { padding: "11px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" },
  results: { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: 14 },
  resultsTitle: { margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "#166534" },
  resultsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  disclaimer: { margin: "8px 0 0", fontSize: 11, color: "#6b7280", fontStyle: "italic" },
};