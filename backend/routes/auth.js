const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Register ──────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, password, vehicle_model, battery_capacity_kwh, range_km } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "Name, email and password are required" });

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "Email already registered" });

    // Bootstrap rule: first ever account becomes admin.
    // Additionally, allow configured admin emails to sign up as admin.
    const adminCountResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
    );
    const existingAdminCount = adminCountResult.rows[0]?.count || 0;
    const role = existingAdminCount === 0 || ADMIN_EMAILS.includes(normalizedEmail)
      ? "admin"
      : "user";

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, vehicle_model, battery_capacity_kwh, range_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email, role`,
      [name, email, password_hash, role, vehicle_model || null, battery_capacity_kwh || null, range_km || null]
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
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
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
    const result = await pool.query(
      `UPDATE users SET name=$1, vehicle_model=$2, battery_capacity_kwh=$3, range_km=$4
       WHERE id=$5 RETURNING id, name, email, role, vehicle_model, battery_capacity_kwh, range_km`,
      [name, vehicle_model, battery_capacity_kwh, range_km, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

// ── Change password (protected) ───────────────────────────
router.put("/change-password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters" });

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