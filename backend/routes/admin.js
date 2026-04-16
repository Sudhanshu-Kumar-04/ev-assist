const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const adminAuth = require("../middleware/adminAuth");

// ── Dashboard stats ───────────────────────────────────────
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const [chargers, users, reservations, todayRes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM chargers"),
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'"),
      pool.query("SELECT COUNT(*) FROM reservations"),
      pool.query("SELECT COUNT(*) FROM reservations WHERE reservation_date = CURRENT_DATE"),
    ]);

    const resByStatus = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM reservations GROUP BY status
    `);

    const topChargers = await pool.query(`
      SELECT c.name, c.address, c.power_kw, COUNT(r.id) as booking_count
      FROM chargers c
      LEFT JOIN reservations r ON c.id = r.charger_id
      GROUP BY c.id, c.name, c.address, c.power_kw
      ORDER BY booking_count DESC
      LIMIT 5
    `);

    const dailyBookings = await pool.query(`
      SELECT reservation_date::text as date, COUNT(*) as count
      FROM reservations
      WHERE reservation_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY reservation_date
      ORDER BY reservation_date
    `);

    res.json({
      totalChargers: parseInt(chargers.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      totalReservations: parseInt(reservations.rows[0].count),
      todayReservations: parseInt(todayRes.rows[0].count),
      reservationsByStatus: resByStatus.rows,
      topChargers: topChargers.rows,
      dailyBookings: dailyBookings.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ── Get all chargers (paginated) ──────────────────────────
router.get("/chargers", adminAuth, async (req, res) => {
  const { page = 1, limit = 20, search = "" } = req.query;
  const offset = (page - 1) * limit;
  try {
    const result = await pool.query(`
      SELECT id, name, address, power_kw, connection_type, current_type, quantity,
             ST_Y(location::geometry) AS latitude,
             ST_X(location::geometry) AS longitude
      FROM chargers
      WHERE name ILIKE $1 OR address ILIKE $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
    `, [`%${search}%`, limit, offset]);

    const total = await pool.query(
      "SELECT COUNT(*) FROM chargers WHERE name ILIKE $1 OR address ILIKE $1",
      [`%${search}%`]
    );

    res.json({ chargers: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ── Add charger ───────────────────────────────────────────
router.post("/chargers", adminAuth, async (req, res) => {
  const { name, address, power_kw, connection_type, current_type, quantity, latitude, longitude } = req.body;
  if (!name || !latitude || !longitude)
    return res.status(400).json({ error: "name, latitude, longitude required" });
  try {
    const result = await pool.query(`
      INSERT INTO chargers (name, address, power_kw, connection_type, current_type, quantity, location)
      VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
      RETURNING id
    `, [name, address, power_kw, connection_type, current_type, quantity || 1, longitude, latitude]);
    res.status(201).json({ message: "Charger added", id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: "Failed to add charger" });
  }
});

// ── Update charger ────────────────────────────────────────
router.put("/chargers/:id", adminAuth, async (req, res) => {
  const { name, address, power_kw, connection_type, current_type, quantity } = req.body;
  try {
    await pool.query(`
      UPDATE chargers SET name=$1, address=$2, power_kw=$3,
        connection_type=$4, current_type=$5, quantity=$6
      WHERE id=$7
    `, [name, address, power_kw, connection_type, current_type, quantity, req.params.id]);
    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update" });
  }
});

// ── Delete charger ────────────────────────────────────────
router.delete("/chargers/:id", adminAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM chargers WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ── Get all reservations ──────────────────────────────────
router.get("/reservations", adminAuth, async (req, res) => {
  const { page = 1, limit = 20, status = "" } = req.query;
  const offset = (page - 1) * limit;
  try {
    const where = status ? "WHERE r.status = $3" : "";
    const params = status ? [limit, offset, status] : [limit, offset];

    const result = await pool.query(`
      SELECT r.id, r.reservation_date, r.start_time, r.end_time,
             r.status, r.vehicle_model, r.notes, r.created_at,
             u.name AS user_name, u.email AS user_email,
             c.name AS charger_name, c.address, c.power_kw
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN chargers c ON r.charger_id = c.id
      ${where}
      ORDER BY r.reservation_date DESC, r.start_time DESC
      LIMIT $1 OFFSET $2
    `, params);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ── Get all users ─────────────────────────────────────────
router.get("/users", adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.vehicle_model,
             u.battery_capacity_kwh, u.range_km, u.created_at,
             COUNT(r.id) as reservation_count
      FROM users u
      LEFT JOIN reservations r ON u.id = r.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;