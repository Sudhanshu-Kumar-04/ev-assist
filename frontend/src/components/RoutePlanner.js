import React, { useState } from "react";
import axios from "axios";

export default function RoutePlanner({ setStations, setRoute }) {
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [loading, setLoading] = useState(false);

    const getRoute = async () => {
        setLoading(true);
        try {
            const geoFrom = await axios.get(
                `/chargers/geocode?text=${from}`
            );

            const geoTo = await axios.get(
                `/chargers/geocode?text=${to}`
            );

            if (!geoFrom.data.features.length || !geoTo.data.features.length) {
                alert("Invalid location ❌");
                return;
            }

            const [lng1, lat1] = geoFrom.data.features[0].geometry.coordinates;
            const [lng2, lat2] = geoTo.data.features[0].geometry.coordinates;

            const routeRes = await axios.get(
                `/chargers/route?origin=${lng1},${lat1}&destination=${lng2},${lat2}`
            );

            const routeData = routeRes.data.route;

            if (!routeData) {
                alert("Route not found ❌");
                return;
            }

            const coords = routeData.geometry?.coordinates;

            if (!coords) {
                alert("Invalid route data ❌");
                return;
            }

            const routePoints = coords.map(([lng, lat]) => ({ lat, lng }));
            setRoute(routePoints);

            // ✅ FIX: Sample every 5th point (was every 10th) for better route coverage
            // Also always include the first and last point (origin & destination)
            const sampledPoints = routePoints.filter((_, i) => i % 5 === 0);

            // Ensure last point is always included
            const lastPoint = routePoints[routePoints.length - 1];
            if (sampledPoints[sampledPoints.length - 1] !== lastPoint) {
                sampledPoints.push(lastPoint);
            }

            // ✅ Cap at 200 points max to avoid hitting DB query limits
            const finalPoints = sampledPoints.length > 200
                ? sampledPoints.filter((_, i) => i % Math.ceil(sampledPoints.length / 200) === 0)
                : sampledPoints;

            const chargers = await axios.post(
                "/chargers/route-chargers",
                { points: finalPoints }
            );

            setStations(chargers.data);

        } catch (err) {
            console.error(err);
            alert("Something went wrong ❌");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: "absolute",
            top: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "white",
            padding: "10px",
            borderRadius: "10px",
            display: "flex",
            gap: "10px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)"
        }}>
            <input
                placeholder="From"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
            />
            <input
                placeholder="To"
                value={to}
                onChange={(e) => setTo(e.target.value)}
            />
            <button onClick={getRoute} disabled={loading}>
                {loading ? "Finding..." : "Find Route"}
            </button>
        </div>
    );
}