const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const axios = require("axios");
const authenticate = require("../middleware/auth");
const adminAuth = require("../middleware/adminAuth");
const { broadcastChargerUpdate } = require("../realtime");
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5002";
const ML_FALLBACK_URL = process.env.ML_FALLBACK_URL || "";
const fetch = (...args) =>

  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const mlTargets = [ML_SERVICE_URL, ML_FALLBACK_URL].filter(Boolean);
const syncRateState = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseApproxCostPerKwh(rawUsageCost) {
  const raw = String(rawUsageCost || "");
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function estimateWaitFallback({ power_kw, num_ports, current_occupancy }) {
  const power = Math.max(1, Number(power_kw || 22));
  const ports = Math.max(1, Number(num_ports || 2));
  const occupancy = clamp(Number(current_occupancy || 0), 0, ports);
  const occupancyRatio = occupancy / ports;
  const hour = new Date().getHours();
  const isPeak = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 22);

  // Slower chargers and peak windows typically experience longer waits.
  const base = power >= 120 ? 6 : power >= 60 ? 10 : power >= 30 ? 14 : 18;
  const queuePressure = occupancyRatio * 28;
  const peakPenalty = isPeak ? 8 : 0;
  const estimated = Math.round(base + queuePressure + peakPenalty);

  let label = "Low wait";
  let color = "green";
  if (estimated > 35) {
    label = `High wait (~${estimated} min)`;
    color = "red";
  } else if (estimated > 20) {
    label = `Moderate wait (~${estimated} min)`;
    color = "orange";
  } else if (estimated > 12) {
    label = `Mild wait (~${estimated} min)`;
    color = "yellow";
  }

  return {
    estimated_wait_min: estimated,
    label,
    color,
    confidence: "medium",
    source: "heuristic",
    connector_utilization_label: `${occupancy}/${ports} ports busy`,
  };
}

async function getIssueStatsByChargerIds(chargerIds) {
  if (!chargerIds.length) return new Map();

  const stats = await pool.query(
    `SELECT
       charger_id,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS report_count_7d,
       COUNT(*) FILTER (WHERE status IN ('open','in_review'))::int AS open_report_count,
       COUNT(*) FILTER (
         WHERE status IN ('open','in_review')
           AND issue_type IN ('offline','connector_broken','payment_failed')
       )::int AS critical_open_report_count
     FROM charger_issue_reports
     WHERE charger_id = ANY($1::int[])
     GROUP BY charger_id`,
    [chargerIds]
  );

  const map = new Map();
  for (const row of stats.rows) {
    map.set(Number(row.charger_id), {
      report_count_7d: Number(row.report_count_7d || 0),
      open_report_count: Number(row.open_report_count || 0),
      critical_open_report_count: Number(row.critical_open_report_count || 0),
    });
  }

  return map;
}

async function addStationInsights(stations) {
  const issueStats = await getIssueStatsByChargerIds(
    stations.map((s) => Number(s.id)).filter((id) => Number.isFinite(id))
  );

  return stations.map((station) => {
    const rating = Number(station.rating || 0);
    const reviewCount = Number(station.review_count || 0);
    const stats = issueStats.get(Number(station.id)) || {
      report_count_7d: 0,
      open_report_count: 0,
      critical_open_report_count: 0,
    };

    let reliability = 40;
    if (station.is_operational === true) reliability += 20;
    if (station.is_operational === false) reliability -= 20;
    if (reviewCount > 0) reliability += Math.min(20, reviewCount * 2);
    if (rating > 0) reliability += rating * 4;
    if (station.operator_name) reliability += 5;
    if (station.contact_phone) reliability += 5;
    if (station.website_url) reliability += 5;
    if (station.usage_cost) reliability += 5;
    if (station.connection_type || station.current_type) reliability += 5;
    if (Number(station.quantity || 0) > 1) reliability += 5;
    reliability -= stats.open_report_count * 6;
    reliability -= stats.critical_open_report_count * 10;

    let confidence = 25;
    if (typeof station.is_operational === "boolean") confidence += 35;
    if (station.status_text) confidence += 10;
    if (reviewCount > 0) confidence += Math.min(20, reviewCount * 2);
    if (station.operator_name) confidence += 10;
    if (station.contact_phone || station.website_url) confidence += 10;
    if (station.usage_cost) confidence += 5;
    if (station.ocm_id) confidence += 5;
    confidence += Math.min(10, reviewCount);
    confidence -= stats.open_report_count * 4;
    confidence -= stats.critical_open_report_count * 6;

    const reliabilityScore = Math.round(clamp(reliability, 5, 99));
    const confidenceScore = Math.round(clamp(confidence, 5, 99));
    const confidenceLabel =
      confidenceScore >= 75 ? "high" : confidenceScore >= 45 ? "medium" : "low";

    return {
      ...station,
      reliability_score: reliabilityScore,
      status_confidence: confidenceScore,
      data_confidence_label: confidenceLabel,
      issue_report_count_7d: stats.report_count_7d,
      open_issue_count: stats.open_report_count,
      critical_open_issue_count: stats.critical_open_report_count,
    };
  });
}

