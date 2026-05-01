const { Pool } = require("pg");

const pool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  : new Pool({
    user: process.env.PGUSER || "sudhanshu",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "evassist_db",
    password: process.env.PGPASSWORD || "",
    port: Number(process.env.PGPORT || 5432),
  });

const initDB = async () => {
  try {
    // Extensions first
    await pool.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await pool.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    // 1. Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        vehicle_model VARCHAR(100),
        battery_capacity_kwh DECIMAL,
        range_km DECIMAL,
        email_verified BOOLEAN DEFAULT false,
        email_verification_otp_hash TEXT,
        email_verification_otp_expires_at TIMESTAMP,
        two_factor_enabled BOOLEAN DEFAULT false,
        two_factor_secret TEXT,
        two_factor_temp_secret TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ users table ready");

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_otp_hash TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_otp_expires_at TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_temp_secret TEXT`);

    // 2. Chargers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chargers (
        id SERIAL PRIMARY KEY,
        ocm_id INTEGER,
        name VARCHAR(255),
        address TEXT,
        town VARCHAR(120),
        state VARCHAR(120),
        power_kw DECIMAL,
        connection_type VARCHAR(100),
        current_type VARCHAR(50),
        quantity INTEGER,
        operator_name VARCHAR(150),
        contact_phone VARCHAR(80),
        website_url TEXT,
        image_url TEXT,
        usage_cost TEXT,
        rating DECIMAL(2,1),
        review_count INTEGER,
        status_text VARCHAR(120),
        is_operational BOOLEAN,
        location GEOGRAPHY(POINT, 4326)
      )
    `);
    console.log("✅ chargers table ready");

    // Backward-compatible migration path for already-provisioned databases.
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS ocm_id INTEGER`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS town VARCHAR(120)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS state VARCHAR(120)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS operator_name VARCHAR(150)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(80)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS website_url TEXT`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS usage_cost TEXT`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS rating DECIMAL(2,1)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS review_count INTEGER`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS status_text VARCHAR(120)`);
    await pool.query(`ALTER TABLE chargers ADD COLUMN IF NOT EXISTS is_operational BOOLEAN`);

    // Old dedupe collapsed different stations with similar names/addresses.
    // Use OCM ID as the stable unique identity instead.
    await pool.query(`ALTER TABLE chargers DROP CONSTRAINT IF EXISTS chargers_name_address_unique`);
    await pool.query(`DROP INDEX IF EXISTS chargers_ocm_id_unique`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS chargers_ocm_id_unique
      ON chargers (ocm_id)
    `);

    // 3. Favorites table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        charger_id INTEGER REFERENCES chargers(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, charger_id)
      )
    `);
    console.log("✅ favorites table ready");

    // 4. Reservations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        charger_id INTEGER REFERENCES chargers(id) ON DELETE CASCADE,
        reservation_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmed',
        vehicle_model VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ reservations table ready");

    // 5. Password reset tokens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ password_reset_tokens table ready");

    // 6. Charger issue reports from community feedback
    await pool.query(`
      CREATE TABLE IF NOT EXISTS charger_issue_reports (
        id SERIAL PRIMARY KEY,
        charger_id INTEGER REFERENCES chargers(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        issue_type VARCHAR(40) NOT NULL,
        note TEXT,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charger_issue_reports_charger_id ON charger_issue_reports(charger_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charger_issue_reports_created_at ON charger_issue_reports(created_at)`);
    console.log("✅ charger_issue_reports table ready");

    // 7. Interoperability ingestion events (OCPP/OCPI-ready model)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS interop_ingestion_events (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(80) NOT NULL,
        protocol VARCHAR(30) NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        external_id VARCHAR(150),
        payload JSONB NOT NULL,
        status VARCHAR(20) DEFAULT 'processed',
        error_message TEXT,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_interop_events_provider ON interop_ingestion_events(provider)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_interop_events_processed_at ON interop_ingestion_events(processed_at DESC)`);
    console.log("✅ interop_ingestion_events table ready");

    // 8. Charging sessions and invoices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS charging_sessions (
        id SERIAL PRIMARY KEY,
        reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        charger_id INTEGER REFERENCES chargers(id) ON DELETE SET NULL,
        energy_kwh DECIMAL(10,2) NOT NULL,
        energy_price_inr DECIMAL(10,2) NOT NULL,
        session_fee_inr DECIMAL(10,2) DEFAULT 0,
        idle_fee_inr DECIMAL(10,2) DEFAULT 0,
        tax_percent DECIMAL(5,2) DEFAULT 18,
        payment_status VARCHAR(20) DEFAULT 'pending',
        payment_method VARCHAR(40),
        provider_ref VARCHAR(120),
        started_at TIMESTAMP,
        ended_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charging_sessions_user ON charging_sessions(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charging_sessions_created ON charging_sessions(created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES charging_sessions(id) ON DELETE CASCADE,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        subtotal_inr DECIMAL(10,2) NOT NULL,
        tax_inr DECIMAL(10,2) NOT NULL,
        total_inr DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'INR',
        status VARCHAR(20) DEFAULT 'issued',
        issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pdf_url TEXT,
        meta JSONB DEFAULT '{}'::jsonb
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_session ON invoices(session_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_issued_at ON invoices(issued_at DESC)`);
    console.log("✅ charging_sessions and invoices tables ready");

    // 9. Fleet and B2B controls
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleet_accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(140) NOT NULL,
        billing_email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleet_members (
        id SERIAL PRIMARY KEY,
        fleet_id INTEGER REFERENCES fleet_accounts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(fleet_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id SERIAL PRIMARY KEY,
        fleet_id INTEGER REFERENCES fleet_accounts(id) ON DELETE CASCADE,
        label VARCHAR(120) NOT NULL,
        vehicle_model VARCHAR(120),
        battery_capacity_kwh DECIMAL(8,2),
        range_km DECIMAL(8,2),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fleet_policies (
        id SERIAL PRIMARY KEY,
        fleet_id INTEGER UNIQUE REFERENCES fleet_accounts(id) ON DELETE CASCADE,
        max_session_amount_inr DECIMAL(10,2) DEFAULT 2000,
        allow_public_chargers BOOLEAN DEFAULT true,
        allow_fast_chargers BOOLEAN DEFAULT true,
        idle_fee_cap_inr DECIMAL(10,2) DEFAULT 250,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fleet_members_user ON fleet_members(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fleet_members_fleet ON fleet_members(fleet_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_fleet ON fleet_vehicles(fleet_id)`);
    console.log("✅ fleet_accounts, fleet_members, fleet_vehicles, fleet_policies tables ready");

    // 10. Saved routes table for route history and bookmarks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_routes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        route_name VARCHAR(255) NOT NULL,
        from_location VARCHAR(255) NOT NULL,
        to_location VARCHAR(255) NOT NULL,
        from_lat DECIMAL(10,8),
        from_lng DECIMAL(11,8),
        to_lat DECIMAL(10,8),
        to_lng DECIMAL(11,8),
        distance_km DECIMAL(10,2),
        duration_minutes INTEGER,
        vehicle_type VARCHAR(50) DEFAULT 'car',
        charger_stops JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at DESC)`);
    console.log("✅ saved_routes table ready");

    console.log("✅ All database tables initialized");
  } catch (err) {
    console.error("❌ Database initialization error:", err.message);
  }
};

module.exports = { pool, initDB };