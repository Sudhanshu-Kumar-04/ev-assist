const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const authenticate = require("../middleware/auth");

// ── Get all reservations for logged-in user ───────────────
router.get("/my", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.id, r.reservation_date, r.start_time, r.end_time,
        r.status, r.vehicle_model, r.notes, r.created_at,
        c.name AS charger_name, c.address, c.power_kw,
        c.connection_type,
        ST_Y(c.location::geometry) AS latitude,
        ST_X(c.location::geometry) AS longitude
      FROM reservations r
      JOIN chargers c ON r.charger_id = c.id
      WHERE r.user_id = $1
      ORDER BY r.reservation_date DESC, r.start_time DESC
    `, [req.userId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

// ── Get available slots for a charger on a date ───────────
router.get("/slots/:chargerId", async (req, res) => {
  const { chargerId } = req.params;
  const { date } = req.query;

  if (!date) return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });

  try {
    // Get all booked slots for this charger on this date
    const booked = await pool.query(`
      SELECT start_time, end_time, status
      FROM reservations
      WHERE charger_id = $1 AND reservation_date = $2
        AND status NOT IN ('cancelled')
      ORDER BY start_time
    `, [chargerId, date]);

    // Generate all 1-hour slots from 06:00 to 22:00
    const allSlots = [];
    for (let h = 6; h < 22; h++) {
      const start = `${String(h).padStart(2, "0")}:00`;
      const end = `${String(h + 1).padStart(2, "0")}:00`;

      const isBooked = booked.rows.some(b => {
        const bStart = b.start_time.slice(0, 5);
        const bEnd = b.end_time.slice(0, 5);
        return bStart < end && bEnd > start;
      });

      // Don't show past slots for today
      const now = new Date();
      const today = now.toISOString().split("T")[0];
      const isPast = date === today && h <= now.getHours();

      allSlots.push({ start, end, available: !isBooked && !isPast });
    }

    res.json({ date, chargerId, slots: allSlots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch slots" });
  }
});

// ── Create a reservation ──────────────────────────────────
router.post("/", authenticate, async (req, res) => {
  const { charger_id, reservation_date, start_time, end_time, notes } = req.body;

  if (!charger_id || !reservation_date || !start_time || !end_time)
    return res.status(400).json({ error: "charger_id, reservation_date, start_time, end_time are required" });

  // Don't allow past bookings
  const slotDatetime = new Date(`${reservation_date}T${start_time}`);
  if (slotDatetime < new Date())
    return res.status(400).json({ error: "Cannot book a slot in the past" });

  try {
    // Get user's vehicle model
    const userRes = await pool.query("SELECT vehicle_model FROM users WHERE id = $1", [req.userId]);
    const vehicle_model = userRes.rows[0]?.vehicle_model || null;

    const result = await pool.query(`
      INSERT INTO reservations 
        (user_id, charger_id, reservation_date, start_time, end_time, status, vehicle_model, notes)
      VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7)
      RETURNING *
    `, [req.userId, charger_id, reservation_date, start_time, end_time, vehicle_model, notes || null]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23P01") // exclusion constraint violation = slot overlap
      return res.status(409).json({ error: "This slot is already booked. Please choose another time." });

    console.error(err);
    res.status(500).json({ error: "Booking failed" });
  }
});

// ── Cancel a reservation ──────────────────────────────────
router.patch("/:id/cancel", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE reservations SET status = 'cancelled'
      WHERE id = $1 AND user_id = $2 AND status = 'confirmed'
      RETURNING *
    `, [req.params.id, req.userId]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Reservation not found or already cancelled" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Cancel failed" });
  }
});

// ── Get all bookings for a charger (public, for slot display) ─
router.get("/charger/:chargerId", async (req, res) => {
  const { date } = req.query;
  try {
    const result = await pool.query(`
      SELECT start_time, end_time, status
      FROM reservations
      WHERE charger_id = $1 
        AND reservation_date = $2
        AND status NOT IN ('cancelled')
      ORDER BY start_time
    `, [req.params.chargerId, date]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;