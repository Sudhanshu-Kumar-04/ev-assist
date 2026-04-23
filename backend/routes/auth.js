const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const { pool } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
authenticator.options = { step: 30, window: 1 };

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const authAttemptStore = new Map();

function authRateLimit(action, maxAttempts, windowMs) {
    return (req, res, next) => {
        const emailPart = String(req.body?.email || "").trim().toLowerCase();
        const key = `${action}:${req.ip}:${emailPart}`;
        const now = Date.now();
        const existing = authAttemptStore.get(key);

        if (!existing || now > existing.resetAt) {
            authAttemptStore.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (existing.count >= maxAttempts) {
            const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
            res.set("Retry-After", String(retryAfterSec));
            return res.status(429).json({ error: `Too many attempts. Try again in ${retryAfterSec}s` });
        }

        existing.count += 1;
        authAttemptStore.set(key, existing);
        next();
    };
}

function issueAuthToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function hashValue(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function validatePassword(password) {
    const value = String(password || "");
    if (value.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter";
    if (!/[a-z]/.test(value)) return "Password must include at least one lowercase letter";
    if (!/[0-9]/.test(value)) return "Password must include at least one number";
    if (!/[^A-Za-z0-9]/.test(value)) return "Password must include at least one special character";
    return null;
}

function getEmailTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) return null;

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
}

async function sendMail({ to, subject, text, html }) {
    const transporter = getEmailTransporter();
    if (!transporter) {
        console.warn("SMTP not configured; skipping email send");
        return false;
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({ from, to, subject, text, html });
    return true;
}

async function createEmailVerificationOtp(userId) {
    const otp = generateOtp();
    const otpHash = hashValue(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
        `UPDATE users
     SET email_verification_otp_hash = $1,
         email_verification_otp_expires_at = $2,
         email_verified = false
     WHERE id = $3`,
        [otpHash, expiresAt, userId]
    );

    return { otp, expiresAt };
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vehicle_model: user.vehicle_model,
        battery_capacity_kwh: user.battery_capacity_kwh,
        range_km: user.range_km,
        email_verified: user.email_verified,
        two_factor_enabled: user.two_factor_enabled,
    };
}

// Register
router.post("/register", authRateLimit("register", 6, 15 * 60 * 1000), async (req, res) => {
    const { name, email, password, vehicle_model, battery_capacity_kwh, range_km } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email and password are required" });
    }

    try {
        const normalizedName = String(name).trim();
        const normalizedEmail = String(email).trim().toLowerCase();

        if (!normalizedName || normalizedName.length < 2) {
            return res.status(400).json({ error: "Name must be at least 2 characters" });
        }

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Please provide a valid email" });
        }

        const passwordError = validatePassword(password);
        if (passwordError) return res.status(400).json({ error: passwordError });

        const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "Email already registered" });
        }

        const adminCountResult = await pool.query(
            "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
        );
        const existingAdminCount = adminCountResult.rows[0]?.count || 0;
        const hasExplicitAdminList = ADMIN_EMAILS.length > 0;
        const role = ADMIN_EMAILS.includes(normalizedEmail)
            ? "admin"
            : !hasExplicitAdminList && existingAdminCount === 0
                ? "admin"
                : "user";

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await pool.query(
            `INSERT INTO users
         (name, email, password_hash, role, vehicle_model, battery_capacity_kwh, range_km, email_verified)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING id, name, email, role, vehicle_model, battery_capacity_kwh, range_km, email_verified, two_factor_enabled`,
            [
                normalizedName,
                normalizedEmail,
                passwordHash,
                role,
                String(vehicle_model || "").trim() || null,
                battery_capacity_kwh === "" || battery_capacity_kwh === undefined || battery_capacity_kwh === null
                    ? null
                    : Number(battery_capacity_kwh),
                range_km === "" || range_km === undefined || range_km === null
                    ? null
                    : Number(range_km),
            ]
        );

        const user = result.rows[0];
        const { otp } = await createEmailVerificationOtp(user.id);

        const verifyText = `Your EV Assist verification code is ${otp}. It expires in 10 minutes.`;
        await sendMail({
            to: user.email,
            subject: "Verify your EV Assist account",
            text: verifyText,
            html: `<p>Your EV Assist verification code is:</p><h2>${otp}</h2><p>This code expires in 10 minutes.</p>`,
        });

        const response = {
            message: "Account created. Please verify your email with the OTP sent to your inbox.",
            requiresEmailVerification: true,
            email: user.email,
            user: sanitizeUser(user),
        };

        if (process.env.NODE_ENV !== "production" && !process.env.SMTP_HOST) {
            response.devOtp = otp;
        }

        return res.status(201).json(response);
    } catch (err) {
        console.error("Register error:", err);
        return res.status(500).json({ error: "Registration failed" });
    }
});

