import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function MyFavorites({ onClose }) {
  const { token } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(() => {
    setLoading(true);
    axios.get("/chargers/favorites", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => setFavorites(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const remove = async (charger) => {
    try {
      await axios.delete(
        `/chargers/favorite/${charger.id}`,
        {
          headers: { Authorization: `Bearer ${token}` }  // ← THIS was missing
        }
      );
      setFavorites(prev => prev.filter(f => f.id !== charger.id));
    } catch (err) {
      console.error("Remove error:", err.response?.data);
      alert(err.response?.data?.error || "Failed to remove");
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        <div style={s.header}>
          <h3 style={s.title}>⭐ My Favorites</h3>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <p style={s.empty}>Loading...</p>
        ) : favorites.length === 0 ? (
          <div style={s.emptyBox}>
            <p style={{ fontSize: 40 }}>⭐</p>
            <p>No favorites yet.</p>
            <p style={{ fontSize: 12, color: "#9ca3af" }}>
              Click ⭐ on any charger popup to save it here.
            </p>
          </div>
        ) : (
          <div style={s.list}>
            {favorites.map(c => (
              <div key={c.id} style={s.card}>
                <div style={s.cardLeft}>
                  <p style={s.name}>{c.name}</p>
                  <p style={s.address}>{c.address || "No address"}</p>
                  <div style={s.meta}>
                    <span>⚡ {c.power_kw || "N/A"} kW</span>
                    <span>🔌 {c.connection_type || "Standard"}</span>
                    <span>🔢 {c.quantity || 1} ports</span>
                  </div>
                </div>
                <button
                  style={s.removeBtn}
                  onClick={() => remove(c)}
                >
                  💔 Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 },
  panel: { background: "#fff", borderRadius: 14, width: 440, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #f1f5f9" },
  title: { margin: 0, fontSize: 17, fontWeight: 700 },
  close: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
  list: { overflowY: "auto", padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 10 },
  card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  cardLeft: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  name: { margin: 0, fontWeight: 600, fontSize: 14 },
  address: { margin: 0, fontSize: 12, color: "#6b7280" },
  meta: { display: "flex", gap: 10, fontSize: 12, color: "#374151", flexWrap: "wrap" },
  removeBtn: { padding: "6px 12px", borderRadius: 8, background: "#fee2e2", color: "#dc2626", border: "none", fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  empty: { padding: 20, color: "#9ca3af", textAlign: "center" },
  emptyBox: { textAlign: "center", padding: "40px 20px", color: "#6b7280" },
};