function buildOcmChargerValues(item) {
  const ocmId = item.ID || null;
  const title = item.AddressInfo?.Title;
  const address = item.AddressInfo?.AddressLine1
    || item.AddressInfo?.Town
    || item.AddressInfo?.StateOrProvince;
  const town = item.AddressInfo?.Town || null;
  const state = item.AddressInfo?.StateOrProvince || null;
  const latitude = item.AddressInfo?.Latitude;
  const longitude = item.AddressInfo?.Longitude;

  if (!title || !latitude || !longitude) return null;

  const connections = item.Connections || [];
  const connection =
    connections.find((c) => c.ConnectionType?.Title && c.CurrentType?.Title)
    || connections.find((c) => c.ConnectionType?.Title)
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
  const statusText = item.StatusType?.Title || null;
  const isOperational = typeof item.StatusType?.IsOperational === "boolean"
    ? item.StatusType.IsOperational
    : null;
  const userRatings = (item.UserComments || [])
    .map((c) => Number(c?.Rating))
    .filter((r) => Number.isFinite(r) && r >= 0 && r <= 5);
  const reviewCount = userRatings.length;
  const rating = reviewCount
    ? Number((userRatings.reduce((sum, r) => sum + r, 0) / reviewCount).toFixed(1))
    : null;

  return {
    ocmId,
    title,
    address,
    town,
    state,
    latitude,
    longitude,
    power,
    connectionType,
    currentType,
    quantity,
    operatorName,
    contactPhone,
    websiteUrl,
    imageUrl,
    usageCost,
    rating,
    reviewCount,
    statusText,
    isOperational,
  };
}

async function upsertOcmCharger(item, source = "sync") {
  const values = buildOcmChargerValues(item);
  if (!values) return null;

  const r = await pool.query(`
    INSERT INTO chargers
      (ocm_id, name, address, town, state, power_kw, connection_type, current_type, quantity,
       operator_name, contact_phone, website_url, image_url, usage_cost, rating, review_count,
       status_text, is_operational, location)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
      ST_SetSRID(ST_MakePoint($19,$20),4326))
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
      usage_cost = EXCLUDED.usage_cost,
      rating = EXCLUDED.rating,
      review_count = EXCLUDED.review_count,
      status_text = EXCLUDED.status_text,
      is_operational = EXCLUDED.is_operational
    RETURNING
      id, ocm_id, name, address, town, state, power_kw, connection_type, current_type, quantity,
      operator_name, contact_phone, website_url, image_url, usage_cost, rating, review_count,
      status_text, is_operational,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude
  `, [
    values.ocmId,
    values.title,
    values.address,
    values.town,
    values.state,
    values.power,
    values.connectionType,
    values.currentType,
    values.quantity,
    values.operatorName,
    values.contactPhone,
    values.websiteUrl,
    values.imageUrl,
    values.usageCost,
    values.rating,
    values.reviewCount,
    values.statusText,
    values.isOperational,
    values.longitude,
    values.latitude,
  ]);

  const charger = r.rows[0] || null;
  if (charger) broadcastChargerUpdate(charger, source);
  return charger;
}

function syncRateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const key = String(req.userId || req.ip || "anonymous");
  const current = syncRateState.get(key);

  if (current && now < current.resetAt && current.count >= 1) {
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({
      error: `Sync recently triggered. Try again in ${retryAfterSec}s`,
    });
  }

  syncRateState.set(key, {
    count: current && now < current.resetAt ? current.count + 1 : 1,
    resetAt: current && now < current.resetAt ? current.resetAt : now + windowMs,
  });

  return next();
}

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
router.get("/sync-india", adminAuth, syncRateLimit, async (req, res) => {
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
        try {
          const updatedStation = await upsertOcmCharger(item, "sync-india");
          if (updatedStation) totalInserted++;
        } catch (e) {
          const title = item.AddressInfo?.Title || "unknown";
          console.warn(`OCM upsert failed (title=${title}): ${e.message}`);
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

router.get("/sync", adminAuth, syncRateLimit, async (req, res) => {
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
      try {
        const updatedStation = await upsertOcmCharger(item, "sync");
        if (updatedStation) inserted++;
      } catch (e) {
        const title = item.AddressInfo?.Title || "unknown";
        console.warn(`OCM upsert failed (title=${title}): ${e.message}`);
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
          rating, review_count, status_text, is_operational,
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

      return res.json(await addStationInsights(result.rows));
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

    res.json(await addStationInsights(result.rows));
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

    res.json(await addStationInsights(result.rows));
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
        SELECT *,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude,
               ST_Distance(
                 location::geography,
                 ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
               ) / 1000 AS distance_km
        FROM chargers
        WHERE power_kw >= 50
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3 * 1000
        )
        ORDER BY distance_km ASC
      `, [lat, lng, radius]);
    } else {
      result = await pool.query(`
        SELECT *, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
        FROM chargers WHERE power_kw >= 50
      `);
    }
    res.json(await addStationInsights(result.rows));
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// In chargers.js, replace GET /favorites:
router.get("/favorites", authenticate, async (req, res) => {

  try {
    const result = await pool.query(`
      SELECT c.*,
        ST_Y(c.location::geometry) AS latitude,
        ST_X(c.location::geometry) AS longitude
      FROM chargers c
      JOIN favorites f ON c.id = f.charger_id
      WHERE f.user_id = $1
    `, [req.userId]);

    res.json(await addStationInsights(result.rows));
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
    const fallback = estimateWaitFallback(req.body || {});
    res.json(fallback);
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
      session_fee_inr = 0,
      idle_fee_inr_per_min = 0,
      expected_idle_minutes = 0,
      gst_percent = 18,
    } = req.body;

    if (!battery_capacity_kwh || !power_kw) {
      return res.status(400).json({ error: "battery_capacity_kwh and power_kw required" });
    }

    const currentPct = parseFloat(current_battery_pct) || 20;
    const targetPct = parseFloat(target_battery_pct) || 80;
    const batteryKwh = parseFloat(battery_capacity_kwh);
    const chargerKw = parseFloat(power_kw);
    const pricePerKwh = parseFloat(cost_per_kwh) || 0;
    const sessionFee = parseFloat(session_fee_inr) || 0;
    const idleFeePerMin = parseFloat(idle_fee_inr_per_min) || 0;
    const expectedIdleMinutes = parseFloat(expected_idle_minutes) || 0;
    const gstPercent = parseFloat(gst_percent) || 0;

    const energyNeededKwh = batteryKwh * (targetPct - currentPct) / 100;
    const chargingTimeHours = energyNeededKwh / (chargerKw * 0.9);
    const chargingTimeMinutes = Math.round(chargingTimeHours * 60);
    const energyCost = energyNeededKwh * pricePerKwh;
    const idlePenalty = idleFeePerMin * expectedIdleMinutes;
    const subtotal = energyCost + sessionFee + idlePenalty;
    const tax = subtotal * (gstPercent / 100);
    const total = subtotal + tax;

    const rangeAdded = req.body.range_km
      ? Math.round((targetPct - currentPct) / 100 * parseFloat(req.body.range_km))
      : null;

    res.json({
      energyNeededKwh: parseFloat(energyNeededKwh.toFixed(2)),
      chargingTimeMinutes,
      chargingTimeFormatted: chargingTimeMinutes >= 60
        ? `${Math.floor(chargingTimeMinutes / 60)}h ${chargingTimeMinutes % 60}m`
        : `${chargingTimeMinutes} min`,
      estimatedCostInr: Math.round(total),
      energyCostInr: Number(energyCost.toFixed(2)),
      sessionFeeInr: Number(sessionFee.toFixed(2)),
      idlePenaltyEstimateInr: Number(idlePenalty.toFixed(2)),
      subtotalInr: Number(subtotal.toFixed(2)),
      gstPercent: Number(gstPercent.toFixed(2)),
      taxInr: Number(tax.toFixed(2)),
      totalCostInr: Number(total.toFixed(2)),
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
    const { points, evProfile = {}, routeDistanceKm = null } = req.body;

    if (!points || !Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: "No route points provided" });
    }

    // Build a LineString from all route points using PostGIS
    // This lets us find every charger within 5km of ANY point on the route
    const lineStringCoords = points
      .map((p) => `${p.lng} ${p.lat}`)
      .join(",");

    const lineStringWKT = `LINESTRING(${lineStringCoords})`;

    const startLng = Number(points[0]?.lng);
    const startLat = Number(points[0]?.lat);

    const result = await pool.query(
      `
      SELECT DISTINCT ON (c.id)
             c.id, c.name, c.address, c.power_kw,
             c.connection_type, c.current_type, c.quantity,
             ST_Y(c.location::geometry) AS latitude,
             ST_X(c.location::geometry) AS longitude,
             c.usage_cost,
             ST_Distance(
               c.location::geography,
               ST_GeomFromText($1, 4326)::geography
             ) / 1000 AS distance_km,
             ST_Distance(
               c.location::geography,
               ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
             ) / 1000 AS distance_from_start_km
      FROM chargers c
      WHERE ST_DWithin(
        c.location::geography,
        ST_GeomFromText($1, 4326)::geography,
        5000  -- 5km corridor on each side of the route
      )
      ORDER BY c.id, distance_km ASC
      LIMIT 100
      `,
      [lineStringWKT, startLng, startLat]
    );

    const enriched = await addStationInsights(result.rows);

    const batteryPct = clamp(Number(evProfile.batteryPct ?? 60), 5, 100);
    const batteryCapacityKwh = Math.max(10, Number(evProfile.batteryCapacityKwh ?? 60));
    const efficiencyKmPerKwh = Math.max(2, Number(evProfile.efficiencyKmPerKwh ?? 6));
    const reservePct = clamp(Number(evProfile.reservePct ?? 15), 5, 40);
    const targetChargePct = clamp(Number(evProfile.targetChargePct ?? 80), reservePct + 5, 100);
    const legSafetyFactor = clamp(Number(evProfile.legSafetyFactor ?? 0.85), 0.65, 0.95);

    const usableKwh = batteryCapacityKwh * ((batteryPct - reservePct) / 100);
    const theoreticalMaxLegKm = Math.max(20, usableKwh * efficiencyKmPerKwh);
    const recommendedLegKm = Math.max(20, theoreticalMaxLegKm * legSafetyFactor);

    const totalDistance = Number.isFinite(Number(routeDistanceKm))
      ? Number(routeDistanceKm)
      : Math.max(...enriched.map((s) => Number(s.distance_from_start_km || 0)), 0);

    const chargeWindowKwh = batteryCapacityKwh * ((targetChargePct - reservePct) / 100);

    const planStops = [];
    const usedIds = new Set();
    let targetDistance = recommendedLegKm;

    while (targetDistance < Math.max(0, totalDistance - recommendedLegKm * 0.55)) {
      const candidates = enriched
        .filter((s) => !usedIds.has(s.id))
        .filter((s) => {
          const d = Number(s.distance_from_start_km || 0);
          return d >= targetDistance - 25 && d <= targetDistance + 45;
        });

      if (!candidates.length) {
        targetDistance += recommendedLegKm;
        continue;
      }

      const scored = candidates.map((s) => {
        const power = Math.max(10, Number(s.power_kw || 25));
        const wait = estimateWaitFallback({
          power_kw: power,
          num_ports: Number(s.quantity || 2),
          current_occupancy: Math.max(0, Number(s.open_issue_count || 0) * 0.35),
        }).estimated_wait_min;

        const chargeMinutes = Math.round((chargeWindowKwh / (power * 0.9)) * 60);
        const reliability = Number(s.reliability_score || 60);
        const distancePenalty = Math.abs(Number(s.distance_from_start_km || 0) - targetDistance);
        const costPerKwh = parseApproxCostPerKwh(s.usage_cost) ?? 12;
        const estimatedEnergyCost = costPerKwh * chargeWindowKwh;

        const fastestScore = wait + chargeMinutes + distancePenalty * 0.65;
        const cheapestReliableScore = estimatedEnergyCost + wait * 0.4 + Math.max(0, 75 - reliability) * 1.35;

        return {
          ...s,
          planning_wait_min: wait,
          planning_charge_min: chargeMinutes,
          planning_cost_per_kwh: Number(costPerKwh.toFixed(2)),
          fastestScore,
          cheapestReliableScore,
        };
      });

      const fastest = [...scored].sort((a, b) => a.fastestScore - b.fastestScore)[0];
      const cheapestReliable = [...scored].sort((a, b) => a.cheapestReliableScore - b.cheapestReliableScore)[0];

      usedIds.add(fastest.id);
      planStops.push({
        target_distance_km: Number(targetDistance.toFixed(1)),
        fastest,
        cheapestReliable,
      });

      targetDistance += recommendedLegKm;
    }

    const primaryStops = planStops.map((s) => ({
      strategy: "fastest",
      target_distance_km: s.target_distance_km,
      station: s.fastest,
    }));

    const backupStops = planStops
      .map((s) => s.cheapestReliable)
      .filter((s) => s && !usedIds.has(s.id))
      .map((station) => ({
        strategy: "cheapest_reliable",
        station,
      }));

    const recommendedOrderedIds = [
      ...primaryStops.map((s) => s.station.id),
      ...backupStops.map((s) => s.station.id),
    ];
    const recommendedSet = new Set(recommendedOrderedIds);
    const orderedStations = [
      ...enriched.filter((s) => recommendedSet.has(s.id)).sort((a, b) => {
        return recommendedOrderedIds.indexOf(a.id) - recommendedOrderedIds.indexOf(b.id);
      }),
      ...enriched.filter((s) => !recommendedSet.has(s.id)),
    ];

    res.json({
      stations: orderedStations,
      recommendations: {
        totalDistanceKm: Number(totalDistance.toFixed(1)),
        theoreticalMaxLegKm: Number(theoreticalMaxLegKm.toFixed(1)),
        recommendedLegKm: Number(recommendedLegKm.toFixed(1)),
        primaryStops,
        backupStops,
      },
    });

  } catch (error) {
    console.error("Route POST Error:", error);
    res.status(500).json({ error: "Failed to find chargers along route" });
  }
});

router.post("/favorite/:id", authenticate, async (req, res) => {
  const chargerId = req.params.id;

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
      [req.userId, chargerId]
    );
    if (existing.rows.length > 0) {
      return res.status(200).json({ message: "Already in favorites ⭐" });
    }

    // Insert
    await pool.query(
      "INSERT INTO favorites (user_id, charger_id) VALUES ($1, $2)",
      [req.userId, chargerId]
    );

    res.json({ message: "Added to favorites ⭐" });
  } catch (err) {
    console.error("Favorite error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/favorite/:id", authenticate, async (req, res) => {
  const chargerId = req.params.id;

  try {
    const result = await pool.query(
      "DELETE FROM favorites WHERE user_id = $1 AND charger_id = $2 RETURNING id",
      [req.userId, chargerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not in your favorites" });
    }

    res.json({ message: "Removed from favorites" });
  } catch (err) {
    console.error("Remove favorite error:", err.message);
    res.status(500).json({ error: "Failed to remove: " + err.message });
  }
});

router.post("/:id/report-issue", authenticate, async (req, res) => {
  const chargerId = Number(req.params.id);
  const issueType = String(req.body?.issueType || "").trim().toLowerCase();
  const note = String(req.body?.note || "").trim() || null;
  const allowedIssueTypes = [
    "offline",
    "connector_broken",
    "payment_failed",
    "blocked",
    "slow_charging",
    "other",
  ];

  if (!Number.isFinite(chargerId)) {
    return res.status(400).json({ error: "Invalid charger id" });
  }

  if (!allowedIssueTypes.includes(issueType)) {
    return res.status(400).json({
      error: "Invalid issueType",
      allowedIssueTypes,
    });
  }

  try {
    const chargerCheck = await pool.query("SELECT id FROM chargers WHERE id = $1", [chargerId]);
    if (chargerCheck.rows.length === 0) {
      return res.status(404).json({ error: "Charger not found" });
    }

    await pool.query(
      `INSERT INTO charger_issue_reports (charger_id, user_id, issue_type, note)
       VALUES ($1, $2, $3, $4)`,
      [chargerId, req.userId, issueType, note]
    );

    return res.json({ message: "Issue reported. Thanks for helping improve data quality." });
  } catch (err) {
    console.error("Issue report error:", err.message);
    return res.status(500).json({ error: "Failed to report issue" });
  }
});

// ✅ NEW: Get ETA and trip details for different transportation modes
router.post("/route/trip-details", async (req, res) => {
  try {
    const { origin, destination, vehicleType = "car" } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Origin and destination required" });
    }

    // Vehicle multipliers for ETA (base 1 for car)
    const modeMultipliers = {
      car: 1.0,
      "two-wheeler": 1.15,
      bike: 1.25,
      foot: 3.5,
      electric_bike: 1.8,
    };

    const multiplier = modeMultipliers[vehicleType] || 1.0;

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.routes || data.routes.length === 0) {
        return res.status(400).json({ error: "Route not found" });
      }

      const route = data.routes[0];
      const distanceKm = route.distance / 1000;
      const baseTimeMinutes = route.duration / 60;
      const adjustedTimeMinutes = Math.round(baseTimeMinutes * multiplier);

      const now = new Date();
      const arrivalTime = new Date(now.getTime() + adjustedTimeMinutes * 60000);

      res.json({
        vehicleType,
        distanceKm: Number(distanceKm.toFixed(1)),
        estimatedTimeMinutes: adjustedTimeMinutes,
        estimatedTimeFormatted: `${Math.floor(adjustedTimeMinutes / 60)}h ${adjustedTimeMinutes % 60}m`,
        arrivalTime: arrivalTime.toISOString(),
        arrivalTimeFormatted: arrivalTime.toLocaleString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          day: "2-digit",
          month: "short",
        }),
        geometry: route.geometry,
      });
    } catch (err) {
      console.error("OSRM Error:", err.message);
      res.status(500).json({ error: "Failed to calculate route details" });
    }
  } catch (err) {
    console.error("Trip details error:", err.message);
    res.status(500).json({ error: "Failed to get trip details" });
  }
});

// ✅ NEW: Get multiple route alternatives with different criteria
router.post("/route/alternatives", async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Origin and destination required" });
    }

    try {
      // Get fastest route
      const url = `https://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=full&geometries=geojson&alternatives=true`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.routes || data.routes.length === 0) {
        return res.status(400).json({ error: "No routes found" });
      }

      const alternatives = data.routes.slice(0, 3).map((route, index) => {
        const distanceKm = route.distance / 1000;
        const durationMinutes = Math.round(route.duration / 60);
        const now = new Date();
        const arrivalTime = new Date(now.getTime() + durationMinutes * 60000);

        return {
          id: index,
          label: index === 0 ? "Fastest" : index === 1 ? "Balanced" : "Scenic",
          distanceKm: Number(distanceKm.toFixed(1)),
          durationMinutes,
          durationFormatted: `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`,
          arrivalTime: arrivalTime.toLocaleString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
          geometry: route.geometry,
        };
      });

      res.json({ alternatives });
    } catch (err) {
      console.error("OSRM Error:", err.message);
      res.status(500).json({ error: "Failed to get route alternatives" });
    }
  } catch (err) {
    console.error("Alternatives error:", err.message);
    res.status(500).json({ error: "Failed to get alternatives" });
  }
});

