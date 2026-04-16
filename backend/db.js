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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ users table ready");

    // 2. Chargers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chargers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        address TEXT,
        power_kw DECIMAL,
        connection_type VARCHAR(100),
        current_type VARCHAR(50),
        quantity INTEGER,
        location GEOGRAPHY(POINT, 4326),
        CONSTRAINT chargers_name_address_unique UNIQUE (name, address)
      )
    `);
    console.log("✅ chargers table ready");

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

    console.log("✅ All database tables initialized");
  } catch (err) {
    console.error("❌ Database initialization error:", err.message);
  }
};

module.exports = { pool, initDB };