router.post("/verify-email", authRateLimit("verify-email", 10, 15 * 60 * 1000), async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: "Email and OTP are required" });
    }

    try {
        const normalizedEmail = String(email).trim().toLowerCase();
        const result = await pool.query(
            `SELECT id, email_verified, email_verification_otp_hash, email_verification_otp_expires_at
       FROM users WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Invalid verification request" });
        }

        const user = result.rows[0];
        if (user.email_verified) {
            return res.json({ message: "Email already verified" });
        }

        if (!user.email_verification_otp_hash || !user.email_verification_otp_expires_at) {
            return res.status(400).json({ error: "OTP not found. Request a new OTP" });
        }

        if (new Date(user.email_verification_otp_expires_at).getTime() < Date.now()) {
            return res.status(400).json({ error: "OTP expired. Request a new OTP" });
        }

        const otpHash = hashValue(String(otp).trim());
        if (otpHash !== user.email_verification_otp_hash) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        await pool.query(
            `UPDATE users
       SET email_verified = true,
           email_verification_otp_hash = null,
           email_verification_otp_expires_at = null
       WHERE id = $1`,
            [user.id]
        );

        return res.json({ message: "Email verified successfully. You can now sign in." });
    } catch (err) {
        console.error("Verify email error:", err);
        return res.status(500).json({ error: "Failed to verify email" });
    }
});

router.post("/resend-verification", authRateLimit("resend-verification", 5, 15 * 60 * 1000), async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const normalizedEmail = String(email).trim().toLowerCase();
        const result = await pool.query(
            `SELECT id, email, email_verified FROM users WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(200).json({ message: "If account exists, verification OTP has been sent" });
        }

        const user = result.rows[0];
        if (user.email_verified) {
            return res.json({ message: "Email is already verified" });
        }

        const { otp } = await createEmailVerificationOtp(user.id);

        await sendMail({
            to: user.email,
            subject: "Your EV Assist verification OTP",
            text: `Your EV Assist verification code is ${otp}. It expires in 10 minutes.`,
            html: `<p>Your EV Assist verification code is:</p><h2>${otp}</h2><p>This code expires in 10 minutes.</p>`,
        });

        const response = { message: "Verification OTP sent" };
        if (process.env.NODE_ENV !== "production" && !process.env.SMTP_HOST) {
            response.devOtp = otp;
        }
        return res.json(response);
    } catch (err) {
        console.error("Resend verification error:", err);
        return res.status(500).json({ error: "Failed to resend verification OTP" });
    }
});

