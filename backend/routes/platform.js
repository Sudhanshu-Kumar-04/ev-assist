const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const authenticate = require("../middleware/auth");
const adminAuth = require("../middleware/adminAuth");

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function round2(value) {
    return Math.round(toNumber(value) * 100) / 100;
}

async function getUserRole(userId) {
    const result = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
    return result.rows[0]?.role || null;
}

async function getFleetMembership(userId, fleetId) {
    const result = await pool.query(
        `SELECT role FROM fleet_members WHERE user_id = $1 AND fleet_id = $2`,
        [userId, fleetId]
    );
    return result.rows[0]?.role || null;
}

function canManageFleet(role) {
    return role === "owner" || role === "admin";
}

// Interoperability ingestion (OCPP/OCPI-ready event sink)
router.post("/interop/ingest", adminAuth, async (req, res) => {
    const {
        provider,
        protocol = "OCPP",
        eventType,
        externalId,
        payload,
        status = "processed",
        errorMessage = null,
    } = req.body || {};

    if (!provider || !eventType || !payload) {
        return res.status(400).json({ error: "provider, eventType and payload are required" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO interop_ingestion_events
         (provider, protocol, event_type, external_id, payload, status, error_message, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
            [provider, protocol, eventType, externalId || null, payload, status, errorMessage, req.userId]
        );

        return res.status(201).json({ message: "Interop event ingested", event: result.rows[0] });
    } catch (err) {
        console.error("Interop ingest error:", err);
        return res.status(500).json({ error: "Failed to ingest interoperability event" });
    }
});

router.get("/interop/events", adminAuth, async (req, res) => {
    const { provider = "", protocol = "", limit = 50 } = req.query;
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));

    try {
        const filters = [];
        const values = [];

        if (provider) {
            values.push(`%${String(provider)}%`);
            filters.push(`provider ILIKE $${values.length}`);
        }
        if (protocol) {
            values.push(String(protocol));
            filters.push(`protocol = $${values.length}`);
        }

        values.push(safeLimit);
        const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

        const result = await pool.query(
            `SELECT id, provider, protocol, event_type, external_id, status, error_message, processed_at
       FROM interop_ingestion_events
       ${where}
       ORDER BY processed_at DESC
       LIMIT $${values.length}`,
            values
        );

        return res.json(result.rows);
    } catch (err) {
        console.error("Interop list error:", err);
        return res.status(500).json({ error: "Failed to fetch interoperability events" });
    }
});

// Payment and invoice module
router.post("/payments/checkout", authenticate, async (req, res) => {
    const {
        reservationId = null,
        chargerId,
        energyKwh,
        energyPriceInr = 20,
        sessionFeeInr = 25,
        idleFeeInr = 0,
        taxPercent = 18,
        paymentMethod = "upi",
        providerRef = null,
        markPaid = true,
    } = req.body || {};

    if (!chargerId || !energyKwh) {
        return res.status(400).json({ error: "chargerId and energyKwh are required" });
    }

    try {
        const energy = round2(energyKwh);
        const unitPrice = round2(energyPriceInr);
        const sessionFee = round2(sessionFeeInr);
        const idleFee = round2(idleFeeInr);
        const taxPct = round2(taxPercent);

        const subtotal = round2(energy * unitPrice + sessionFee + idleFee);
        const taxInr = round2((subtotal * taxPct) / 100);
        const total = round2(subtotal + taxInr);

        if (reservationId) {
            const reservation = await pool.query(
                `SELECT id FROM reservations WHERE id = $1 AND user_id = $2`,
                [reservationId, req.userId]
            );
            if (!reservation.rows.length) {
                return res.status(403).json({ error: "Reservation not found for this user" });
            }
        }

        const sessionResult = await pool.query(
            `INSERT INTO charging_sessions
         (reservation_id, user_id, charger_id, energy_kwh, energy_price_inr, session_fee_inr, idle_fee_inr,
          tax_percent, payment_status, payment_method, provider_ref, started_at, ended_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       RETURNING *`,
            [
                reservationId,
                req.userId,
                chargerId,
                energy,
                unitPrice,
                sessionFee,
                idleFee,
                taxPct,
                markPaid ? "paid" : "pending",
                paymentMethod,
                providerRef,
            ]
        );

        const session = sessionResult.rows[0];
        const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(session.id).padStart(6, "0")}`;

        const invoiceResult = await pool.query(
            `INSERT INTO invoices
         (session_id, invoice_number, subtotal_inr, tax_inr, total_inr, status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
            [
                session.id,
                invoiceNumber,
                subtotal,
                taxInr,
                total,
                markPaid ? "issued" : "draft",
                {
                    energyKwh: energy,
                    energyPriceInr: unitPrice,
                    sessionFeeInr: sessionFee,
                    idleFeeInr: idleFee,
                    taxPercent: taxPct,
                },
            ]
        );

        return res.status(201).json({
            message: "Checkout completed",
            session,
            invoice: invoiceResult.rows[0],
        });
    } catch (err) {
        console.error("Checkout error:", err);
        return res.status(500).json({ error: "Failed to process checkout" });
    }
});

