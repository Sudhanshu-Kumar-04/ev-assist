import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import EVConfig from "./EVConfig";

export default function RoutePlanner({ setStations, setRoute, isMobile = false, onHeightChange, onRouteStart, onClearRoute, onRouteFound }) {
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(!isMobile);
    const [recommendations, setRecommendations] = useState(null);
    const [routeCreated, setRouteCreated] = useState(false);
    const [evProfile, setEvProfile] = useState({
        batteryPct: 60,
        batteryCapacityKwh: 60,
        efficiencyKmPerKwh: 6,
        reservePct: 15,
        targetChargePct: 80,
        legSafetyFactor: 0.85,
    });
    const plannerRef = useRef(null);

    useEffect(() => {
        setIsOpen(!isMobile);
    }, [isMobile]);

    useEffect(() => {
        if (!onHeightChange || !plannerRef.current) return;

        const updateHeight = () => {
            onHeightChange(plannerRef.current?.offsetHeight || 0);
        };

        updateHeight();

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(updateHeight);
            observer.observe(plannerRef.current);
            return () => observer.disconnect();
        }

        window.addEventListener("resize", updateHeight);
        return () => window.removeEventListener("resize", updateHeight);
    }, [onHeightChange, isMobile]);

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

            if (onRouteStart) {
                onRouteStart({
                    origin: { lat: lat1, lng: lng1, label: from },
                    destination: { lat: lat2, lng: lng2, label: to },
                });
            }

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
            setRouteCreated(true);

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
                {
                    points: finalPoints,
                    routeDistanceKm: Number(routeData.distance || 0) / 1000,
                    evProfile,
                }
            );

            if (Array.isArray(chargers.data)) {
                // Backward compatibility with older backend shape.
                setStations(chargers.data);
                setRecommendations(null);
            } else {
                setStations(chargers.data.stations || []);
                setRecommendations(chargers.data.recommendations || null);
            }

            if (onRouteFound) {
                onRouteFound();
            }

        } catch (err) {
            console.error(err);
            alert("Something went wrong ❌");
        } finally {
            setLoading(false);
        }
    };

    const panelContent = (
        <div style={{
            background: "rgba(255,255,255,0.96)",
            padding: isMobile ? "6px" : "10px",
            borderRadius: "10px",
            display: "grid",
            gap: "6px",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr auto",
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
                    padding: isMobile ? "7px 8px" : "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: isMobile ? "12px" : "14px",
                }}
            />
            <input
                placeholder="To"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{
                    flex: 1,
                    minWidth: 0,
                    padding: isMobile ? "7px 8px" : "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    fontSize: isMobile ? "12px" : "14px",
                }}
            />
            <button
                onClick={getRoute}
                disabled={loading}
                style={{
                    padding: isMobile ? "7px 10px" : "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#111827",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: isMobile ? "12px" : "14px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    minWidth: isMobile ? "100%" : "110px",
                    gridColumn: isMobile ? "1 / -1" : "auto",
                }}
            >
                {loading ? "Finding..." : "Find Route"}
            </button>

            <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                <EVConfig
                    onConfigChange={(cfg) => {
                        const batteryPct = Number(cfg.battery) || 60;
                        const batteryCapacityKwh = Number(cfg.capacity) || 60;
                        const efficiencyKmPerKwh = Number(cfg.efficiency) || 6;
                        const reservePct = Number(cfg.reservePct) || 15;
                        const targetChargePct = Number(cfg.targetChargePct) || 80;
                        const legSafetyFactor = Number(cfg.legSafetyFactor) || 0.85;
                        setEvProfile((prev) => ({
                            ...prev,
                            batteryPct,
                            batteryCapacityKwh,
                            efficiencyKmPerKwh,
                            reservePct,
                            targetChargePct,
                            legSafetyFactor,
                        }));
                    }}
                />
            </div>

            {recommendations ? (
                <div
                    style={{
                        gridColumn: "1 / -1",
                        border: "1px solid #d1fae5",
                        background: "#f0fdf4",
                        borderRadius: 10,
                        padding: 10,
                        marginTop: 2,
                    }}
                >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                        Smart plan: {recommendations.primaryStops?.length || 0} primary stops, {recommendations.backupStops?.length || 0} backups
                    </div>
                    <div style={{ fontSize: 11, color: "#166534", marginTop: 3 }}>
                        Route {recommendations.totalDistanceKm} km • Max leg {recommendations.recommendedLegKm} km
                    </div>
                    {(recommendations.primaryStops || []).slice(0, 2).map((stop, idx) => (
                        <div key={`primary-${idx}`} style={{ fontSize: 11, marginTop: 5, color: "#14532d" }}>
                            🚀 Stop {idx + 1}: {stop.station?.name || "Recommended station"} ({Math.round(stop.station?.planning_wait_min || 0)}m wait)
                        </div>
                    ))}
                    {(recommendations.backupStops || []).slice(0, 1).map((stop, idx) => (
                        <div key={`backup-${idx}`} style={{ fontSize: 11, marginTop: 5, color: "#1d4ed8" }}>
                            💸 Backup: {stop.station?.name || "Backup station"} (₹{stop.station?.planning_cost_per_kwh || "~"}/kWh)
                        </div>
                    ))}
                </div>
            ) : null}

            {routeCreated ? (
                <button
                    onClick={() => {
                        setRouteCreated(false);
                        setRecommendations(null);
                        if (onClearRoute) onClearRoute();
                    }}
                    style={{
                        gridColumn: "1 / -1",
                        marginTop: 2,
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #86efac",
                        background: "#dcfce7",
                        color: "#166534",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                    }}
                >
                    Clear Route and Show Chargers
                </button>
            ) : null}
        </div>
    );

    if (isMobile) {
        return (
            <div
                ref={plannerRef}
                style={{
                    position: "absolute",
                    top: "58px",
                    right: "10px",
                    zIndex: 1200,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    alignItems: "flex-end",
                }}
            >
                <button
                    onClick={() => setIsOpen((prev) => !prev)}
                    style={{
                        padding: "7px 11px",
                        borderRadius: "8px",
                        border: "1px solid #d1d5db",
                        background: "rgba(255,255,255,0.95)",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#1f2937",
                        cursor: "pointer",
                        alignSelf: "flex-end",
                    }}
                >
                    {isOpen ? "Hide Route" : "Route Planner"}
                </button>
                {isOpen ? panelContent : null}
            </div>
        );
    }

    return (
        <div
            ref={plannerRef}
            style={{
                position: "absolute",
                top: "10px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1200,
            }}
        >
            {panelContent}
        </div>
    );
}