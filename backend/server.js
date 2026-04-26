const { spawn } = require("child_process");
const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

let mlProcess = null;
if (process.env.START_ML_SERVICE !== "false") {
  mlProcess = spawn(
    process.env.ML_PYTHON || "python3",
    [path.join(__dirname, "../ml/app.py")],
    {
      stdio: "inherit",
      cwd: path.join(__dirname, "../ml"),
    }
  );

  mlProcess.on("error", (err) => {
    console.warn("⚠️ ML service failed to start:", err.message);
    console.warn("Wait-time predictions will be unavailable");
  });

  process.on("exit", () => mlProcess?.kill());
}

process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
}));
app.use(express.json());

const { initDB } = require("./db");

const chargerRoutes = require("./routes/chargers");
const { router: authRoutes } = require("./routes/auth");
const reservationRoutes = require("./routes/reservations");
const adminRoutes = require("./routes/admin");
const platformRoutes = require("./routes/platform");

app.use("/api/chargers", chargerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/platform", platformRoutes);

app.get("/", (req, res) => res.send("Server is running..."));

const PORT = process.env.PORT || 5001;

// ✅ initDB MUST finish before server starts accepting requests
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error("❌ Failed to initialize DB:", err);
  process.exit(1);
});