const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter";
  if (!/[a-z]/.test(value)) return "Password must include at least one lowercase letter";
  if (!/[0-9]/.test(value)) return "Password must include at least one number";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include at least one special character";
  return null;
}

// ── Register ──────────────────────────────────────────────
router.post("/register", authRateLimit("register", 6, 15 * 60 * 1000), async (req, res) => {
  const { name, email, password, vehicle_model, battery_capacity_kwh, range_km } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });

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
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "Email already registered" });

    // Bootstrap rule: first ever account becomes admin only when no
    // explicit admin email list has been configured.
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

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, vehicle_model, battery_capacity_kwh, range_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email, role`,
      [
        normalizedName,
        normalizedEmail,
        password_hash,
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
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── Login ─────────────────────────────────────────────────
router.post("/login", authRateLimit("login", 10, 15 * 60 * 1000), async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ error: "Please provide a valid email" });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid email or password" });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── Get profile (protected) ───────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, vehicle_model, 
       battery_capacity_kwh, range_km, created_at FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ── Update profile (protected) ────────────────────────────
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
       WHERE id=$5 RETURNING id, name, email, role, vehicle_model, battery_capacity_kwh, range_km`,
      [normalizedName, normalizedVehicleModel, normalizedBattery, normalizedRange, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// ── Change password (protected) ───────────────────────────
router.put("/change-password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Both passwords required" });

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.userId]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ── Middleware ────────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ error: "No token provided" });

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