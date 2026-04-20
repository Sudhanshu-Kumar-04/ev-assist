import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function AuthModal({ onClose }) {
  const { login } = useAuth();
  const [mode, setMode] = useState("login");   // "login" | "register"
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    vehicle_model: "",
    battery_capacity_kwh: "",
    range_km: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const passwordChecks = {
    minLength: form.password.length >= 8,
    upper: /[A-Z]/.test(form.password),
    lower: /[a-z]/.test(form.password),
    number: /[0-9]/.test(form.password),
    symbol: /[^A-Za-z0-9]/.test(form.password),
  };

  const passwordScore = Object.values(passwordChecks).filter(Boolean).length;

  const passwordStrengthLabel =
    passwordScore <= 2 ? "Weak" :
      passwordScore <= 4 ? "Medium" : "Strong";

  const handle = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (error) setError("");
  };

  const validateForm = () => {
    const normalizedEmail = String(form.email || "").trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) return "Please enter a valid email address";

    if (!form.password) return "Password is required";

    if (mode === "register") {
      if (!form.name || String(form.name).trim().length < 2) return "Name must be at least 2 characters";
      if (passwordScore < 5) return "Use a stronger password (8+ chars, upper, lower, number, symbol)";
      if (form.password !== form.confirmPassword) return "Passwords do not match";

      if (form.battery_capacity_kwh !== "" && Number(form.battery_capacity_kwh) <= 0) {
        return "Battery capacity must be greater than 0";
      }
      if (form.range_km !== "" && Number(form.range_km) <= 0) {
        return "Range must be greater than 0";
      }
    }

    return "";
  };

  const submit = async () => {
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const url = `/auth/${mode}`;
      const payload = mode === "login"
        ? { email: String(form.email).trim().toLowerCase(), password: form.password }
        : {
          name: String(form.name).trim(),
          email: String(form.email).trim().toLowerCase(),
          password: form.password,
          vehicle_model: form.vehicle_model,
          battery_capacity_kwh: form.battery_capacity_kwh,
          range_km: form.range_km,
        };

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

        <div style={styles.passwordRow}>
          <input
            style={{ ...styles.input, margin: 0 }}
            name="password"
            placeholder="Password"
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={handle}
          />
          <button
            type="button"
            style={styles.eyeBtn}
            onClick={() => setShowPassword((prev) => !prev)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {mode === "register" && (
          <>
            <div style={styles.passwordHintBox}>
              <div style={{ ...styles.strengthText, color: passwordStrengthLabel === "Strong" ? "#047857" : passwordStrengthLabel === "Medium" ? "#92400e" : "#b91c1c" }}>
                Password strength: {passwordStrengthLabel}
              </div>
              <div style={styles.strengthBarTrack}>
                <div style={{ ...styles.strengthBarFill, width: `${(passwordScore / 5) * 100}%`, background: passwordStrengthLabel === "Strong" ? "#10b981" : passwordStrengthLabel === "Medium" ? "#f59e0b" : "#ef4444" }} />
              </div>
              <div style={styles.ruleList}>
                <span style={passwordChecks.minLength ? styles.ruleOk : styles.ruleMuted}>8+ chars</span>
                <span style={passwordChecks.upper ? styles.ruleOk : styles.ruleMuted}>Uppercase</span>
                <span style={passwordChecks.lower ? styles.ruleOk : styles.ruleMuted}>Lowercase</span>
                <span style={passwordChecks.number ? styles.ruleOk : styles.ruleMuted}>Number</span>
                <span style={passwordChecks.symbol ? styles.ruleOk : styles.ruleMuted}>Symbol</span>
              </div>
            </div>

            <div style={styles.passwordRow}>
              <input
                style={{ ...styles.input, margin: 0 }}
                name="confirmPassword"
                placeholder="Confirm password"
                type={showConfirmPassword ? "text" : "password"}
                value={form.confirmPassword}
                onChange={handle}
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowConfirmPassword((prev) => !prev)}
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </>
        )}

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
  modal: { background: "#fff", borderRadius: 12, padding: 24, width: 380, maxHeight: "85vh", overflowY: "auto", position: "relative", display: "flex", flexDirection: "column", gap: 12 },
  title: { margin: 0, fontSize: 20, fontWeight: 600 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, outline: "none" },
  btn: { padding: "12px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer" },
  error: { color: "#dc2626", fontSize: 13, margin: 0 },
  toggle: { fontSize: 13, textAlign: "center", margin: 0 },
  link: { color: "#2563eb", cursor: "pointer", fontWeight: 500 },
  close: { position: "absolute", top: 12, right: 14, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999" },
  passwordRow: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" },
  eyeBtn: { border: "1px solid #d1d5db", background: "#fff", color: "#374151", borderRadius: 8, padding: "10px 12px", cursor: "pointer", fontWeight: 600, fontSize: 12 },
  passwordHintBox: { border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#f9fafb", display: "flex", flexDirection: "column", gap: 8 },
  strengthText: { fontSize: 12, fontWeight: 700 },
  strengthBarTrack: { height: 8, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" },
  strengthBarFill: { height: "100%", borderRadius: 999, transition: "width 180ms ease" },
  ruleList: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, fontWeight: 600 },
  ruleOk: { color: "#047857" },
  ruleMuted: { color: "#6b7280" },
};