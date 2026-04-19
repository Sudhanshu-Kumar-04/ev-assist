import React, { useState } from "react";
import axios from "axios";

export default function RoutePlanner({ setStations, setRoute, isMobile = false }) {
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
            top: isMobile ? "62px" : "10px",
            left: isMobile ? "10px" : "50%",
            right: isMobile ? "10px" : "auto",
            transform: isMobile ? "none" : "translateX(-50%)",
            zIndex: 1200,
            background: "rgba(255,255,255,0.96)",
            padding: isMobile ? "8px" : "10px",
            borderRadius: "10px",
            display: "flex",
            gap: "8px",
            flexDirection: isMobile ? "row" : "row",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            width: isMobile ? "calc(100vw - 20px)" : "auto",
            maxWidth: isMobile ? "calc(100vw - 20px)" : "none",
            alignItems: "center",
        }}>
            <input
                placeholder="From"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{
                    flex: 1,
                    minWidth: 0,
                    padding: isMobile ? "8px 10px" : "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: isMobile ? "13px" : "14px",
                }}
            />
            <input
                placeholder="To"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{
                    flex: 1,
                    minWidth: 0,
                    padding: isMobile ? "8px 10px" : "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: isMobile ? "13px" : "14px",
                }}
            />
            <button
                onClick={getRoute}
                disabled={loading}
                style={{
                    padding: isMobile ? "8px 10px" : "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#111827",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: isMobile ? "12px" : "14px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    minWidth: isMobile ? "84px" : "110px",
                }}
            >
                {loading ? "Finding..." : "Find Route"}
            </button>
        </div>
    );
}