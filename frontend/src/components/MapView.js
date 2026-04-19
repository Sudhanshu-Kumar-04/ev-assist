import RoutePlanner from "./RoutePlanner.js";
import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, ZoomControl } from "react-leaflet";
import L from "leaflet";
import axios from "axios";
import ReservationModal from "./ReservationModal";
import MyReservations from "./MyReservations";
import CostEstimator from "./CostEstimator";
import MyFavorites from "./MyFavorites";
import { useAuth } from "../context/AuthContext";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

// Replace MapUpdater in MapView.js completely:
function MapUpdater({ userLocation, setStations }) {
  const map = useMap();

  const fetchByBounds = async () => {
    try {
      const bounds = map.getBounds();
      const north = bounds.getNorth();
      const south = bounds.getSouth();
      const east = bounds.getEast();
      const west = bounds.getWest();
      const zoom = map.getZoom();

      const centerLat = (north + south) / 2;
      const centerLng = (east + west) / 2;

      // Calculate radius based on zoom level
      // zoom 5 (all India) = 500km, zoom 10 = 100km, zoom 13 = 30km
      const radiusKm = zoom <= 5 ? 500 :
        zoom <= 7 ? 300 :
          zoom <= 9 ? 150 :
            zoom <= 11 ? 80 :
              zoom <= 13 ? 50 : 30;

      const res = await axios.get(
        `/chargers?lat=${centerLat}&lng=${centerLng}&radius=${radiusKm}`
      );
      setStations(res.data);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    if (!userLocation) return;
    fetchByBounds();
    map.on("moveend", fetchByBounds);
    map.on("zoomend", fetchByBounds);
    return () => {
      map.off("moveend", fetchByBounds);
      map.off("zoomend", fetchByBounds);
    };
  }, [map, userLocation]);

  return null;
}

// Helper function — add this above your MapView component
function getConnectionLabel(station) {
  if (station.connection_type && station.connection_type !== "Unknown")
    return station.connection_type;
  if (station.power_kw >= 50) return "DC Fast (CCS/CHAdeMO)";
  if (station.power_kw >= 22) return "AC Type 2";
  if (station.power_kw > 0) return "AC Type 1/2";
  return "Standard AC";
}

function getCurrentLabel(station) {
  if (station.current_type && station.current_type !== "Unknown")
    return station.current_type;
  if (station.power_kw >= 50) return "DC";
  return "AC";
}

function getPowerLabel(station) {
  if (station.power_kw) return `${station.power_kw} kW`;
  return "Standard";
}

