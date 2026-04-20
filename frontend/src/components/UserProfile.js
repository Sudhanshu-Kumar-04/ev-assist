import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function UserProfile({ onClose }) {
  const { user, token, login } = useAuth();
  const [tab, setTab] = useState("profile");
  const [form, setForm] = useState({
    name: user?.name || "",
    vehicle_model: user?.vehicle_model || "",
    battery_capacity_kwh: user?.battery_capacity_kwh || "",
    range_km: user?.range_km || "",
  });
  const [passwords, setPasswords] = useState({
    currentPassword: "", newPassword: "", confirmPassword: ""
  });
  const [loading, setLoading] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [twoFaSetup, setTwoFaSetup] = useState(null);
  const [twoFaCode, setTwoFaCode] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const validateProfile = () => {
    const errors = {};
    const name = String(form.name || "").trim();
    const batteryRaw = form.battery_capacity_kwh;
    const rangeRaw = form.range_km;

    if (!name) errors.name = "Full name is required";

    if (batteryRaw !== "") {
      const battery = Number(batteryRaw);
      if (Number.isNaN(battery) || battery <= 0) {
        errors.battery_capacity_kwh = "Battery capacity must be a positive number";
      }
    }

    if (rangeRaw !== "") {
      const range = Number(rangeRaw);
      if (Number.isNaN(range) || range <= 0) {
        errors.range_km = "Range must be a positive number";
      }
    }

    return errors;
  };

  const saveProfile = async () => {
    const validationErrors = validateProfile();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setMessage({ text: "Please fix highlighted fields", type: "error" });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });
    try {
      const payload = {
        name: String(form.name || "").trim(),
        vehicle_model: String(form.vehicle_model || "").trim() || null,
        battery_capacity_kwh:
          form.battery_capacity_kwh === "" ? null : Number(form.battery_capacity_kwh),
        range_km: form.range_km === "" ? null : Number(form.range_km),
      };

      const res = await axios.put(
        "/auth/me", payload, { headers }
      );
      // Update auth context with new user data
      login(token, res.data);
      setMessage({ text: "Profile updated successfully ✓", type: "success" });
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Update failed", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword !== passwords.confirmPassword) {
      setMessage({ text: "New passwords don't match", type: "error" });
      return;
    }
    setLoading(true);
    setMessage({ text: "", type: "" });
    try {
      await axios.put("/auth/change-password", {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      }, { headers });
      setMessage({ text: "Password changed successfully ✓", type: "success" });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const startTwoFactorSetup = async () => {
    setSecurityLoading(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await axios.post("/auth/2fa/setup", {}, { headers });
      setTwoFaSetup(res.data);
      setMessage({ text: "Scan QR and enter your app code to enable 2FA", type: "success" });
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to start 2FA setup", type: "error" });
    } finally {
      setSecurityLoading(false);
    }
  };

  const verifyTwoFactorSetup = async () => {
    if (!twoFaCode || twoFaCode.trim().length < 6) {
      setMessage({ text: "Enter a valid 2FA code", type: "error" });
      return;
    }

    setSecurityLoading(true);
    setMessage({ text: "", type: "" });
    try {
      await axios.post("/auth/2fa/verify-setup", { code: twoFaCode.trim() }, { headers });
      login(token, { ...user, two_factor_enabled: true });
      setTwoFaSetup(null);
      setTwoFaCode("");
      setMessage({ text: "2FA enabled successfully ✓", type: "success" });
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to verify 2FA setup", type: "error" });
    } finally {
      setSecurityLoading(false);
    }
  };

  const disableTwoFactor = async () => {
    if (!twoFaCode || twoFaCode.trim().length < 6) {
      setMessage({ text: "Enter your 2FA code to disable", type: "error" });
      return;
    }

    setSecurityLoading(true);
    setMessage({ text: "", type: "" });
    try {
      await axios.post("/auth/2fa/disable", { code: twoFaCode.trim() }, { headers });
      login(token, { ...user, two_factor_enabled: false });
      setTwoFaCode("");
      setMessage({ text: "2FA disabled successfully", type: "success" });
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to disable 2FA", type: "error" });
    } finally {
      setSecurityLoading(false);
    }
  };

  // EV stats derived from profile
  const batteryKwh = parseFloat(form.battery_capacity_kwh) || 0;
  const rangeKm = parseFloat(form.range_km) || 0;
  const efficiencyKwhPer100km = batteryKwh > 0 && rangeKm > 0
    ? ((batteryKwh / rangeKm) * 100).toFixed(1)
    : null;

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.avatar}>{user?.name?.charAt(0).toUpperCase()}</div>
          <div>
            <h3 style={s.name}>{user?.name}</h3>
            <p style={s.email}>{user?.email}</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {["profile", "password", "security"].map(t => (
            <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => { setTab(t); setMessage({ text: "", type: "" }); }}>
              {t === "profile" ? "👤 Profile & Vehicle" : t === "password" ? "🔒 Change Password" : "🛡️ Security"}
            </button>
          ))}
        </div>

        <div style={s.body}>
          {tab === "profile" && (
            <>
              {/* Personal info */}
              <p style={s.sectionTitle}>Personal Information</p>
              <div style={s.field}>
                <label style={s.label}>Full Name</label>
                <input style={{ ...s.input, ...(fieldErrors.name ? s.inputError : {}) }} value={form.name}
                  onChange={e => {
                    setForm({ ...form, name: e.target.value });
                    if (fieldErrors.name) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.name;
                        return next;
                      });
                    }
                    if (message.text) setMessage({ text: "", type: "" });
                  }} />
                {fieldErrors.name ? <span style={s.fieldErrorText}>{fieldErrors.name}</span> : null}
              </div>
              <div style={s.field}>
                <label style={s.label}>Email</label>
                <input style={{ ...s.input, background: "#f9fafb", color: "#9ca3af" }}
                  value={user?.email} disabled />
              </div>

              {/* Vehicle info */}
              <p style={{ ...s.sectionTitle, marginTop: 16 }}>🚗 Vehicle Details</p>
              <div style={s.field}>
                <label style={s.label}>Vehicle Model</label>
                <input style={s.input} placeholder="e.g. Tata Nexon EV, MG ZS EV"
                  value={form.vehicle_model}
                  onChange={e => {
                    setForm({ ...form, vehicle_model: e.target.value });
                    if (message.text) setMessage({ text: "", type: "" });
                  }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={s.field}>
                  <label style={s.label}>Battery Capacity (kWh)</label>
                  <input style={{ ...s.input, ...(fieldErrors.battery_capacity_kwh ? s.inputError : {}) }} type="number" min="0" step="0.1" placeholder="e.g. 30.2"
                    value={form.battery_capacity_kwh}
                    onChange={e => {
                      setForm({ ...form, battery_capacity_kwh: e.target.value });
                      if (fieldErrors.battery_capacity_kwh) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.battery_capacity_kwh;
                          return next;
                        });
                      }
                      if (message.text) setMessage({ text: "", type: "" });
                    }} />
                  {fieldErrors.battery_capacity_kwh ? <span style={s.fieldErrorText}>{fieldErrors.battery_capacity_kwh}</span> : null}
                </div>
                <div style={s.field}>
                  <label style={s.label}>Range (km)</label>
                  <input style={{ ...s.input, ...(fieldErrors.range_km ? s.inputError : {}) }} type="number" min="0" step="1" placeholder="e.g. 312"
                    value={form.range_km}
                    onChange={e => {
                      setForm({ ...form, range_km: e.target.value });
                      if (fieldErrors.range_km) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.range_km;
                          return next;
                        });
                      }
                      if (message.text) setMessage({ text: "", type: "" });
                    }} />
                  {fieldErrors.range_km ? <span style={s.fieldErrorText}>{fieldErrors.range_km}</span> : null}
                </div>
              </div>

              {/* Live stats card */}
              {batteryKwh > 0 && rangeKm > 0 && (
                <div style={s.statsCard}>
                  <p style={s.statsTitle}>⚡ Your EV Stats</p>
                  <div style={s.statsGrid}>
                    <div style={s.statItem}>
                      <span style={s.statValue}>{batteryKwh} kWh</span>
                      <span style={s.statLabel}>Battery</span>
                    </div>
                    <div style={s.statItem}>
                      <span style={s.statValue}>{rangeKm} km</span>
                      <span style={s.statLabel}>Range</span>
                    </div>
                    <div style={s.statItem}>
                      <span style={s.statValue}>{efficiencyKwhPer100km}</span>
                      <span style={s.statLabel}>kWh/100km</span>
                    </div>
                  </div>
                </div>
              )}

              {message.text && (
                <p style={{ ...s.msg, color: message.type === "success" ? "#059669" : "#dc2626" }}>
                  {message.text}
                </p>
              )}
              <button style={s.btn} onClick={saveProfile} disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </>
          )}

          {tab === "password" && (
            <>
              <p style={s.sectionTitle}>Change Password</p>
              {["currentPassword", "newPassword", "confirmPassword"].map((field, i) => (
                <div key={field} style={s.field}>
                  <label style={s.label}>
                    {field === "currentPassword" ? "Current Password"
                      : field === "newPassword" ? "New Password"
                        : "Confirm New Password"}
                  </label>
                  <input style={s.input} type="password"
                    value={passwords[field]}
                    onChange={e => setPasswords({ ...passwords, [field]: e.target.value })} />
                </div>
              ))}
              {message.text && (
                <p style={{ ...s.msg, color: message.type === "success" ? "#059669" : "#dc2626" }}>
                  {message.text}
                </p>
              )}
              <button style={s.btn} onClick={changePassword} disabled={loading}>
                {loading ? "Updating..." : "Update Password"}
              </button>
            </>
          )}

          {tab === "security" && (
            <>
              <p style={s.sectionTitle}>Account Security</p>
              <div style={s.securityCard}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                  Two-Factor Authentication (TOTP)
                </div>
                <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
                  Status: {user?.two_factor_enabled ? "Enabled" : "Disabled"}
                </div>

                {!user?.two_factor_enabled && !twoFaSetup ? (
                  <button style={s.btn} onClick={startTwoFactorSetup} disabled={securityLoading}>
                    {securityLoading ? "Preparing..." : "Enable 2FA"}
                  </button>
                ) : null}

                {twoFaSetup ? (
                  <div style={{ marginTop: 10 }}>
                    {twoFaSetup.qrCodeDataUrl ? (
                      <img
                        src={twoFaSetup.qrCodeDataUrl}
                        alt="2FA QR"
                        style={{ width: 170, height: 170, border: "1px solid #e5e7eb", borderRadius: 8 }}
                      />
                    ) : null}
                    <p style={{ fontSize: 12, color: "#374151", margin: "8px 0 4px" }}>
                      Manual key: <b>{twoFaSetup.manualEntryKey}</b>
                    </p>
                    <input
                      style={s.input}
                      placeholder="Enter 6-digit authenticator code"
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value)}
                    />
                    <button style={s.btn} onClick={verifyTwoFactorSetup} disabled={securityLoading}>
                      {securityLoading ? "Verifying..." : "Verify & Enable"}
                    </button>
                  </div>
                ) : null}

                {user?.two_factor_enabled ? (
                  <div style={{ marginTop: 10 }}>
                    <input
                      style={s.input}
                      placeholder="Enter current 2FA code to disable"
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value)}
                    />
                    <button
                      style={{ ...s.btn, background: "#dc2626" }}
                      onClick={disableTwoFactor}
                      disabled={securityLoading}
                    >
                      {securityLoading ? "Processing..." : "Disable 2FA"}
                    </button>
                  </div>
                ) : null}
              </div>

              {message.text && (
                <p style={{ ...s.msg, color: message.type === "success" ? "#059669" : "#dc2626" }}>
                  {message.text}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 },
  panel: { background: "#fff", borderRadius: 16, width: 440, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 16px", background: "#1e293b", position: "relative" },
  avatar: { width: 48, height: 48, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "#fff", flexShrink: 0 },
  name: { margin: 0, color: "#fff", fontSize: 16, fontWeight: 600 },
  email: { margin: 0, color: "#94a3b8", fontSize: 12 },
  closeBtn: { position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer" },
  tabs: { display: "flex", borderBottom: "1px solid #e5e7eb" },
  tab: { flex: 1, padding: "12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#6b7280", borderBottom: "3px solid transparent" },
  tabActive: { color: "#2563eb", borderBottom: "3px solid #2563eb", background: "#f8faff" },
  body: { overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 10 },
  sectionTitle: { margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280" },
  input: { padding: "9px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, outline: "none" },
  inputError: { border: "1px solid #dc2626", background: "#fef2f2" },
  fieldErrorText: { marginTop: 2, color: "#dc2626", fontSize: 12, fontWeight: 500 },
  statsCard: { background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 14 },
  statsTitle: { margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: "#0369a1" },
  securityCard: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f9fafb" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  statItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: 700, color: "#0369a1" },
  statLabel: { fontSize: 11, color: "#64748b" },
  msg: { margin: 0, fontSize: 13, fontWeight: 500 },
  btn: { padding: "11px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer", marginTop: 4 },
};