import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";

export default function AuthModal({ onClose }) {
    const { login } = useAuth();
    const [mode, setMode] = useState("login");
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        vehicle_model: "",
        battery_capacity_kwh: "",
        range_km: "",
        otp: "",
        twoFactorCode: "",
        resetToken: "",
        newPassword: "",
        confirmNewPassword: "",
    });
    const [tempTwoFactorToken, setTempTwoFactorToken] = useState("");
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [fallbackOtp, setFallbackOtp] = useState("");
    const [fallbackResetToken, setFallbackResetToken] = useState("");
    const [resendCooldown, setResendCooldown] = useState(0);

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const passwordChecks = useMemo(() => {
        const password = form.password || "";
        return {
            minLength: password.length >= 8,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            symbol: /[^A-Za-z0-9]/.test(password),
        };
    }, [form.password]);

    const resetPasswordChecks = useMemo(() => {
        const password = form.newPassword || "";
        return {
            minLength: password.length >= 8,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            symbol: /[^A-Za-z0-9]/.test(password),
        };
    }, [form.newPassword]);

    const passwordScore = Object.values(passwordChecks).filter(Boolean).length;
    const resetPasswordScore = Object.values(resetPasswordChecks).filter(Boolean).length;

    const passwordStrengthLabel =
        passwordScore <= 2 ? "Weak" : passwordScore <= 4 ? "Medium" : "Strong";

    const resetPasswordStrengthLabel =
        resetPasswordScore <= 2 ? "Weak" : resetPasswordScore <= 4 ? "Medium" : "Strong";

    const setModeSafe = (nextMode) => {
        setMode(nextMode);
        setError("");
        setInfo("");
        setFallbackOtp("");
        setFallbackResetToken("");
    };

    const handle = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
        if (error) setError("");
    };

    const validateEmail = () => EMAIL_REGEX.test(String(form.email || "").trim().toLowerCase());

    useEffect(() => {
        if (resendCooldown <= 0) return undefined;
        const timer = setInterval(() => {
            setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [resendCooldown]);

    const setDeliveryInfo = (responseData, defaultMessage) => {
        const baseMessage = responseData?.message || defaultMessage;
        const nextFallbackOtp = responseData?.fallbackOtp || responseData?.devOtp || "";
        const nextFallbackResetToken = responseData?.fallbackResetToken || responseData?.devResetToken || "";

        setInfo(baseMessage);
        setFallbackOtp(nextFallbackOtp);
        setFallbackResetToken(nextFallbackResetToken);

        if (nextFallbackOtp) {
            setForm((prev) => ({ ...prev, otp: nextFallbackOtp }));
        }
        if (nextFallbackResetToken) {
            setForm((prev) => ({ ...prev, resetToken: nextFallbackResetToken }));
        }
    };

    const copyText = async (value, label) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(String(value));
            setInfo(`${label} copied to clipboard.`);
        } catch {
            setInfo(`Unable to copy automatically. Please copy this ${label.toLowerCase()} manually.`);
        }
    };

    const submitLogin = async () => {
        if (!validateEmail()) {
            setError("Please enter a valid email address");
            return;
        }

        if (!form.password) {
            setError("Password is required");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/login", {
                email: String(form.email).trim().toLowerCase(),
                password: form.password,
            });

            if (res.data?.requiresTwoFactor) {
                setTempTwoFactorToken(res.data.tempToken);
                setInfo("Enter your authenticator app code to continue");
                setMode("twoFactor");
                return;
            }

            login(res.data.token, res.data.user);
            onClose();
        } catch (err) {
            const code = err.response?.data?.code;
            if (code === "EMAIL_NOT_VERIFIED") {
                setInfo("Your email is not verified. Enter OTP to verify.");
                setMode("verifyEmail");
            }
            setError(err.response?.data?.error || "Sign in failed");
        } finally {
            setLoading(false);
        }
    };

    const submitRegister = async () => {
        const email = String(form.email || "").trim().toLowerCase();
        if (!form.name || String(form.name).trim().length < 2) {
            setError("Name must be at least 2 characters");
            return;
        }
        if (!EMAIL_REGEX.test(email)) {
            setError("Please enter a valid email address");
            return;
        }
        if (passwordScore < 5) {
            setError("Use a stronger password (8+ chars, upper, lower, number, symbol)");
            return;
        }
        if (form.password !== form.confirmPassword) {
            setError("Passwords do not match");
            return;
        }
        if (form.battery_capacity_kwh !== "" && Number(form.battery_capacity_kwh) <= 0) {
            setError("Battery capacity must be greater than 0");
            return;
        }
        if (form.range_km !== "" && Number(form.range_km) <= 0) {
            setError("Range must be greater than 0");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/register", {
                name: String(form.name).trim(),
                email,
                password: form.password,
                vehicle_model: form.vehicle_model,
                battery_capacity_kwh: form.battery_capacity_kwh,
                range_km: form.range_km,
            });

            setDeliveryInfo(res.data, "Account created. Verify your email OTP.");
            setMode("verifyEmail");
        } catch (err) {
            setError(err.response?.data?.error || "Registration failed");
        } finally {
            setLoading(false);
        }
    };

    const submitVerifyEmail = async () => {
        if (!validateEmail()) {
            setError("Please enter a valid email address");
            return;
        }
        if (!form.otp || String(form.otp).trim().length < 6) {
            setError("Enter the 6-digit OTP");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/verify-email", {
                email: String(form.email).trim().toLowerCase(),
                otp: String(form.otp).trim(),
            });
            setInfo(res.data?.message || "Email verified successfully");
            setMode("login");
        } catch (err) {
            setError(err.response?.data?.error || "Failed to verify email");
        } finally {
            setLoading(false);
        }
    };

    const resendOtp = async () => {
        if (!validateEmail()) {
            setError("Please enter a valid email address");
            return;
        }
        if (resendCooldown > 0) {
            setError(`Please wait ${resendCooldown}s before resending OTP`);
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/resend-verification", {
                email: String(form.email).trim().toLowerCase(),
            });
            setDeliveryInfo(res.data, "Verification OTP sent");
            setResendCooldown(30);
        } catch (err) {
            setError(err.response?.data?.error || "Failed to resend OTP");
        } finally {
            setLoading(false);
        }
    };

    const submitTwoFactor = async () => {
        if (!form.twoFactorCode || String(form.twoFactorCode).trim().length < 6) {
            setError("Enter your 2FA code");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/login-2fa", {
                tempToken: tempTwoFactorToken,
                code: String(form.twoFactorCode).trim(),
            });
            login(res.data.token, res.data.user);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || "Invalid 2FA code");
        } finally {
            setLoading(false);
        }
    };

    const submitForgotPassword = async () => {
        if (!validateEmail()) {
            setError("Please enter a valid email address");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/forgot-password", {
                email: String(form.email).trim().toLowerCase(),
            });
            setDeliveryInfo(res.data, "Reset instructions sent");
            setMode("resetPassword");
        } catch (err) {
            setError(err.response?.data?.error || "Failed to request password reset");
        } finally {
            setLoading(false);
        }
    };

    const submitResetPassword = async () => {
        if (!form.resetToken || String(form.resetToken).trim().length < 8) {
            setError("Enter the reset token from your email");
            return;
        }
        if (resetPasswordScore < 5) {
            setError("Use a stronger new password (8+ chars, upper, lower, number, symbol)");
            return;
        }
        if (form.newPassword !== form.confirmNewPassword) {
            setError("New passwords do not match");
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post("/auth/reset-password", {
                token: String(form.resetToken).trim(),
                newPassword: form.newPassword,
            });
            setInfo(res.data?.message || "Password reset successful");
            setMode("login");
        } catch (err) {
            setError(err.response?.data?.error || "Failed to reset password");
        } finally {
            setLoading(false);
        }
    };

    const renderPasswordChecklist = (checks, label, score, prefix = "") => (
        <div style={styles.passwordHintBox}>
            <div style={{ ...styles.strengthText, color: label === "Strong" ? "#047857" : label === "Medium" ? "#92400e" : "#b91c1c" }}>
                {prefix}Password strength: {label}
            </div>
            <div style={styles.strengthBarTrack}>
                <div
                    style={{
                        ...styles.strengthBarFill,
                        width: `${(score / 5) * 100}%`,
                        background: label === "Strong" ? "#10b981" : label === "Medium" ? "#f59e0b" : "#ef4444",
                    }}
                />
            </div>
            <div style={styles.ruleList}>
                <span style={checks.minLength ? styles.ruleOk : styles.ruleMuted}>8+ chars</span>
                <span style={checks.upper ? styles.ruleOk : styles.ruleMuted}>Uppercase</span>
                <span style={checks.lower ? styles.ruleOk : styles.ruleMuted}>Lowercase</span>
                <span style={checks.number ? styles.ruleOk : styles.ruleMuted}>Number</span>
                <span style={checks.symbol ? styles.ruleOk : styles.ruleMuted}>Symbol</span>
            </div>
        </div>
    );

    const titleByMode = {
        login: "Sign In",
        register: "Create Account",
        verifyEmail: "Verify Email",
        twoFactor: "Two-Factor Authentication",
        forgotPassword: "Forgot Password",
        resetPassword: "Reset Password",
    };

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <h2 style={styles.title}>{titleByMode[mode] || "Authentication"}</h2>

                {(mode === "login" || mode === "register" || mode === "verifyEmail" || mode === "forgotPassword") && (
                    <input style={styles.input} name="email" placeholder="Email" type="email" value={form.email} onChange={handle} />
                )}

                {mode === "register" && (
                    <>
                        <input style={styles.input} name="name" placeholder="Full name" value={form.name} onChange={handle} />

                        <div style={styles.passwordRow}>
                            <input
                                style={{ ...styles.input, margin: 0 }}
                                name="password"
                                placeholder="Password"
                                type={showPassword ? "text" : "password"}
                                value={form.password}
                                onChange={handle}
                            />
                            <button type="button" style={styles.eyeBtn} onClick={() => setShowPassword((prev) => !prev)}>
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>

                        {renderPasswordChecklist(passwordChecks, passwordStrengthLabel, passwordScore)}

                        <input
                            style={styles.input}
                            name="confirmPassword"
                            placeholder="Confirm password"
                            type="password"
                            value={form.confirmPassword}
                            onChange={handle}
                        />

                        <input
                            style={styles.input}
                            name="vehicle_model"
                            placeholder="Vehicle model (optional)"
                            value={form.vehicle_model}
                            onChange={handle}
                        />
                        <input
                            style={styles.input}
                            name="battery_capacity_kwh"
                            placeholder="Battery capacity (kWh, optional)"
                            type="number"
                            value={form.battery_capacity_kwh}
                            onChange={handle}
                        />
                        <input
                            style={styles.input}
                            name="range_km"
                            placeholder="Range (km, optional)"
                            type="number"
                            value={form.range_km}
                            onChange={handle}
                        />
                    </>
                )}

                {mode === "login" && (
                    <>
                        <div style={styles.passwordRow}>
                            <input
                                style={{ ...styles.input, margin: 0 }}
                                name="password"
                                placeholder="Password"
                                type={showPassword ? "text" : "password"}
                                value={form.password}
                                onChange={handle}
                            />
                            <button type="button" style={styles.eyeBtn} onClick={() => setShowPassword((prev) => !prev)}>
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                        <button type="button" style={styles.textLink} onClick={() => setModeSafe("forgotPassword")}>
                            Forgot password?
                        </button>
                    </>
                )}

                {mode === "verifyEmail" && (
                    <>
                        <input
                            style={styles.input}
                            name="otp"
                            placeholder="6-digit OTP"
                            value={form.otp}
                            onChange={handle}
                        />
                        {fallbackOtp && (
                            <div style={styles.fallbackBox}>
                                <div style={styles.fallbackTitle}>Fallback OTP</div>
                                <div style={styles.fallbackValue}>{fallbackOtp}</div>
                                <div style={styles.fallbackActions}>
                                    <button type="button" style={styles.secondaryBtn} onClick={() => setForm((prev) => ({ ...prev, otp: fallbackOtp }))}>
                                        Use OTP
                                    </button>
                                    <button type="button" style={styles.secondaryBtn} onClick={() => copyText(fallbackOtp, "OTP")}>
                                        Copy OTP
                                    </button>
                                </div>
                            </div>
                        )}
                        <button type="button" style={styles.secondaryBtn} onClick={resendOtp} disabled={loading}>
                            {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : "Resend OTP"}
                        </button>
                    </>
                )}

                {mode === "twoFactor" && (
                    <input
                        style={styles.input}
                        name="twoFactorCode"
                        placeholder="Enter 2FA code"
                        value={form.twoFactorCode}
                        onChange={handle}
                    />
                )}

                {mode === "forgotPassword" && (
                    <p style={styles.helperText}>Enter your account email to receive a reset token.</p>
                )}

                {mode === "resetPassword" && (
                    <>
                        <input
                            style={styles.input}
                            name="resetToken"
                            placeholder="Reset token from email"
                            value={form.resetToken}
                            onChange={handle}
                        />
                        {fallbackResetToken && (
                            <div style={styles.fallbackBox}>
                                <div style={styles.fallbackTitle}>Fallback Reset Token</div>
                                <div style={styles.fallbackValue}>{fallbackResetToken}</div>
                                <div style={styles.fallbackActions}>
                                    <button type="button" style={styles.secondaryBtn} onClick={() => setForm((prev) => ({ ...prev, resetToken: fallbackResetToken }))}>
                                        Use Token
                                    </button>
                                    <button type="button" style={styles.secondaryBtn} onClick={() => copyText(fallbackResetToken, "Reset token")}>
                                        Copy Token
                                    </button>
                                </div>
                            </div>
                        )}
                        <div style={styles.passwordRow}>
                            <input
                                style={{ ...styles.input, margin: 0 }}
                                name="newPassword"
                                placeholder="New password"
                                type={showNewPassword ? "text" : "password"}
                                value={form.newPassword}
                                onChange={handle}
                            />
                            <button type="button" style={styles.eyeBtn} onClick={() => setShowNewPassword((prev) => !prev)}>
                                {showNewPassword ? "Hide" : "Show"}
                            </button>
                        </div>

                        {renderPasswordChecklist(resetPasswordChecks, resetPasswordStrengthLabel, resetPasswordScore, "New ")}

                        <input
                            style={styles.input}
                            name="confirmNewPassword"
                            placeholder="Confirm new password"
                            type="password"
                            value={form.confirmNewPassword}
                            onChange={handle}
                        />
                    </>
                )}

                {error && <p style={styles.error}>{error}</p>}
                {info && <p style={styles.info}>{info}</p>}

                <button
                    style={styles.btn}
                    onClick={() => {
                        if (mode === "login") return submitLogin();
                        if (mode === "register") return submitRegister();
                        if (mode === "verifyEmail") return submitVerifyEmail();
                        if (mode === "twoFactor") return submitTwoFactor();
                        if (mode === "forgotPassword") return submitForgotPassword();
                        if (mode === "resetPassword") return submitResetPassword();
                        return null;
                    }}
                    disabled={loading}
                >
                    {loading ? "Please wait..." :
                        mode === "login" ? "Sign In" :
                            mode === "register" ? "Create Account" :
                                mode === "verifyEmail" ? "Verify Email" :
                                    mode === "twoFactor" ? "Verify 2FA" :
                                        mode === "forgotPassword" ? "Send Reset Token" :
                                            "Reset Password"}
                </button>

                {(mode === "login" || mode === "register") && (
                    <p style={styles.toggle}>
                        {mode === "login" ? "No account?" : "Already registered?"}{" "}
                        <span style={styles.link} onClick={() => setModeSafe(mode === "login" ? "register" : "login")}>
                            {mode === "login" ? "Sign up" : "Sign in"}
                        </span>
                    </p>
                )}

                {(mode === "verifyEmail" || mode === "twoFactor" || mode === "forgotPassword" || mode === "resetPassword") && (
                    <button type="button" style={styles.textLink} onClick={() => setModeSafe("login")}>
                        Back to Sign In
                    </button>
                )}

                <button style={styles.close} onClick={onClose}>✕</button>
            </div>
        </div>
    );
}