// ✅ NEW: Calculate trip legs with charger stops and segment analysis
router.post("/route/trip-legs", async (req, res) => {
  try {
    const { points, chargerStops = [], evProfile = {} } = req.body;

    if (!points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "At least 2 points required" });
    }

    const legs = [];
    const chargerArray = Array.isArray(chargerStops) ? chargerStops : [];

    // Build legs between consecutive charger stops
    for (let i = 0; i < chargerArray.length; i++) {
      const startPoint = chargerArray[i];
      const endPoint = chargerArray[i + 1] || chargerArray[chargerArray.length - 1];

      if (!startPoint || !endPoint) continue;

      const legDistance = Math.sqrt(
        Math.pow(endPoint.latitude - startPoint.latitude, 2) +
        Math.pow(endPoint.longitude - startPoint.longitude, 2)
      ) * 111; // Rough approximation: 1 degree = 111 km

      const baseEfficiency = Number(evProfile.efficiencyKmPerKwh) || 6;
      const chargingTimeMin = 20; // Estimated charging stop time
      const drivingTimeMin = Math.round((legDistance / 80) * 60); // Assume 80 km/h avg

      legs.push({
        legNumber: i + 1,
        from: startPoint.name || `Stop ${i + 1}`,
        to: endPoint.name || `Stop ${i + 2}`,
        distanceKm: Number(legDistance.toFixed(1)),
        estimatedDrivingMinutes: drivingTimeMin,
        chargingStopMinutes: chargingTimeMin,
        totalLegTimeMinutes: drivingTimeMin + chargingTimeMin,
        chargerDetails: {
          name: startPoint.name,
          power: startPoint.power_kw,
          type: startPoint.connection_type,
        },
      });
    }

    res.json({
      totalLegs: legs.length,
      legs,
      totalDistanceKm: Number(
        legs.reduce((sum, leg) => sum + leg.distanceKm, 0).toFixed(1)
      ),
      totalTimeMinutes: legs.reduce((sum, leg) => sum + leg.totalLegTimeMinutes, 0),
    });
  } catch (err) {
    console.error("Trip legs error:", err.message);
    res.status(500).json({ error: "Failed to calculate trip legs" });
  }
});

