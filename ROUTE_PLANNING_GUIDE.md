# EV Assist - Route Planning Functions Documentation

## Overview

The enhanced route planning system provides comprehensive route calculation, trip planning, and route management capabilities for EV navigation with support for multiple vehicle types and charger integration.

---

## Backend API Endpoints

### 1. **Trip Details by Vehicle Type**

**Endpoint:** `POST /chargers/route/trip-details`

Calculate trip time, distance, and ETA for a specific vehicle type.

**Request Body:**

```json
{
  "origin": "77.2099,28.6139",
  "destination": "75.8140,26.9124",
  "vehicleType": "car"
}
```

**Vehicle Types:**

- `car` - Standard car (1.0x multiplier)
- `two-wheeler` - Motorcycle/scooter (1.15x multiplier)
- `bike` - Bicycle (1.25x multiplier)
- `electric_bike` - E-bike (1.8x multiplier)
- `foot` - Walking (3.5x multiplier)

**Response:**

```json
{
  "vehicleType": "car",
  "distanceKm": 290.5,
  "estimatedTimeMinutes": 348,
  "estimatedTimeFormatted": "5h 48m",
  "arrivalTime": "2026-05-01T17:15:00Z",
  "arrivalTimeFormatted": "17:15, 1 May",
  "geometry": {...}
}
```

---

### 2. **Get Route Alternatives**

**Endpoint:** `POST /chargers/route/alternatives`

Retrieve multiple route options with different characteristics.

**Request Body:**

```json
{
  "origin": "77.2099,28.6139",
  "destination": "75.8140,26.9124"
}
```

**Response:**

```json
{
  "alternatives": [
    {
      "id": 0,
      "label": "Fastest",
      "distanceKm": 290.5,
      "durationMinutes": 348,
      "durationFormatted": "5h 48m",
      "arrivalTime": "17:15, 1 May",
      "geometry": {...}
    },
    {
      "id": 1,
      "label": "Balanced",
      "distanceKm": 295.2,
      "durationMinutes": 352,
      "durationFormatted": "5h 52m",
      "arrivalTime": "17:19, 1 May",
      "geometry": {...}
    },
    {
      "id": 2,
      "label": "Scenic",
      "distanceKm": 310.8,
      "durationMinutes": 375,
      "durationFormatted": "6h 15m",
      "arrivalTime": "17:42, 1 May",
      "geometry": {...}
    }
  ]
}
```

---

### 3. **Calculate Trip Legs**

**Endpoint:** `POST /chargers/route/trip-legs`

Break down route into segments with charger stops and time/distance for each leg.

**Request Body:**

```json
{
  "points": [
    { "lat": 28.6139, "lng": 77.2099 },
    { "lat": 27.7, "lng": 77.5 }
  ],
  "chargerStops": [
    {
      "name": "Charger 1",
      "latitude": 28.5,
      "longitude": 77.0,
      "power_kw": 50
    },
    {
      "name": "Charger 2",
      "latitude": 27.0,
      "longitude": 77.5,
      "power_kw": 120
    }
  ],
  "evProfile": {
    "efficiencyKmPerKwh": 6
  }
}
```

**Response:**

```json
{
  "totalLegs": 2,
  "legs": [
    {
      "legNumber": 1,
      "from": "Start",
      "to": "Charger 1",
      "distanceKm": 85.5,
      "estimatedDrivingMinutes": 102,
      "chargingStopMinutes": 20,
      "totalLegTimeMinutes": 122,
      "chargerDetails": {
        "name": "Charger 1",
        "power": 50,
        "type": "DC"
      }
    }
  ],
  "totalDistanceKm": 290.5,
  "totalTimeMinutes": 348
}
```

---

### 4. **Get ETA by Transportation Mode**

**Endpoint:** `POST /chargers/route/eta-by-mode`

Get ETA comparison for all available transportation modes.

**Request Body:**

```json
{
  "origin": "77.2099,28.6139",
  "destination": "75.8140,26.9124"
}
```

**Response:**