router.get("/payments/invoices/my", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, s.user_id, s.charger_id, s.energy_kwh, s.energy_price_inr, s.payment_status,
              c.name AS charger_name
       FROM invoices i
       JOIN charging_sessions s ON s.id = i.session_id
       LEFT JOIN chargers c ON c.id = s.charger_id
       WHERE s.user_id = $1
       ORDER BY i.issued_at DESC`,
            [req.userId]
        );

        return res.json(result.rows);
    } catch (err) {
        console.error("My invoices error:", err);
        return res.status(500).json({ error: "Failed to fetch invoices" });
    }
});

router.get("/payments/invoices", adminAuth, async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.id, i.invoice_number, i.total_inr, i.status, i.issued_at,
              s.payment_status, s.payment_method, s.user_id,
              u.name AS user_name, u.email AS user_email
       FROM invoices i
       JOIN charging_sessions s ON s.id = i.session_id
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY i.issued_at DESC
       LIMIT 200`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error("Admin invoices error:", err);
        return res.status(500).json({ error: "Failed to fetch invoices" });
    }
});

router.patch("/payments/invoices/:id/status", adminAuth, async (req, res) => {
    const invoiceId = Number(req.params.id);
    const status = String(req.body?.status || "").trim();

    if (!Number.isFinite(invoiceId)) return res.status(400).json({ error: "Invalid invoice id" });
    if (!status) return res.status(400).json({ error: "status is required" });

    try {
        const result = await pool.query(
            `UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`,
            [status, invoiceId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Invoice not found" });
        return res.json({ message: "Invoice status updated", invoice: result.rows[0] });
    } catch (err) {
        console.error("Invoice status update error:", err);
        return res.status(500).json({ error: "Failed to update invoice status" });
    }
});

// Fleet and B2B controls
router.post("/fleet/accounts", authenticate, async (req, res) => {
    const { name, billingEmail = null } = req.body || {};
    if (!name || String(name).trim().length < 2) {
        return res.status(400).json({ error: "Fleet account name is required" });
    }

    try {
        const fleetResult = await pool.query(
            `INSERT INTO fleet_accounts (name, billing_email, created_by)
       VALUES ($1,$2,$3)
       RETURNING *`,
            [String(name).trim(), billingEmail, req.userId]
        );

        const fleet = fleetResult.rows[0];

        await pool.query(
            `INSERT INTO fleet_members (fleet_id, user_id, role)
       VALUES ($1,$2,'owner')
       ON CONFLICT (fleet_id, user_id) DO NOTHING`,
            [fleet.id, req.userId]
        );

        await pool.query(
            `INSERT INTO fleet_policies (fleet_id)
       VALUES ($1)
       ON CONFLICT (fleet_id) DO NOTHING`,
            [fleet.id]
        );

        return res.status(201).json({ message: "Fleet account created", fleet });
    } catch (err) {
        console.error("Fleet account create error:", err);
        return res.status(500).json({ error: "Failed to create fleet account" });
    }
});

router.get("/fleet/my", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT fa.id, fa.name, fa.billing_email, fa.status, fa.created_at,
              fm.role,
              (SELECT COUNT(*)::int FROM fleet_members fm2 WHERE fm2.fleet_id = fa.id) AS member_count,
              (SELECT COUNT(*)::int FROM fleet_vehicles fv WHERE fv.fleet_id = fa.id) AS vehicle_count
       FROM fleet_accounts fa
       JOIN fleet_members fm ON fm.fleet_id = fa.id
       WHERE fm.user_id = $1
       ORDER BY fa.created_at DESC`,
            [req.userId]
        );

        return res.json(result.rows);
    } catch (err) {
        console.error("Fleet my list error:", err);
        return res.status(500).json({ error: "Failed to fetch fleet accounts" });
    }
});

router.get("/fleet/:fleetId/detail", authenticate, async (req, res) => {
    const fleetId = Number(req.params.fleetId);
    if (!Number.isFinite(fleetId)) return res.status(400).json({ error: "Invalid fleet id" });

    try {
        const membershipRole = await getFleetMembership(req.userId, fleetId);
        const userRole = await getUserRole(req.userId);
        if (!membershipRole && userRole !== "admin") {
            return res.status(403).json({ error: "No access to this fleet" });
        }

        const [fleet, members, vehicles, policy] = await Promise.all([
            pool.query(`SELECT * FROM fleet_accounts WHERE id = $1`, [fleetId]),
            pool.query(
                `SELECT fm.id, fm.role, fm.joined_at, u.id AS user_id, u.name, u.email
         FROM fleet_members fm
         JOIN users u ON u.id = fm.user_id
         WHERE fm.fleet_id = $1
         ORDER BY fm.joined_at ASC`,
                [fleetId]
            ),
            pool.query(
                `SELECT * FROM fleet_vehicles WHERE fleet_id = $1 ORDER BY created_at DESC`,
                [fleetId]
            ),
            pool.query(`SELECT * FROM fleet_policies WHERE fleet_id = $1`, [fleetId]),
        ]);

        if (!fleet.rows.length) return res.status(404).json({ error: "Fleet not found" });

        return res.json({
            fleet: fleet.rows[0],
            members: members.rows,
            vehicles: vehicles.rows,
            policy: policy.rows[0] || null,
            accessRole: membershipRole || userRole,
        });
    } catch (err) {
        console.error("Fleet detail error:", err);
        return res.status(500).json({ error: "Failed to fetch fleet detail" });
    }
});

router.post("/fleet/:fleetId/members", authenticate, async (req, res) => {
    const fleetId = Number(req.params.fleetId);
    const { email, role = "member" } = req.body || {};
    const safeRole = ["member", "admin"].includes(String(role)) ? String(role) : "member";

    if (!Number.isFinite(fleetId)) return res.status(400).json({ error: "Invalid fleet id" });
    if (!email) return res.status(400).json({ error: "email is required" });

    try {
        const membershipRole = await getFleetMembership(req.userId, fleetId);
        if (!canManageFleet(membershipRole)) {
            return res.status(403).json({ error: "Only fleet owner/admin can add members" });
        }

        const userResult = await pool.query(
            `SELECT id FROM users WHERE lower(email) = lower($1)`,
            [String(email).trim()]
        );
        if (!userResult.rows.length) {
            return res.status(404).json({ error: "User not found by email" });
        }

        const added = await pool.query(
            `INSERT INTO fleet_members (fleet_id, user_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (fleet_id, user_id)
       DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
            [fleetId, userResult.rows[0].id, safeRole]
        );

        return res.status(201).json({ message: "Fleet member added/updated", member: added.rows[0] });
    } catch (err) {
        console.error("Fleet add member error:", err);
        return res.status(500).json({ error: "Failed to add fleet member" });
    }
});

