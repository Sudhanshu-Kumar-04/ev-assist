import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

const STATUS_COLORS = {
  confirmed: { bg: "#d1fae5", text: "#065f46" },
  pending: { bg: "#fef9c3", text: "#713f12" },
  cancelled: { bg: "#fee2e2", text: "#991b1b" },
  completed: { bg: "#e0e7ff", text: "#3730a3" },
};

export default function MyReservations({ onClose }) {
  const { token } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReservations = () => {
    axios.get("/reservations/my", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => setReservations(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReservations(); }, []);

  const cancel = async (id) => {
    if (!window.confirm("Cancel this reservation?")) return;
    try {
      await axios.patch(`/reservations/${id}/cancel`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchReservations(); // refresh
    } catch (err) {
      alert(err.response?.data?.error || "Cancel failed");
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        <div style={s.header}>
          <h3 style={s.title}>My Reservations</h3>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <p style={s.muted}>Loading...</p>
        ) : reservations.length === 0 ? (
          <div style={s.empty}>
            <p style={{ fontSize: 40 }}>📅</p>
            <p>No reservations yet.</p>
          </div>
        ) : (
          <div style={s.list}>
            {reservations.map(r => {
              const colors = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
              const isPast = new Date(`${r.reservation_date}T${r.end_time}`) < new Date();
              return (
                <div key={r.id} style={s.card}>
                  <div style={s.cardTop}>
                    <div>
                      <p style={s.chargerName}>{r.charger_name}</p>
                      <p style={s.address}>{r.address}</p>
                    </div>
                    <span style={{ ...s.badge, background: colors.bg, color: colors.text }}>
                      {r.status}
                    </span>
                  </div>
                  <div style={s.cardMeta}>
                    <span>📅 {new Date(r.reservation_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                    <span>🕐 {r.start_time?.slice(0, 5)} – {r.end_time?.slice(0, 5)}</span>
                    <span>⚡ {r.power_kw || "N/A"} kW</span>
                  </div>
                  {r.vehicle_model && <p style={s.muted}>🚗 {r.vehicle_model}</p>}
                  {r.notes && <p style={s.muted}>📝 {r.notes}</p>}
                  {r.status === "confirmed" && !isPast && (
                    <button style={s.cancelBtn} onClick={() => cancel(r.id)}>
                      Cancel Reservation
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 },
  panel: { background: "#fff", borderRadius: 14, width: 440, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 0" },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  close: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
  list: { overflowY: "auto", padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 12 },
  card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 6 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  chargerName: { margin: 0, fontWeight: 600, fontSize: 14 },
  address: { margin: 0, fontSize: 12, color: "#6b7280" },
  badge: { fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", textTransform: "capitalize" },
  cardMeta: { display: "flex", gap: 12, fontSize: 12, color: "#374151", flexWrap: "wrap" },
  muted: { margin: 0, fontSize: 12, color: "#6b7280" },
  cancelBtn: { marginTop: 4, padding: "7px 12px", borderRadius: 7, background: "#fee2e2", color: "#dc2626", border: "none", fontWeight: 600, fontSize: 12, cursor: "pointer", alignSelf: "flex-start" },
  empty: { textAlign: "center", padding: "40px 20px", color: "#6b7280" },
};