```json
{
  "distanceKm": 290.5,
  "etaOptions": [
    {
      "mode": "car",
      "label": "Car",
      "icon": "🚗",
      "color": "#3B82F6",
      "timeMinutes": 348,
      "timeFormatted": "5h 48m",
      "arrivalTime": "17:15, 1 May"
    },
    {
      "mode": "two-wheeler",
      "label": "Two-Wheeler",
      "icon": "🏍️",
      "color": "#F59E0B",
      "timeMinutes": 401,
      "timeFormatted": "6h 41m",
      "arrivalTime": "18:48, 1 May"
    },
    {
      "mode": "bike",
      "label": "Bike",
      "icon": "🚲",
      "color": "#10B981",
      "timeMinutes": 435,
      "timeFormatted": "7h 15m",
      "arrivalTime": "19:22, 1 May"
    },
    {
      "mode": "electric_bike",
      "label": "E-Bike",
      "icon": "⚡🚲",
      "color": "#8B5CF6",
      "timeMinutes": 626,
      "timeFormatted": "10h 26m",
      "arrivalTime": "22:34, 1 May"
    },
    {
      "mode": "foot",
      "label": "Walking",
      "icon": "🚶",
      "color": "#6B7280",
      "timeMinutes": 1218,
      "timeFormatted": "20h 18m",
      "arrivalTime": "08:33, 2 May"
    }
  ]
}
```

---

### 5. **Save Route**

**Endpoint:** `POST /chargers/routes/save` (Requires Authentication)

Save a route for later use and quick access.

**Request Body:**

```json
{
  "routeName": "Delhi to Jaipur",
  "fromLocation": "Delhi",
  "toLocation": "Jaipur",
  "fromLat": 28.6139,
  "fromLng": 77.2099,
  "toLat": 26.9124,
  "toLng": 75.814,
  "distance": 290.5,
  "duration": 348,
  "vehicleType": "car",
  "chargers": [
    {
      "id": 123,
      "name": "Fast Charger Delhi",
      "latitude": 28.5,
      "longitude": 77.0,
      "power_kw": 120
    }
  ]
}
```

**Response:**

```json
{
  "message": "Route saved successfully 📍",
  "route": {
    "id": 1,
    "user_id": 42,
    "route_name": "Delhi to Jaipur",
    "from_location": "Delhi",
    "to_location": "Jaipur",
    "distance_km": 290.5,
    "duration_minutes": 348,
    "vehicle_type": "car",
    "created_at": "2026-05-01T11:15:00Z",
    "updated_at": "2026-05-01T11:15:00Z"
  }
}
```

---

### 6. **Get Saved Routes**

**Endpoint:** `GET /chargers/routes/saved` (Requires Authentication)

Retrieve all saved routes for the authenticated user.

**Response:**

```json
{
  "routes": [
    {
      "id": 1,
      "route_name": "Delhi to Jaipur",
      "from_location": "Delhi",
      "to_location": "Jaipur",
      "distance_km": 290.5,
      "duration_minutes": 348,
      "vehicle_type": "car",
      "charger_stops": [
        {
          "name": "Charger 1",
          "latitude": 28.5,
          "longitude": 77.0
        }
      ],
      "created_at": "2026-05-01T11:15:00Z",
      "updated_at": "2026-05-01T11:15:00Z"
    }
  ]
}
```

---

### 7. **Delete Route**

**Endpoint:** `DELETE /chargers/routes/:routeId` (Requires Authentication)

Delete a saved route.

**Response:**

```json
{
  "message": "Route deleted successfully"
}
```

---

### 8. **Add Stop to Route**

**Endpoint:** `POST /chargers/routes/:routeId/add-stop` (Requires Authentication)

Add a charger stop to an existing saved route.

**Request Body:**

```json
{
  "stopName": "Mid-way Charger",
  "stopLat": 27.7,
  "stopLng": 77.5,
  "stopIndex": 1
}
```

**Response:**

```json
{
  "message": "Stop added successfully",
  "stops": [
    {
      "name": "Start Charger",
      "latitude": 28.5,
      "longitude": 77.0
    },
    {
      "name": "Mid-way Charger",
      "latitude": 27.7,
      "longitude": 77.5
    }
  ]
}
```

---

### 9. **Remove Stop from Route**

**Endpoint:** `POST /chargers/routes/:routeId/remove-stop` (Requires Authentication)

Remove a charger stop from a saved route.

**Request Body:**

```json
{
  "stopIndex": 1
}
```

**Response:**

```json
{
  "message": "Stop removed successfully",
  "stops": [
    {
      "name": "Start Charger",
      "latitude": 28.5,
      "longitude": 77.0
    }
  ]
}
```

---

## Frontend Service: `routeService.js`

Located at: `frontend/src/services/routeService.js`

### Usage Example:

