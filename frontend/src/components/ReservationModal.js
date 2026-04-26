import React, { useState, useEffect } from "react";
import axios from "axios";
import WaitTimeBadge from "./WaitTimeBadge";
import { useAuth } from "../context/AuthContext";

export default function ReservationModal({ station, onClose }) {
    const { token } = useAuth();
    const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [slots, setSlots] = useState([]);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");

    // Fetch available slots whenever date changes
    useEffect(() => {
        if (!date) return;
        setSlotsLoading(true);
        setSelectedSlot(null);
        axios.get(`/reservations/slots/${station.id}?date=${date}`)
            .then(res => setSlots(res.data.slots))
            .catch(() => setError("Failed to load slots"))
            .finally(() => setSlotsLoading(false));
    }, [date, station.id]);

    const book = async () => {
        if (!selectedSlot) return;
        setLoading(true);
        setError("");
        try {
            await axios.post("/reservations", {
                charger_id: station.id,
                reservation_date: date,
                start_time: selectedSlot.start + ":00",
                end_time: selectedSlot.end + ":00",
                notes,
            }, { headers: { Authorization: `Bearer ${token}` } });
            setSuccess(true);
        } catch (err) {
            setError(err.response?.data?.error || "Booking failed");
        } finally {
            setLoading(false);
        }
    };

    // Min date = today
    const today = new Date().toISOString().split("T")[0];
    // Max date = 7 days ahead
    const maxDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    return (
        <div style={s.overlay}>
            <div style={s.modal}>
                <button style={s.close} onClick={onClose}>✕</button>

                {success ? (
                    <div style={s.successBox}>
                        <div style={s.successIcon}>✓</div>
                        <h3 style={{ margin: "8px 0 4px" }}>Booking Confirmed!</h3>
                        <p style={s.muted}>{station.name}</p>
                        <p style={s.muted}>{date} · {selectedSlot?.start} – {selectedSlot?.end}</p>
                        <button style={s.btn} onClick={onClose}>Done</button>
                    </div>
                ) : (
                    <>
                        <h3 style={s.title}>Reserve a Slot</h3>
                        <p style={s.stationName}>⚡ {station.name}</p>
                        <p style={s.muted}>{station.address}</p>
                        <p style={s.muted}>🔌 {station.connection_type || "Unknown"} · {station.power_kw || "N/A"} kW</p>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <span style={{ fontSize: 12, color: "#666" }}>Current wait estimate:</span>
                            <WaitTimeBadge station={station} />
                        </div>

                        {/* Date picker */}
                        <label style={s.label}>Select Date</label>
                        <input
                            type="date" value={date} min={today} max={maxDate}
                            onChange={e => setDate(e.target.value)}
                            style={s.input}
                        />

                        {/* Slot grid */}
                        <label style={s.label}>Select Time Slot</label>
                        {slotsLoading ? (
                            <p style={s.muted}>Loading slots...</p>
                        ) : (
                            <div style={s.slotGrid}>
                                {slots.map(slot => (
                                    <button
                                        key={slot.start}
                                        disabled={!slot.available}
                                        onClick={() => setSelectedSlot(slot)}
                                        style={{
                                            ...s.slot,
                                            ...(slot.available ? {} : s.slotBooked),
                                            ...(selectedSlot?.start === slot.start ? s.slotSelected : {}),
                                        }}
                                    >
                                        {slot.start}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selectedSlot && (
                            <p style={s.selectedInfo}>
                                Selected: <strong>{selectedSlot.start} – {selectedSlot.end}</strong>
                            </p>
                        )}

                        {/* Notes */}
                        <label style={s.label}>Notes (optional)</label>
                        <textarea
                            style={{ ...s.input, height: 60, resize: "none" }}
                            placeholder="e.g. My car is Tata Nexon EV"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                        />

                        {error && <p style={s.error}>{error}</p>}

                        <button
                            style={{ ...s.btn, opacity: (!selectedSlot || loading) ? 0.6 : 1 }}
                            onClick={book}
                            disabled={!selectedSlot || loading}
                        >
                            {loading ? "Booking..." : "Confirm Booking"}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

const s = {
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 },
    modal: { background: "#fff", borderRadius: 14, padding: "28px 24px", width: 380, maxHeight: "90vh", overflowY: "auto", position: "relative", display: "flex", flexDirection: "column", gap: 8 },
    close: { position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
    title: { margin: "0 0 4px", fontSize: 18, fontWeight: 600 },
    stationName: { margin: 0, fontWeight: 600, fontSize: 14 },
    muted: { margin: 0, fontSize: 12, color: "#666" },
    label: { fontSize: 12, fontWeight: 600, color: "#444", marginTop: 6 },
    input: { padding: "9px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" },
    slotGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 },
    slot: { padding: "8px 4px", borderRadius: 7, border: "1px solid #d1fae5", background: "#f0fdf4", color: "#166534", fontSize: 12, fontWeight: 500, cursor: "pointer" },
    slotBooked: { background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#9ca3af", cursor: "not-allowed" },
    slotSelected: { background: "#2563eb", border: "1px solid #2563eb", color: "#fff" },
    selectedInfo: { fontSize: 13, color: "#374151", margin: "2px 0" },
    btn: { padding: "12px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer", marginTop: 4 },
    error: { color: "#dc2626", fontSize: 13, margin: 0 },
    successBox: { display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0", gap: 4 },
    successIcon: { width: 56, height: 56, borderRadius: "50%", background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: "#16a34a" },
};