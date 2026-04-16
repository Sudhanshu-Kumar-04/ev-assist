import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function AuthModal({ onClose }) {
  const { login } = useAuth();
  const [mode, setMode] = useState("login");   // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "", vehicle_model: "", battery_capacity_kwh: "", range_km: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const url = `/auth/${mode}`;
      const payload = mode === "login"
        ? { email: form.email, password: form.password }
        : form;

      const res = await axios.post(url, payload);
      login(res.data.token, res.data.user);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>{mode === "login" ? "Sign In" : "Create Account"}</h2>

        {mode === "register" && (
          <input style={styles.input} name="name" placeholder="Full name" value={form.name} onChange={handle} />
        )}
        <input style={styles.input} name="email" placeholder="Email" type="email" value={form.email} onChange={handle} />
        <input style={styles.input} name="password" placeholder="Password" type="password" value={form.password} onChange={handle} />

        {mode === "register" && (
          <>
            <input style={styles.input} name="vehicle_model" placeholder="Vehicle model (e.g. Tata Nexon EV)" value={form.vehicle_model} onChange={handle} />
            <input style={styles.input} name="battery_capacity_kwh" placeholder="Battery capacity (kWh)" type="number" value={form.battery_capacity_kwh} onChange={handle} />
            <input style={styles.input} name="range_km" placeholder="Range (km)" type="number" value={form.range_km} onChange={handle} />
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.btn} onClick={submit} disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Register"}
        </button>

        <p style={styles.toggle}>
          {mode === "login" ? "No account?" : "Already registered?"}{" "}
          <span style={styles.link} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </span>
        </p>

        <button style={styles.close} onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  modal: { background: "#fff", borderRadius: 12, padding: 32, width: 360, position: "relative", display: "flex", flexDirection: "column", gap: 12 },
  title: { margin: 0, fontSize: 20, fontWeight: 600 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, outline: "none" },
  btn: { padding: "12px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer" },
  error: { color: "#dc2626", fontSize: 13, margin: 0 },
  toggle: { fontSize: 13, textAlign: "center", margin: 0 },
  link: { color: "#2563eb", cursor: "pointer", fontWeight: 500 },
  close: { position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
};