function LocateMe({ userLocation, setStations }) {
  const map = useMap();

  const goToMyLocation = () => {
    const fallback = userLocation || { lat: 28.6139, lng: 77.2090 };

    // Always re-query the browser location on button click.
    // This avoids being stuck at an old fallback location.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          map.flyTo([lat, lng], 13, {
            animate: true,
            duration: 1.5,
          });
          axios.get(`/chargers?lat=${lat}&lng=${lng}&radius=50`)
            .then((res) => setStations(res.data))
            .catch(console.error);
        },
        () => {
          map.flyTo([fallback.lat, fallback.lng], 11, {
            animate: true,
            duration: 1.2,
          });
          axios.get(`/chargers?lat=${fallback.lat}&lng=${fallback.lng}&radius=80`)
            .then((res) => setStations(res.data))
            .catch(console.error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return;
    }

    map.flyTo([fallback.lat, fallback.lng], 11, {
      animate: true,
      duration: 1.2,
    });
    axios.get(`/chargers?lat=${fallback.lat}&lng=${fallback.lng}&radius=80`)
      .then((res) => setStations(res.data))
      .catch(console.error);
  };

  return (
    <button
      onClick={goToMyLocation}
      title="Go to my location"
      style={{
        position: "absolute",
        bottom: 30,
        right: 12,
        zIndex: 1000,
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: "#fff",
        border: "2px solid #e5e7eb",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        cursor: "pointer",
        fontSize: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      📍
    </button>
  );
}

export default function MapView() {
  const DEFAULT_LOCATION = { lat: 28.6139, lng: 77.2090 };
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [routePanelHeight, setRoutePanelHeight] = useState(104);
  const [userLocation, setUserLocation] = useState(null);
  const [stations, setStations] = useState([]);
  const [route, setRoute] = useState([]);
  const { user, token } = useAuth();
  const [reservingStation, setReservingStation] = useState(null);
  const [estimatingStation, setEstimatingStation] = useState(null);
  const [showMyReservations, setShowMyReservations] = useState(false);
  const [waitTimes, setWaitTimes] = useState({});
  const [waitLoading, setWaitLoading] = useState({});
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [showFavorites, setShowFavorites] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const estimateWait = async (station) => {
    if (!station?.id || waitTimes[station.id] || waitLoading[station.id]) return;

    setWaitLoading((prev) => ({ ...prev, [station.id]: true }));
    try {
      const res = await axios.post("/chargers/predict-wait", {
        power_kw: station.power_kw || 22,
        num_ports: station.quantity || 2,
        current_occupancy: 0,
      });

      if (res.data) {
        setWaitTimes((prev) => ({ ...prev, [station.id]: res.data }));
      }
    } catch (error) {
      console.error("Error estimating wait time:", error);
    } finally {
      setWaitLoading((prev) => ({ ...prev, [station.id]: false }));
    }
  };

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          setUserLocation(DEFAULT_LOCATION);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      setUserLocation(DEFAULT_LOCATION);
    }
  }, []);

  // Load user's favorite IDs on login so buttons show correct state
  useEffect(() => {
    if (!user || !token) { setFavoriteIds(new Set()); return; }
    axios.get("/chargers/favorites", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        const ids = new Set(res.data.map(c => c.id));
        setFavoriteIds(ids);
      })
      .catch(console.error);
  }, [user, token]);

  const userIcon = new L.Icon({
    iconUrl:
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });

  const chargerIcon = new L.Icon({
    iconUrl:
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });

  // route is rendered via <Polyline /> below; no direct map instance required here
  useEffect(() => {
    if (route.length > 0) {
      // If you need direct map control, use a map ref or react-leaflet's useMap in a child component.
      console.log(`Drawing route with ${route.length} points`);
    }
  }, [route]);

  // Replace addFavorite with this toggleFavorite function:
  const toggleFavorite = async (station) => {
    if (!user) { alert("Please sign in to save favorites ⭐"); return; }

    const isFav = favoriteIds.has(station.id);

    try {
      if (isFav) {
        // Remove
        await axios.delete(
          `/chargers/favorite/${station.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setFavoriteIds(prev => {
          const next = new Set(prev);
          next.delete(station.id);
          return next;
        });
      } else {
        // Add
        await axios.post(
          `/chargers/favorite/${station.id}`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setFavoriteIds(prev => new Set([...prev, station.id]));
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed");
    }
  };

  const loadFast = async () => {
    if (!userLocation) return;
    try {
      const res = await axios.get(
        `/chargers/fast?lat=${userLocation.lat}&lng=${userLocation.lng}`
      );
      setStations(res.data);
    } catch (err) { console.error(err); }
  };

  const loadAll = async () => {
    if (!userLocation) return;
    try {
      const res = await axios.get(
        `/chargers?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=50`
      );
      setStations(res.data);
    } catch (err) { console.error(err); }
  };

  // Add this function in MapView:
  const loadFavorites = async () => {
    if (!user) { alert("Please sign in to view favorites"); return; }
    try {
      const res = await axios.get("/chargers/favorites", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStations(res.data);
      if (res.data.length === 0) alert("No favorites yet! Click ⭐ on any charger to save it.");
    } catch (err) { console.error(err); }
  };

  if (!userLocation) return <p>Loading map...</p>;

  const routePanelTop = isMobile ? 58 : 10;
  const controlsToggleTop = isMobile ? routePanelTop + routePanelHeight + 8 : 10;
  const controlsPanelTop = isMobile ? controlsToggleTop + 36 : 10;

  return (
    <>
      {isMobile && (
        <button
          onClick={() => setShowMobileControls((prev) => !prev)}
          style={{
            position: "absolute",
            top: `${controlsToggleTop}px`,
            left: "10px",
            zIndex: 1001,
            padding: "6px 10px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            background: "rgba(255,255,255,0.95)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showMobileControls ? "Hide Controls" : "Show Controls"}
        </button>
      )}

      <div style={{
        padding: "10px",
        display: !isMobile || showMobileControls ? "flex" : "none",
        flexWrap: "wrap",
        gap: "8px",
        zIndex: 1000,
        position: "absolute",
        top: `${controlsPanelTop}px`,
        left: "10px",
        right: "10px",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderRadius: "8px",
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
        width: "calc(100vw - 20px)",
      }}>
        <button onClick={loadFast} style={{
          padding: isMobile ? "7px 10px" : "8px 12px",
          fontSize: isMobile ? "12px" : "14px",
          borderRadius: "6px",
          border: "1px solid #ddd",
          background: "#fff",
          cursor: "pointer",
          fontWeight: 500,
          whiteSpace: "nowrap",
          minWidth: isMobile ? "unset" : "120px",
          width: isMobile ? "calc(50% - 4px)" : "auto",
        }}>⚡ Fast Chargers</button>
        <button onClick={loadAll} style={{
          padding: isMobile ? "7px 10px" : "8px 12px",
          fontSize: isMobile ? "12px" : "14px",
          borderRadius: "6px",
          border: "1px solid #ddd",
          background: "#fff",
          cursor: "pointer",
          fontWeight: 500,
          whiteSpace: "nowrap",
          minWidth: isMobile ? "unset" : "120px",
          width: isMobile ? "calc(50% - 4px)" : "auto",
        }}>🔄 All Chargers</button>
        {user && (
          <button onClick={() => setShowFavorites(true)} style={{
            padding: isMobile ? "7px 10px" : "8px 12px",
            fontSize: isMobile ? "12px" : "14px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 500,
            whiteSpace: "nowrap",
            minWidth: isMobile ? "unset" : "110px",
            width: isMobile ? "calc(50% - 4px)" : "auto",
          }}>⭐ Favorites</button>
        )}
        {user && (
          <button onClick={() => setShowMyReservations(true)} style={{
            padding: isMobile ? "7px 10px" : "8px 12px",
            fontSize: isMobile ? "12px" : "14px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 500,
            whiteSpace: "nowrap",
            minWidth: isMobile ? "unset" : "110px",
            width: isMobile ? "calc(50% - 4px)" : "auto",
          }}>📅 My Bookings</button>
        )}
      </div>
      <RoutePlanner
        setStations={setStations}
        setRoute={setRoute}
        isMobile={isMobile}
        onHeightChange={setRoutePanelHeight}
      />
      <MapContainer
        center={[userLocation.lat, userLocation.lng]}
        zoom={10}
        zoomControl={false}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapUpdater userLocation={userLocation} setStations={setStations} />
        <LocateMe userLocation={userLocation} setStations={setStations} />
        <ZoomControl position="bottomleft" />

        <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
          <Popup>You are here</Popup>
        </Marker>
        {route.length > 0 && (
          <Polyline positions={route} pathOptions={{ color: "blue", weight: 5 }} />
        )}
        {stations
          .filter((s) => s.latitude && s.longitude)
          .map((station) => (
            <Marker
              key={station.id}
              position={[Number(station.latitude), Number(station.longitude)]}
              icon={chargerIcon}
              eventHandlers={{ click: () => estimateWait(station) }}
            >
              <Popup>
                <div style={{ minWidth: 200 }}>
                  {station.image_url ? (
                    <img
                      src={station.image_url}
                      alt={station.name}
                      style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
                    />
                  ) : null}
                  <b style={{ fontSize: 14 }}>{station.name}</b>
                  <br /><br />
                  {station.operator_name ? <>🏢 Operator: {station.operator_name}<br /></> : null}
                  {(station.town || station.state) ? <>📍 {station.town || ""}{station.town && station.state ? ", " : ""}{station.state || ""}<br /></> : null}
                  ⚡ Power: <b>{getPowerLabel(station)}</b><br />
                  🔌 Type: {getConnectionLabel(station)}<br />
                  ⚙️ Current: {getCurrentLabel(station)}<br />
                  🔢 Ports: {station.quantity || 1}<br />
                  {station.usage_cost ? <>💳 Cost: {station.usage_cost}<br /></> : null}
                  {station.contact_phone ? <>📞 {station.contact_phone}<br /></> : null}
                  {station.website_url ? (
                    <>
                      🌐 <a href={station.website_url} target="_blank" rel="noreferrer">Website</a><br />
                    </>
                  ) : null}

                  {waitLoading[station.id] ? (
                    <div style={{ fontSize: 11, color: "#6b7280", margin: "6px 0" }}>
                      🕐 Estimating...
                    </div>
                  ) : waitTimes[station.id] ? (
                    <div style={{
                      margin: "8px 0",
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 600,
                      background:
                        waitTimes[station.id].color === "green" ? "#d1fae5" :
                          waitTimes[station.id].color === "yellow" ? "#fef9c3" :
                            waitTimes[station.id].color === "orange" ? "#ffedd5" : "#fee2e2",
                      color:
                        waitTimes[station.id].color === "green" ? "#065f46" :
                          waitTimes[station.id].color === "yellow" ? "#713f12" :
                            waitTimes[station.id].color === "orange" ? "#7c2d12" : "#991b1b",
                    }}>
                      🕐 {waitTimes[station.id].label}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0" }}>
                      🕐 Click marker to estimate wait
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      onClick={() => toggleFavorite(station)}
                      style={{
                        padding: "4px 8px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                        border: favoriteIds.has(station.id) ? "1px solid #fca5a5" : "1px solid #ddd",
                        background: favoriteIds.has(station.id) ? "#fee2e2" : "#fff",
                        color: favoriteIds.has(station.id) ? "#dc2626" : "#374151",
                        fontWeight: favoriteIds.has(station.id) ? 600 : 400,
                      }}
                    >
                      {favoriteIds.has(station.id) ? "💔 Remove" : "⭐ Favorite"}
                    </button>
                    {user ? (
                      <>
                        <button
                          onClick={() => setReservingStation(station)}
                          style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600 }}
                        >
                          📅 Reserve
                        </button>
                        <button
                          onClick={() => setEstimatingStation(station)}
                          style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "none", background: "#059669", color: "#fff", cursor: "pointer", fontWeight: 600 }}
                        >
                          💰 Cost
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center" }}>Sign in to reserve</span>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
      {reservingStation && (
        <ReservationModal station={reservingStation} onClose={() => setReservingStation(null)} />
      )}
      {estimatingStation && (
        <CostEstimator station={estimatingStation} onClose={() => setEstimatingStation(null)} />
      )}
      {showMyReservations && (
        <MyReservations onClose={() => setShowMyReservations(false)} />
      )}
      {showFavorites && (
        <MyFavorites onClose={() => {
          setShowFavorites(false);
          // Refresh favoriteIds after closing
          axios.get("/chargers/favorites", {
            headers: { Authorization: `Bearer ${token}` }
          }).then(res => setFavoriteIds(new Set(res.data.map(c => c.id))));
        }} />
      )}
    </>
  );
}