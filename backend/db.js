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

    console.log("✅ All database tables initialized");
  } catch (err) {
    console.error("❌ Database initialization error:", err.message);
  }
};

module.exports = { pool, initDB };