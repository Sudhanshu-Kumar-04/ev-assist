import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import joblib
import os

# ── Generate synthetic training data ─────────────────────────────────────────
# In a real system this would come from actual usage logs.
# We simulate realistic patterns: busy mornings/evenings, weekends busier, etc.

np.random.seed(42)
N = 5000

hours = np.random.randint(0, 24, N)
days_of_week = np.random.randint(0, 7, N)   # 0=Mon, 6=Sun
power_kw = np.random.choice([7, 22, 50, 150], N)
num_ports = np.random.choice([1, 2, 4, 6], N)
current_occupancy = np.random.randint(0, num_ports + 1)

# Simulate wait time based on realistic rules
def simulate_wait(hour, day, power, ports, occupancy):
    base = 0.0

    # Rush hours: 8-10am and 6-9pm
    if 8 <= hour <= 10 or 18 <= hour <= 21:
        base += np.random.uniform(10, 30)
    elif 12 <= hour <= 14:
        base += np.random.uniform(5, 20)
    else:
        base += np.random.uniform(0, 10)

    # Weekends busier
    if day >= 5:
        base += np.random.uniform(5, 15)

    # Slower chargers take longer per session → longer queues
    if power <= 7:
        base += np.random.uniform(10, 25)
    elif power <= 22:
        base += np.random.uniform(5, 15)
    else:
        base += np.random.uniform(0, 5)

    # More ports = shorter wait
    base -= ports * np.random.uniform(1, 3)

    # Higher current occupancy = longer wait
    if ports > 0:
        occupancy_ratio = occupancy / ports
        base += occupancy_ratio * np.random.uniform(10, 20)

    return max(0, round(base + np.random.normal(0, 3), 1))

wait_times = [
    simulate_wait(hours[i], days_of_week[i], power_kw[i], num_ports[i], current_occupancy[i])
    for i in range(N)
]

df = pd.DataFrame({
    "hour": hours,
    "day_of_week": days_of_week,
    "power_kw": power_kw,
    "num_ports": num_ports,
    "current_occupancy": current_occupancy,
    "wait_time_minutes": wait_times
})

print("Dataset sample:")
print(df.head(10))
print(f"\nWait time stats:\n{df['wait_time_minutes'].describe()}")

# ── Train model ───────────────────────────────────────────────────────────────
features = ["hour", "day_of_week", "power_kw", "num_ports", "current_occupancy"]
X = df[features]
y = df["wait_time_minutes"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = RandomForestRegressor(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

preds = model.predict(X_test)
mae = mean_absolute_error(y_test, preds)
print(f"\n✅ Model trained — MAE: {mae:.2f} minutes")

# Feature importance
importances = pd.Series(model.feature_importances_, index=features).sort_values(ascending=False)
print(f"\nFeature importances:\n{importances}")

# ── Save model ────────────────────────────────────────────────────────────────
os.makedirs("model", exist_ok=True)
joblib.dump(model, "model/wait_time_model.pkl")
print("\n✅ Model saved to model/wait_time_model.pkl")