// ✅ NEW: Save a route for the user
router.post("/routes/save", authenticate, async (req, res) => {
  try {
    const {
      routeName,
      fromLocation,
      toLocation,
      fromLat,
      fromLng,
      toLat,
      toLng,
      distance,
      duration,
      vehicleType = "car",
      chargers = [],
    } = req.body;

    if (!routeName || !fromLocation || !toLocation) {
      return res.status(400).json({ error: "Route name and locations required" });
    }

    const result = await pool.query(
      `INSERT INTO saved_routes 
       (user_id, route_name, from_location, to_location, from_lat, from_lng, to_lat, to_lng, 
        distance_km, duration_minutes, vehicle_type, charger_stops, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        req.userId,
        routeName,
        fromLocation,
        toLocation,
        fromLat,
        fromLng,
        toLat,
        toLng,
        distance,
        duration,
        vehicleType,
        JSON.stringify(chargers),
      ]
    );

    res.json({
      message: "Route saved successfully 📍",
      route: result.rows[0],
    });
  } catch (err) {
    console.error("Save route error:", err.message);
    res.status(500).json({ error: "Failed to save route" });
  }
});

// ✅ NEW: Get all saved routes for the user
router.get("/routes/saved", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, route_name, from_location, to_location, distance_km, duration_minutes, 
              vehicle_type, charger_stops, created_at, updated_at
       FROM saved_routes
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );

    const routes = result.rows.map((route) => ({
      ...route,
      charger_stops: JSON.parse(route.charger_stops || "[]"),
    }));

    res.json({ routes });
  } catch (err) {
    console.error("Get saved routes error:", err.message);
    res.status(500).json({ error: "Failed to fetch saved routes" });
  }
});

// ✅ NEW: Delete a saved route
router.delete("/routes/:routeId", authenticate, async (req, res) => {
  try {
    const routeId = Number(req.params.routeId);

    const result = await pool.query(
      `DELETE FROM saved_routes 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [routeId, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ message: "Route deleted successfully" });
  } catch (err) {
    console.error("Delete route error:", err.message);
    res.status(500).json({ error: "Failed to delete route" });
  }
});