const styles = {
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
    },
    modal: {
        background: "#fff",
        borderRadius: 12,
        padding: 24,
        width: 390,
        maxHeight: "88vh",
        overflowY: "auto",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    title: { margin: 0, fontSize: 20, fontWeight: 600 },
    input: {
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #ddd",
        fontSize: 14,
        outline: "none",
    },
    btn: {
        padding: "12px",
        borderRadius: 8,
        background: "#2563eb",
        color: "#fff",
        border: "none",
        fontWeight: 600,
        fontSize: 15,
        cursor: "pointer",
    },
    secondaryBtn: {
        padding: "10px",
        borderRadius: 8,
        background: "#fff",
        color: "#1f2937",
        border: "1px solid #d1d5db",
        fontWeight: 600,
        fontSize: 13,
        cursor: "pointer",
    },
    error: { color: "#dc2626", fontSize: 13, margin: 0 },
    info: { color: "#0f766e", fontSize: 13, margin: 0 },
    helperText: { color: "#6b7280", fontSize: 13, margin: 0 },
    toggle: { fontSize: 13, textAlign: "center", margin: 0 },
    link: { color: "#2563eb", cursor: "pointer", fontWeight: 500 },
    close: {
        position: "absolute",
        top: 12,
        right: 14,
        background: "none",
        border: "none",
        fontSize: 18,
        cursor: "pointer",
        color: "#999",
    },
    passwordRow: {
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        alignItems: "center",
    },
    eyeBtn: {
        border: "1px solid #d1d5db",
        background: "#fff",
        color: "#374151",
        borderRadius: 8,
        padding: "10px 12px",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 12,
    },
    textLink: {
        border: "none",
        background: "transparent",
        color: "#2563eb",
        fontWeight: 600,
        cursor: "pointer",
        alignSelf: "flex-start",
        padding: 0,
        fontSize: 13,
    },
    passwordHintBox: {
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 10,
        background: "#f9fafb",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    strengthText: { fontSize: 12, fontWeight: 700 },
    strengthBarTrack: { height: 8, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" },
    strengthBarFill: { height: "100%", borderRadius: 999, transition: "width 180ms ease" },
    ruleList: { display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, fontWeight: 600 },
    ruleOk: { color: "#047857" },
    ruleMuted: { color: "#6b7280" },
    fallbackBox: {
        border: "1px solid #99f6e4",
        background: "#f0fdfa",
        borderRadius: 8,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    fallbackTitle: { fontSize: 12, fontWeight: 700, color: "#115e59" },
    fallbackValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 14,
        color: "#134e4a",
        wordBreak: "break-all",
    },
    fallbackActions: { display: "flex", gap: 8 },
};