// Login (password phase)
router.post("/login", authRateLimit("login", 10, 15 * 60 * 1000), async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    try {
        const normalizedEmail = String(email).trim().toLowerCase();
        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Please provide a valid email" });
        }

        const result = await pool.query(
            `SELECT id, name, email, role, password_hash, vehicle_model, battery_capacity_kwh, range_km,
              email_verified, two_factor_enabled, two_factor_secret
       FROM users WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: "Invalid email or password" });

        if (!user.email_verified) {
            return res.status(403).json({
                error: "Please verify your email before signing in",
                code: "EMAIL_NOT_VERIFIED",
                email: user.email,
            });
        }

        if (user.two_factor_enabled && user.two_factor_secret) {
            const tempToken = jwt.sign(
                { userId: user.id, pending2fa: true },
                JWT_SECRET,
                { expiresIn: "10m" }
            );

            return res.json({
                requiresTwoFactor: true,
                tempToken,
                email: user.email,
                message: "Enter your authenticator code to complete login",
            });
        }

        const token = issueAuthToken(user);
        return res.json({ token, user: sanitizeUser(user) });
    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Login failed" });
    }
});

router.post("/login-2fa", authRateLimit("login-2fa", 20, 15 * 60 * 1000), async (req, res) => {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
        return res.status(400).json({ error: "2FA token and code are required" });
    }

    try {
        const decoded = jwt.verify(tempToken, JWT_SECRET);
        if (!decoded.pending2fa || !decoded.userId) {
            return res.status(401).json({ error: "Invalid 2FA session" });
        }

        const result = await pool.query(
            `SELECT id, name, email, role, vehicle_model, battery_capacity_kwh, range_km,
              email_verified, two_factor_enabled, two_factor_secret
       FROM users WHERE id = $1`,
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid 2FA session" });
        }

        const user = result.rows[0];
        if (!user.two_factor_enabled || !user.two_factor_secret) {
            return res.status(400).json({ error: "2FA is not enabled on this account" });
        }

        const isValidCode = authenticator.verify({ token: String(code).trim(), secret: user.two_factor_secret });
        if (!isValidCode) {
            return res.status(401).json({ error: "Invalid 2FA code" });
        }

        const token = issueAuthToken(user);
        return res.json({ token, user: sanitizeUser(user) });
    } catch (err) {
        console.error("2FA login error:", err);
        return res.status(401).json({ error: "Invalid or expired 2FA session" });
    }
});

router.post("/forgot-password", authRateLimit("forgot-password", 6, 15 * 60 * 1000), async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const normalizedEmail = String(email).trim().toLowerCase();

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(200).json({ message: "If that account exists, reset instructions have been sent" });
        }

        const result = await pool.query(
            `SELECT id, email FROM users WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(200).json({ message: "If that account exists, reset instructions have been sent" });
        }

        const user = result.rows[0];
        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = hashValue(rawToken);
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
            [user.id, tokenHash, expiresAt]
        );

        const frontendBase = process.env.FRONTEND_URL || "https://ev-assist.onrender.com";
        const resetLink = `${frontendBase}/?resetToken=${rawToken}`;

        await sendMail({
            to: user.email,
            subject: "Reset your EV Assist password",
            text: `Use this reset token: ${rawToken}\n\nOr open: ${resetLink}\n\nToken expires in 30 minutes.`,
            html: `<p>Use this reset token:</p><h2>${rawToken}</h2><p>Or click <a href="${resetLink}">this reset link</a>.</p><p>Token expires in 30 minutes.</p>`,
        });

        const response = { message: "If that account exists, reset instructions have been sent" };
        if (process.env.NODE_ENV !== "production" && !process.env.SMTP_HOST) {
            response.devResetToken = rawToken;
        }

        return res.json(response);
    } catch (err) {
        console.error("Forgot password error:", err);
        return res.status(500).json({ error: "Failed to process password reset request" });
    }
});

router.post("/reset-password", authRateLimit("reset-password", 10, 15 * 60 * 1000), async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    try {
        const tokenHash = hashValue(String(token).trim());

        const result = await pool.query(
            `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       WHERE prt.token_hash = $1
         AND prt.used_at IS NULL
         AND prt.expires_at > NOW()
       ORDER BY prt.created_at DESC
       LIMIT 1`,
            [tokenHash]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Invalid or expired reset token" });
        }

        const resetRecord = result.rows[0];
        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, resetRecord.user_id]);
        await pool.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [resetRecord.id]);

        return res.json({ message: "Password reset successful. Please sign in." });
    } catch (err) {
        console.error("Reset password error:", err);
        return res.status(500).json({ error: "Failed to reset password" });
    }
});

