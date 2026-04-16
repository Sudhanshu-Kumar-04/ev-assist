from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import pandas as pd
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Load model once on startup
import os
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model = joblib.load(os.path.join(BASE_DIR, "model", "wait_time_model.pkl"))
print("✅ Model loaded")

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json()

        # Accept explicit values or derive from current time
        now = datetime.now()
        hour = data.get("hour", now.hour)
        day_of_week = data.get("day_of_week", now.weekday())  # 0=Mon
        power_kw = float(data.get("power_kw", 22))
        num_ports = int(data.get("num_ports", 2))
        current_occupancy = int(data.get("current_occupancy", 0))

        features = pd.DataFrame([{
            "hour": hour,
            "day_of_week": day_of_week,
            "power_kw": power_kw,
            "num_ports": num_ports,
            "current_occupancy": current_occupancy
        }])
        prediction = model.predict(features)[0]
        wait_minutes = round(float(prediction), 1)

        # Human-readable label
        if wait_minutes < 5:
            label = "Available now"
            color = "green"
        elif wait_minutes < 15:
            label = f"~{int(wait_minutes)} min wait"
            color = "yellow"
        elif wait_minutes < 30:
            label = f"~{int(wait_minutes)} min wait"
            color = "orange"
        else:
            label = f"~{int(wait_minutes)}+ min wait"
            color = "red"

        return jsonify({
            "wait_minutes": wait_minutes,
            "label": label,
            "color": color,
            "inputs": {
                "hour": hour,
                "day_of_week": day_of_week,
                "power_kw": power_kw,
                "num_ports": num_ports,
                "current_occupancy": current_occupancy
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/predict/bulk", methods=["POST"])
def predict_bulk():
    """Predict wait times for multiple chargers at once."""
    try:
        data = request.get_json()
        chargers = data.get("chargers", [])
        now = datetime.now()

        results = []
        for c in chargers:
            hour = data.get("hour", now.hour)
            day_of_week = data.get("day_of_week", now.weekday())
            power_kw = float(c.get("power_kw") or 22)
            num_ports = int(c.get("quantity") or 2)
            current_occupancy = int(c.get("current_occupancy", 0))

            features = pd.DataFrame([{
                "hour": hour,
                "day_of_week": day_of_week,
                "power_kw": power_kw,
                "num_ports": num_ports,
                "current_occupancy": current_occupancy
            }])
            wait = round(float(model.predict(features)[0]), 1)

            if wait < 5:
                label, color = "Available now", "green"
            elif wait < 15:
                label, color = f"~{int(wait)} min", "yellow"
            elif wait < 30:
                label, color = f"~{int(wait)} min", "orange"
            else:
                label, color = f"~{int(wait)}+ min", "red"

            results.append({
                "charger_id": c.get("id"),
                "wait_minutes": wait,
                "label": label,
                "color": color
            })

        return jsonify(results)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": "wait_time_model_v1"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5002)), debug=os.getenv("FLASK_DEBUG") == "1")