// ✅ NEW: Get ETA comparison for all vehicle types
router.post("/route/eta-by-mode", async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Origin and destination required" });
    }

    const modes = {
      car: { name: "Car", multiplier: 1.0, icon: "🚗", color: "#3B82F6" },
      "two-wheeler": {
        name: "Two-Wheeler",
        multiplier: 1.15,
        icon: "🏍️",
        color: "#F59E0B",
      },
      bike: { name: "Bike", multiplier: 1.25, icon: "🚲", color: "#10B981" },
      electric_bike: {
        name: "E-Bike",
        multiplier: 1.8,
        icon: "⚡🚲",
        color: "#8B5CF6",
      },
      foot: { name: "Walking", multiplier: 3.5, icon: "🚶", color: "#6B7280" },
    };

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin};${destination}?overview=full`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.routes || data.routes.length === 0) {
        return res.status(400).json({ error: "Route not found" });
      }

      const baseRoute = data.routes[0];
      const distanceKm = baseRoute.distance / 1000;
      const baseTimeMinutes = baseRoute.duration / 60;

      const etaOptions = Object.entries(modes).map(([key, mode]) => {
        const adjustedTimeMinutes = Math.round(baseTimeMinutes * mode.multiplier);
        const now = new Date();
        const arrivalTime = new Date(now.getTime() + adjustedTimeMinutes * 60000);

        return {
          mode: key,
          label: mode.name,
          icon: mode.icon,
          color: mode.color,
          timeMinutes: adjustedTimeMinutes,
          timeFormatted: `${Math.floor(adjustedTimeMinutes / 60)}h ${adjustedTimeMinutes % 60}m`,
          arrivalTime: arrivalTime.toLocaleString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            day: "2-digit",
            month: "short",
          }),
        };
      });

      res.json({
        distanceKm: Number(distanceKm.toFixed(1)),
        etaOptions: etaOptions.sort((a, b) => a.timeMinutes - b.timeMinutes),
      });
    } catch (err) {
      console.error("OSRM Error:", err.message);
      res.status(500).json({ error: "Failed to calculate ETA" });
    }
  } catch (err) {
    console.error("ETA by mode error:", err.message);
    res.status(500).json({ error: "Failed to get ETA options" });
  }
});

// ✅ NEW: Add a stop to an existing route
router.post("/routes/:routeId/add-stop", authenticate, async (req, res) => {
  try {
    const routeId = Number(req.params.routeId);
    const { stopName, stopLat, stopLng, stopIndex } = req.body;

    if (!stopName || stopLat === undefined || stopLng === undefined) {
      return res.status(400).json({ error: "Stop details required" });
    }

    const route = await pool.query(
      `SELECT charger_stops FROM saved_routes WHERE id = $1 AND user_id = $2`,
      [routeId, req.userId]
    );

    if (route.rows.length === 0) {
      return res.status(404).json({ error: "Route not found" });
    }

    const stops = JSON.parse(route.rows[0].charger_stops || "[]");
    const newStop = { name: stopName, latitude: stopLat, longitude: stopLng };

    if (stopIndex !== undefined && stopIndex >= 0 && stopIndex <= stops.length) {
      stops.splice(stopIndex, 0, newStop);
    } else {
      stops.push(newStop);
    }

    await pool.query(
      `UPDATE saved_routes SET charger_stops = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(stops), routeId]
    );

    res.json({ message: "Stop added successfully", stops });
  } catch (err) {
    console.error("Add stop error:", err.message);
    res.status(500).json({ error: "Failed to add stop" });
  }
});

// ✅ NEW: Remove a stop from a route
router.post("/routes/:routeId/remove-stop", authenticate, async (req, res) => {
  try {
    const routeId = Number(req.params.routeId);
    const { stopIndex } = req.body;

    if (stopIndex === undefined) {
      return res.status(400).json({ error: "Stop index required" });
    }

    const route = await pool.query(
      `SELECT charger_stops FROM saved_routes WHERE id = $1 AND user_id = $2`,
      [routeId, req.userId]
    );

    if (route.rows.length === 0) {
      return res.status(404).json({ error: "Route not found" });
    }

    const stops = JSON.parse(route.rows[0].charger_stops || "[]");

    if (stopIndex < 0 || stopIndex >= stops.length) {
      return res.status(400).json({ error: "Invalid stop index" });
    }

    stops.splice(stopIndex, 1);

    await pool.query(
      `UPDATE saved_routes SET charger_stops = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(stops), routeId]
    );

    res.json({ message: "Stop removed successfully", stops });
  } catch (err) {
    console.error("Remove stop error:", err.message);
    res.status(500).json({ error: "Failed to remove stop" });
  }
});

module.exports = router;