const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const axios = require("axios");
const authenticate = require("../middleware/auth");
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5002";
const ML_FALLBACK_URL = process.env.ML_FALLBACK_URL || "";
const fetch = (...args) =>

  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const mlTargets = [ML_SERVICE_URL, ML_FALLBACK_URL].filter(Boolean);

async function callMlService(path, payload) {
  let lastError = null;

  for (const baseUrl of mlTargets) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ML ${baseUrl} returned ${response.status}: ${body.slice(0, 200)}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`ML target failed (${baseUrl}): ${err.message}`);
    }
  }

  throw lastError || new Error("No ML targets configured");
}

// Sync chargers from OpenChargeMap into DB
router.get("/sync-india", async (req, res) => {
  // Grid covering entire India (lat 8-37, lng 68-97)
  // Every 3 degrees = ~330km apart, with 200km radius = full coverage
  const gridPoints = [];
  for (let lat = 8; lat <= 37; lat += 3) {
    for (let lng = 68; lng <= 97; lng += 3) {
      gridPoints.push({ lat, lng });
    }
  }

  console.log(`Starting India grid sync — ${gridPoints.length} grid points`);
  res.json({
    message: `Sync started in background — ${gridPoints.length} grid points`,
    note: "Check server terminal for progress. Takes 5-10 minutes."
  });

  // Run in background after responding
  let totalInserted = 0;
  let totalFetched = 0;

  for (const point of gridPoints) {
    try {
      const response = await axios.get("https://api.openchargemap.io/v3/poi/", {
        params: {
          output: "json",
          latitude: point.lat,
          longitude: point.lng,
          distance: 200,
          distanceunit: "KM",
          maxresults: 500,
          countrycode: "IN",
          verbose: true,
          key: process.env.OCM_API_KEY,
        },
      });

      for (const item of response.data) {
        const ocmId = item.ID || null;
        const title = item.AddressInfo?.Title;
        const address = item.AddressInfo?.AddressLine1
          || item.AddressInfo?.Town
          || item.AddressInfo?.StateOrProvince;
        const town = item.AddressInfo?.Town || null;
        const state = item.AddressInfo?.StateOrProvince || null;
        const latitude = item.AddressInfo?.Latitude;
        const longitude = item.AddressInfo?.Longitude;
        if (!title || !latitude || !longitude) continue;

        const connections = item.Connections || [];
        const connection =
          connections.find(c => c.ConnectionType?.Title && c.CurrentType?.Title)
          || connections.find(c => c.ConnectionType?.Title)
          || connections[0] || {};

        const power = connection?.PowerKW || null;
        const connectionType = connection?.ConnectionType?.Title || null;
        const currentType = connection?.CurrentType?.Title
          || (power >= 50 ? "DC" : power > 0 ? "AC" : null);
        const quantity = item.NumberOfPoints || connections.length || 1;
        const operatorName = item.OperatorInfo?.Title || null;
        const contactPhone = item.AddressInfo?.ContactTelephone1 || item.AddressInfo?.ContactTelephone2 || null;
        const websiteUrl = item.AddressInfo?.RelatedURL || item.OperatorInfo?.WebsiteURL || null;
        const imageUrl = item.MediaItems?.find((m) => m?.ItemURL)?.ItemURL || null;
        const usageCost = item.UsageCost || null;

        try {
          const r = await pool.query(`
            INSERT INTO chargers
              (ocm_id, name, address, town, state, power_kw, connection_type, current_type, quantity,
               operator_name, contact_phone, website_url, image_url, usage_cost, location)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, ST_SetSRID(ST_MakePoint($15,$16),4326))
            ON CONFLICT (ocm_id) DO UPDATE SET
              name = EXCLUDED.name,
              address = EXCLUDED.address,
              town = EXCLUDED.town,
              state = EXCLUDED.state,
              power_kw = EXCLUDED.power_kw,
              connection_type = EXCLUDED.connection_type,
              current_type = EXCLUDED.current_type,
              quantity = EXCLUDED.quantity,
              operator_name = EXCLUDED.operator_name,
              contact_phone = EXCLUDED.contact_phone,
              website_url = EXCLUDED.website_url,
              image_url = EXCLUDED.image_url,
              usage_cost = EXCLUDED.usage_cost
          `, [ocmId, title, address, town, state, power, connectionType, currentType, quantity,
            operatorName, contactPhone, websiteUrl, imageUrl, usageCost, longitude, latitude]);
          if (r.rowCount > 0) totalInserted++;
        } catch (e) {
          // skip individual insert errors
        }
      }

      totalFetched += response.data.length;
      console.log(`✅ Grid (${point.lat},${point.lng}): ${response.data.length} fetched | Total so far: ${totalInserted}`);

      // Delay to respect API rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error(`❌ Grid (${point.lat},${point.lng}) failed:`, err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n🎉 India sync complete! Total fetched: ${totalFetched}, inserted/updated: ${totalInserted}`);
});

// Add this AFTER the /sync-india route (after line 98) and BEFORE router.get("/", ...)

router.get("/sync", async (req, res) => {
  const lat = req.query.lat || 20.5937;
  const lng = req.query.lng || 78.9629;

  console.log(`🔄 Syncing at lat=${lat}, lng=${lng}`);

  try {
    const response = await axios.get("https://api.openchargemap.io/v3/poi/", {
      params: {
        output: "json",
        latitude: lat,
        longitude: lng,
        distance: 50,
        distanceunit: "KM",
        maxresults: 500,
        countrycode: "IN",
        verbose: true,
        key: process.env.OCM_API_KEY,
      },
    });

    let inserted = 0;

    for (const item of response.data) {
      const ocmId = item.ID || null;
      const title = item.AddressInfo?.Title;
      const address = item.AddressInfo?.AddressLine1
        || item.AddressInfo?.Town
        || item.AddressInfo?.StateOrProvince;
      const town = item.AddressInfo?.Town || null;
      const state = item.AddressInfo?.StateOrProvince || null;
      const latitude = item.AddressInfo?.Latitude;
      const longitude = item.AddressInfo?.Longitude;
      if (!title || !latitude || !longitude) continue;

      const connections = item.Connections || [];
      const connection =
        connections.find(c => c.ConnectionType?.Title && c.CurrentType?.Title)
        || connections.find(c => c.ConnectionType?.Title)
        || connections[0] || {};

      const power = connection?.PowerKW || null;
      const connectionType = connection?.ConnectionType?.Title || null;
      const currentType = connection?.CurrentType?.Title
        || (power >= 50 ? "DC" : power > 0 ? "AC" : null);
      const quantity = item.NumberOfPoints || connections.length || 1;
      const operatorName = item.OperatorInfo?.Title || null;
      const contactPhone = item.AddressInfo?.ContactTelephone1 || item.AddressInfo?.ContactTelephone2 || null;
      const websiteUrl = item.AddressInfo?.RelatedURL || item.OperatorInfo?.WebsiteURL || null;
      const imageUrl = item.MediaItems?.find((m) => m?.ItemURL)?.ItemURL || null;
      const usageCost = item.UsageCost || null;

      try {
        const r = await pool.query(`
          INSERT INTO chargers
            (ocm_id, name, address, town, state, power_kw, connection_type, current_type, quantity,
             operator_name, contact_phone, website_url, image_url, usage_cost, location)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, ST_SetSRID(ST_MakePoint($15,$16), 4326))
          ON CONFLICT (ocm_id) DO UPDATE SET
            name            = EXCLUDED.name,
            address         = EXCLUDED.address,
            town            = EXCLUDED.town,
            state           = EXCLUDED.state,
            power_kw        = EXCLUDED.power_kw,
            connection_type = EXCLUDED.connection_type,
            current_type    = EXCLUDED.current_type,
            quantity        = EXCLUDED.quantity,
            operator_name   = EXCLUDED.operator_name,
            contact_phone   = EXCLUDED.contact_phone,
            website_url     = EXCLUDED.website_url,
            image_url       = EXCLUDED.image_url,
            usage_cost      = EXCLUDED.usage_cost
        `, [ocmId, title, address, town, state, power, connectionType, currentType, quantity,
          operatorName, contactPhone, websiteUrl, imageUrl, usageCost, longitude, latitude]);
        if (r.rowCount > 0) inserted++;
      } catch (e) {
        // skip duplicate errors
      }
    }

    console.log(`✅ Sync done: fetched ${response.data.length}, inserted/updated ${inserted}`);

    res.json({
      message: "Sync complete ✅",
      lat, lng,
      totalFetched: response.data.length,
      inserted,
    });

  } catch (err) {
    console.error("Sync error:", err.response?.data || err.message);
    res.status(500).json({ error: "Sync failed: " + err.message });
  }
});

// GET chargers inside current visible map bounds
router.get("/", async (req, res) => {
  try {
    const { lat, lng, radius = 50 } = req.query;

    if (lat && lng) {
      const radiusKm = Math.min(parseFloat(radius), 500);

      // For large radius, limit more aggressively to avoid browser freeze
      const limit = radiusKm <= 50 ? 500 :
        radiusKm <= 100 ? 400 :
          radiusKm <= 200 ? 300 : 200;

      const result = await pool.query(`
        SELECT
          id, ocm_id, name, address, town, state,
          power_kw, connection_type, current_type, quantity,
          operator_name, contact_phone, website_url, image_url, usage_cost,
          ST_Y(location::geometry) AS latitude,
          ST_X(location::geometry) AS longitude,
          ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) / 1000 AS distance_km
        FROM chargers
        WHERE ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3 * 1000
        )
        ORDER BY distance_km ASC
        LIMIT $4
      `, [lat, lng, radiusKm, limit]);

      return res.json(result.rows);
    }

    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.get("/filter", async (req, res) => {
  const { minPower } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT *,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
      FROM chargers
      WHERE power_kw >= $1
      `,
      [minPower || 0]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Filter failed" });
  }
});

router.get("/nearby", async (req, res) => {
  const { lat, lng } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT id, name, address, power_kw,
             ST_Y(location::geometry) AS latitude,
             ST_X(location::geometry) AS longitude,
             ST_Distance(
               location::geography,
               ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
             ) / 1000 AS distance_km
      FROM chargers
      ORDER BY distance_km ASC
      LIMIT 100
      `,
      [lat, lng]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/fast", async (req, res) => {
  const { lat, lng, radius = 50 } = req.query;
  try {
    let result;
    if (lat && lng) {
      result = await pool.query(`
        SELECT *, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
        FROM chargers
        WHERE power_kw >= 50
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3 * 1000
        )
      `, [lat, lng, radius]);
    } else {
      result = await pool.query(`
        SELECT *, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
        FROM chargers WHERE power_kw >= 50
      `);
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// In chargers.js, replace GET /favorites:
router.get("/favorites", async (req, res) => {
  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch { }
  }

  try {
    const result = await pool.query(`
      SELECT c.*,
        ST_Y(c.location::geometry) AS latitude,
        ST_X(c.location::geometry) AS longitude
      FROM chargers c
      JOIN favorites f ON c.id = f.charger_id
      WHERE f.user_id = $1
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/geocode", async (req, res) => {
  try {
    const text = req.query.text;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const response = await fetch(
      `https://api.openrouteservice.org/geocode/search?api_key=${process.env.ORS_API_KEY}&text=${encodeURIComponent(text)}`
    );

    const data = await response.json();

    console.log("Geocode result:", data);

    res.json(data);

  } catch (err) {
    console.error("Geocode Error:", err);
    res.status(500).json({ error: "Geocode failed" });
  }
});

router.get("/route", async (req, res) => {
  try {
    const { origin, destination } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Missing origin or destination" });
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    console.log("Route API Response:", data);

    if (!data.routes || data.routes.length === 0) {
      return res.status(400).json({ error: "Invalid route data" });
    }

    res.json({
      route: data.routes[0],
    });

  } catch (error) {
    console.error("Route Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/predict-wait", async (req, res) => {
  try {
    const data = await callMlService("/predict", req.body);
    res.json(data);
  } catch (err) {
    console.error("ML service error:", err.message);
    res.status(503).json({ error: "Prediction service unavailable" });
  }
});

router.post("/predict-wait/bulk", async (req, res) => {
  try {
    const data = await callMlService("/predict/bulk", req.body);
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: "Prediction service unavailable" });
  }
});

router.post("/estimate-cost", async (req, res) => {
  try {
    const {
      battery_capacity_kwh,
      current_battery_pct,
      target_battery_pct,
      power_kw,
      cost_per_kwh = 12,
    } = req.body;

    if (!battery_capacity_kwh || !power_kw) {
      return res.status(400).json({ error: "battery_capacity_kwh and power_kw required" });
    }

    const currentPct = parseFloat(current_battery_pct) || 20;
    const targetPct = parseFloat(target_battery_pct) || 80;
    const batteryKwh = parseFloat(battery_capacity_kwh);
    const chargerKw = parseFloat(power_kw);

    const energyNeededKwh = batteryKwh * (targetPct - currentPct) / 100;
    const chargingTimeHours = energyNeededKwh / (chargerKw * 0.9);
    const chargingTimeMinutes = Math.round(chargingTimeHours * 60);
    const estimatedCost = Math.round(energyNeededKwh * cost_per_kwh);

    const rangeAdded = req.body.range_km
      ? Math.round((targetPct - currentPct) / 100 * parseFloat(req.body.range_km))
      : null;

    res.json({
      energyNeededKwh: parseFloat(energyNeededKwh.toFixed(2)),
      chargingTimeMinutes,
      chargingTimeFormatted: chargingTimeMinutes >= 60
        ? `${Math.floor(chargingTimeMinutes / 60)}h ${chargingTimeMinutes % 60}m`
        : `${chargingTimeMinutes} min`,
      estimatedCostInr: estimatedCost,
      rangeAddedKm: rangeAdded,
      from: `${currentPct}%`,
      to: `${targetPct}%`,
    });
  } catch (err) {
    res.status(500).json({ error: "Estimation failed" });
  }
});

// ✅ FIXED: POST route to find chargers along a path
// Now checks ALL sampled points along the route, not just points[0]
router.post("/route-chargers", async (req, res) => {
  try {
    const { points } = req.body;

    if (!points || !Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: "No route points provided" });
    }

    // Build a LineString from all route points using PostGIS
    // This lets us find every charger within 5km of ANY point on the route
    const lineStringCoords = points
      .map((p) => `${p.lng} ${p.lat}`)
      .join(",");

    const lineStringWKT = `LINESTRING(${lineStringCoords})`;

    const result = await pool.query(
      `
      SELECT DISTINCT ON (c.id)
             c.id, c.name, c.address, c.power_kw,
             c.connection_type, c.current_type, c.quantity,
             ST_Y(c.location::geometry) AS latitude,
             ST_X(c.location::geometry) AS longitude,
             ST_Distance(
               c.location::geography,
               ST_GeomFromText($1, 4326)::geography
             ) / 1000 AS distance_km
      FROM chargers c
      WHERE ST_DWithin(
        c.location::geography,
        ST_GeomFromText($1, 4326)::geography,
        5000  -- 5km corridor on each side of the route
      )
      ORDER BY c.id, distance_km ASC
      LIMIT 100
      `,
      [lineStringWKT]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Route POST Error:", error);
    res.status(500).json({ error: "Failed to find chargers along route" });
  }
});

router.post("/favorite/:id", async (req, res) => {
  const chargerId = req.params.id;

  // Extract user from token
  let userId = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(
        authHeader.split(" ")[1],
        process.env.JWT_SECRET
      );
      userId = decoded.userId;
    }
  } catch (e) {
    // no valid token
  }

  if (!userId) {
    return res.status(401).json({ error: "Please sign in to save favorites" });
  }

  try {
    // Check charger exists
    const chargerCheck = await pool.query(
      "SELECT id FROM chargers WHERE id = $1", [chargerId]
    );
    if (chargerCheck.rows.length === 0) {
      return res.status(404).json({ error: "Charger not found" });
    }

    // Check already favorited
    const existing = await pool.query(
      "SELECT id FROM favorites WHERE user_id = $1 AND charger_id = $2",
      [userId, chargerId]
    );
    if (existing.rows.length > 0) {
      return res.status(200).json({ message: "Already in favorites ⭐" });
    }

    // Insert
    await pool.query(
      "INSERT INTO favorites (user_id, charger_id) VALUES ($1, $2)",
      [userId, chargerId]
    );

    res.json({ message: "Added to favorites ⭐" });
  } catch (err) {
    console.error("Favorite error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/favorite/:id", async (req, res) => {
  const chargerId = req.params.id;

  let userId = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(
        authHeader.split(" ")[1],
        process.env.JWT_SECRET
      );
      userId = decoded.userId;
    }
  } catch (e) {
    console.error("Token error:", e.message);
  }

  console.log("DELETE favorite - userId:", userId, "chargerId:", chargerId);

  if (!userId) {
    return res.status(401).json({ error: "Please sign in" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM favorites WHERE user_id = $1 AND charger_id = $2 RETURNING id",
      [userId, chargerId]
    );

    console.log("Delete result:", result.rows);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not in your favorites" });
    }

    res.json({ message: "Removed from favorites" });
  } catch (err) {
    console.error("Remove favorite error:", err.message);
    res.status(500).json({ error: "Failed to remove: " + err.message });
  }
});

module.exports = router;