router.post("/fleet/:fleetId/vehicles", authenticate, async (req, res) => {
    const fleetId = Number(req.params.fleetId);
    const { label, vehicleModel = null, batteryCapacityKwh = null, rangeKm = null } = req.body || {};

    if (!Number.isFinite(fleetId)) return res.status(400).json({ error: "Invalid fleet id" });
    if (!label || String(label).trim().length < 2) {
        return res.status(400).json({ error: "Vehicle label is required" });
    }

    try {
        const membershipRole = await getFleetMembership(req.userId, fleetId);
        if (!canManageFleet(membershipRole)) {
            return res.status(403).json({ error: "Only fleet owner/admin can add vehicles" });
        }

        const result = await pool.query(
            `INSERT INTO fleet_vehicles (fleet_id, label, vehicle_model, battery_capacity_kwh, range_km)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
            [
                fleetId,
                String(label).trim(),
                vehicleModel,
                batteryCapacityKwh === null || batteryCapacityKwh === "" ? null : Number(batteryCapacityKwh),
                rangeKm === null || rangeKm === "" ? null : Number(rangeKm),
            ]
        );

        return res.status(201).json({ message: "Fleet vehicle added", vehicle: result.rows[0] });
    } catch (err) {
        console.error("Fleet add vehicle error:", err);
        return res.status(500).json({ error: "Failed to add fleet vehicle" });
    }
});

router.put("/fleet/:fleetId/policy", authenticate, async (req, res) => {
    const fleetId = Number(req.params.fleetId);
    if (!Number.isFinite(fleetId)) return res.status(400).json({ error: "Invalid fleet id" });

    const {
        maxSessionAmountInr,
        allowPublicChargers,
        allowFastChargers,
        idleFeeCapInr,
    } = req.body || {};

    try {
        const membershipRole = await getFleetMembership(req.userId, fleetId);
        if (!canManageFleet(membershipRole)) {
            return res.status(403).json({ error: "Only fleet owner/admin can update policy" });
        }

        const result = await pool.query(
            `INSERT INTO fleet_policies
         (fleet_id, max_session_amount_inr, allow_public_chargers, allow_fast_chargers, idle_fee_cap_inr, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (fleet_id)
       DO UPDATE SET
         max_session_amount_inr = EXCLUDED.max_session_amount_inr,
         allow_public_chargers = EXCLUDED.allow_public_chargers,
         allow_fast_chargers = EXCLUDED.allow_fast_chargers,
         idle_fee_cap_inr = EXCLUDED.idle_fee_cap_inr,
         updated_at = NOW()
       RETURNING *`,
            [
                fleetId,
                maxSessionAmountInr === undefined ? 2000 : Number(maxSessionAmountInr),
                allowPublicChargers === undefined ? true : Boolean(allowPublicChargers),
                allowFastChargers === undefined ? true : Boolean(allowFastChargers),
                idleFeeCapInr === undefined ? 250 : Number(idleFeeCapInr),
            ]
        );

        return res.json({ message: "Fleet policy updated", policy: result.rows[0] });
    } catch (err) {
        console.error("Fleet policy update error:", err);
        return res.status(500).json({ error: "Failed to update fleet policy" });
    }
});

module.exports = router;