```javascript
import routeService from "./services/routeService";

// Get ETA for all modes
const etaData = await routeService.getEtaByMode(
  "77.2099,28.6139",
  "75.8140,26.9124",
);
console.log(etaData.etaOptions); // All mode options

// Get trip details for specific mode
const tripData = await routeService.getTripDetails(
  "77.2099,28.6139",
  "75.8140,26.9124",
  "two-wheeler",
);

// Save a route
await routeService.saveRoute({
  routeName: "My Favorite Route",
  fromLocation: "Delhi",
  toLocation: "Jaipur",
  fromLat: 28.6139,
  fromLng: 77.2099,
  toLat: 26.9124,
  toLng: 75.814,
  distance: 290.5,
  duration: 348,
  vehicleType: "car",
  chargers: [],
});

// Get saved routes
const routes = await routeService.getSavedRoutes();
```

---

## Frontend Hook: `useRoutePlanning`

Located at: `frontend/src/hooks/useRoutePlanning.js`

### Usage Example:

```javascript
import { useRoutePlanning } from "./hooks/useRoutePlanning";

function MyRouteComponent() {
  const {
    currentRoute,
    etaOptions,
    routes,
    loading,
    error,
    fetchEtaOptions,
    fetchTripDetails,
    saveCurrentRoute,
    loadSavedRoutes,
  } = useRoutePlanning();

  const handleFetchETA = async () => {
    await fetchEtaOptions("77.2099,28.6139", "75.8140,26.9124");
  };

  const handleSaveRoute = async () => {
    await saveCurrentRoute("My Route", []);
  };

  const handleLoadRoutes = async () => {
    await loadSavedRoutes();
  };

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}

      {etaOptions.map((option) => (
        <div key={option.mode}>
          <span>
            {option.icon} {option.label}
          </span>
          <span>{option.timeFormatted}</span>
          <span>{option.arrivalTime}</span>
        </div>
      ))}

      {routes.map((route) => (
        <div key={route.id}>
          <h3>{route.route_name}</h3>
          <p>
            {route.from_location} → {route.to_location}
          </p>
          <p>
            {route.distance_km} km • {route.duration_minutes} min
          </p>
        </div>
      ))}

      <button onClick={handleFetchETA}>Get ETAs</button>
      <button onClick={handleSaveRoute}>Save Route</button>
      <button onClick={handleLoadRoutes}>Load My Routes</button>
    </div>
  );
}
```

---

## Database Schema

### `saved_routes` Table

```sql
CREATE TABLE saved_routes (
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
);

CREATE INDEX idx_saved_routes_user ON saved_routes(user_id);
CREATE INDEX idx_saved_routes_created ON saved_routes(created_at DESC);
```

---

## Features Overview

✅ **Multi-Modal Transportation**

- Support for car, two-wheeler, bike, e-bike, and walking
- Automatic time multipliers based on vehicle type
- Real-time ETA comparison

✅ **Route Planning**

- Multiple route alternatives (fastest, balanced, scenic)
- Charger stop integration
- Trip leg breakdown

✅ **Route Management**

- Save favorite routes
- View route history
- Manage stops (add/remove)
- Delete unwanted routes

✅ **Smart Calculations**

- Distance calculation
- ETA with vehicle type consideration
- Charging time estimation
- Leg-by-leg journey planning

---

## Error Handling

All endpoints return proper HTTP status codes and error messages:

- `400` - Bad Request (missing/invalid parameters)
- `404` - Not Found (route/charger not found)
- `500` - Server Error (database/service error)

Example error response:

```json
{
  "error": "Origin and destination required"
}
```

---

## Integration Steps

1. **Restart Backend Server**

   ```bash
   npm start
   ```

   Database tables will auto-initialize.

2. **Update Frontend**
   - Service and hook files are ready to use
   - Import and integrate into components

3. **Test Endpoints**
   ```bash
   # Test trip details
   curl -X POST http://localhost:3001/chargers/route/trip-details \
     -H "Content-Type: application/json" \
     -d '{"origin":"77.2099,28.6139","destination":"75.8140,26.9124","vehicleType":"car"}'
   ```

---

## Notes

- All coordinates should be in "lng,lat" format for OSRM API
- Times are calculated based on OSRM routing engine
- Vehicle type multipliers are estimates and can be adjusted
- Charger stops use PostGIS for proximity calculations
- Authentication required for route save/load/delete operations