// Get profile (protected)
router.get("/me", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role, vehicle_model,
              battery_capacity_kwh, range_km, email_verified,
              two_factor_enabled, created_at
       FROM users WHERE id = $1`,
            [req.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        return res.status(500).json({ error: "Failed to fetch profile" });
    }
});

// Update profile (protected)
router.put("/me", authenticate, async (req, res) => {
    const { name, vehicle_model, battery_capacity_kwh, range_km } = req.body;
    try {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) {
            return res.status(400).json({ error: "Name is required" });
        }

        const normalizedVehicleModel = String(vehicle_model || "").trim() || null;
        const normalizedBattery =
            battery_capacity_kwh === "" || battery_capacity_kwh === null || battery_capacity_kwh === undefined
                ? null
                : Number(battery_capacity_kwh);
        const normalizedRange =
            range_km === "" || range_km === null || range_km === undefined
                ? null
                : Number(range_km);

        if (normalizedBattery !== null && Number.isNaN(normalizedBattery)) {
            return res.status(400).json({ error: "Battery capacity must be a valid number" });
        }
        if (normalizedRange !== null && Number.isNaN(normalizedRange)) {
            return res.status(400).json({ error: "Range must be a valid number" });
        }

        const result = await pool.query(
            `UPDATE users SET name=$1, vehicle_model=$2, battery_capacity_kwh=$3, range_km=$4
       WHERE id=$5
       RETURNING id, name, email, role, vehicle_model, battery_capacity_kwh, range_km, email_verified, two_factor_enabled`,
            [normalizedName, normalizedVehicleModel, normalizedBattery, normalizedRange, req.userId]
        );

        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Profile update error:", err);
        return res.status(500).json({ error: "Update failed" });
    }
});

// Change password (protected)
router.put("/change-password", authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Both passwords required" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });

    try {
        const result = await pool.query("SELECT id, password_hash FROM users WHERE id = $1", [req.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });

        const user = result.rows[0];
        const valid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

        const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.userId]);

        return res.json({ message: "Password updated successfully" });
    } catch (err) {
        return res.status(500).json({ error: "Failed" });
    }
});

// 2FA setup
router.post("/2fa/setup", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, two_factor_enabled FROM users WHERE id = $1`,
            [req.userId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = result.rows[0];

        if (user.two_factor_enabled) {
            return res.status(400).json({ error: "2FA is already enabled" });
        }

        const secret = authenticator.generateSecret();
        const serviceName = process.env.TOTP_ISSUER || "EV Assist";
        const otpAuthUrl = authenticator.keyuri(user.email, serviceName, secret);
        let qrCodeDataUrl = null;
        try {
            qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
                errorCorrectionLevel: "M",
                margin: 1,
                width: 220,
            });
        } catch (qrErr) {
            // Do not fail setup if QR rendering fails; manual key still enables TOTP apps.
            console.error("2FA QR generation error:", qrErr);
        }

        await pool.query(
            `UPDATE users SET two_factor_temp_secret = $1 WHERE id = $2`,
            [secret, user.id]
        );

        return res.json({
            message: "Scan QR and verify code to enable 2FA",
            otpAuthUrl,
            qrCodeDataUrl,
            manualEntryKey: secret,
            qrUnavailable: !qrCodeDataUrl,
        });
    } catch (err) {
        console.error("2FA setup error:", err);
        return res.status(500).json({ error: "Failed to setup 2FA" });
    }
});

router.post("/2fa/verify-setup", authenticate, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "2FA code is required" });

    try {
        const result = await pool.query(
            `SELECT id, two_factor_temp_secret FROM users WHERE id = $1`,
            [req.userId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = result.rows[0];

        if (!user.two_factor_temp_secret) {
            return res.status(400).json({ error: "2FA setup has not been initiated" });
        }

        const isValidCode = authenticator.verify({
            token: String(code).trim(),
            secret: user.two_factor_temp_secret,
        });

        if (!isValidCode) {
            return res.status(400).json({ error: "Invalid 2FA code" });
        }

        await pool.query(
            `UPDATE users
       SET two_factor_enabled = true,
           two_factor_secret = two_factor_temp_secret,
           two_factor_temp_secret = null
       WHERE id = $1`,
            [user.id]
        );

        return res.json({ message: "2FA enabled successfully" });
    } catch (err) {
        console.error("2FA verify setup error:", err);
        return res.status(500).json({ error: "Failed to verify 2FA setup" });
    }
});

router.post("/2fa/disable", authenticate, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "2FA code is required" });

    try {
        const result = await pool.query(
            `SELECT id, two_factor_enabled, two_factor_secret FROM users WHERE id = $1`,
            [req.userId]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
        const user = result.rows[0];

        if (!user.two_factor_enabled || !user.two_factor_secret) {
            return res.status(400).json({ error: "2FA is not enabled" });
        }

        const isValidCode = authenticator.verify({ token: String(code).trim(), secret: user.two_factor_secret });
        if (!isValidCode) {
            return res.status(400).json({ error: "Invalid 2FA code" });
        }

        await pool.query(
            `UPDATE users
       SET two_factor_enabled = false,
           two_factor_secret = null,
           two_factor_temp_secret = null
       WHERE id = $1`,
            [user.id]
        );

        return res.json({ message: "2FA disabled successfully" });
    } catch (err) {
        console.error("2FA disable error:", err);
        return res.status(500).json({ error: "Failed to disable 2FA" });
    }
});

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}

module.exports = { router, authenticate };
