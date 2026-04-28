import RoutePlanner from "./RoutePlanner.js";
import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, ZoomControl } from "react-leaflet";
import L from "leaflet";
import axios from "axios";
import ReservationModal from "./ReservationModal";
import MyReservations from "./MyReservations";
import CostEstimator from "./CostEstimator";
import MyFavorites from "./MyFavorites";
import { useAuth } from "../context/AuthContext";
import "leaflet/dist/leaflet.css";

const DEFAULT_LOCATION = { lat: 28.6139, lng: 77.2090 };

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

// MapUpdater - fetches chargers within selected radius of user location
function MapUpdater({ userLocation, setStations, mapRef, radiusKm }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);

  const fetchNearby = useCallback(async () => {
    try {
      if (!userLocation?.lat || !userLocation?.lng) return;
      const res = await axios.get(
        `/chargers?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=${radiusKm}`
      );
      setStations(res.data);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  }, [radiusKm, setStations, userLocation]);

  useEffect(() => {
    if (!userLocation) return;
    fetchNearby();

    return () => {
      map.off("moveend", fetchNearby);
      map.off("zoomend", fetchNearby);
    };
  }, [fetchNearby, map, userLocation]);

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

function parseApproxCostPerKwh(station) {
  const raw = String(station?.usage_cost || "");
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function LocateMe({ userLocation, setUserLocation, setStations, isMobile, radiusKm }) {
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
          setUserLocation({ lat, lng });
          map.flyTo([lat, lng], 13, {
            animate: true,
            duration: 1.5,
          });
          axios.get(`/chargers?lat=${lat}&lng=${lng}&radius=${radiusKm}`)
            .then((res) => setStations(res.data))
            .catch(console.error);
        },
        () => {
          setUserLocation(fallback);
          map.flyTo([fallback.lat, fallback.lng], 11, {
            animate: true,
            duration: 1.2,
          });
          axios.get(`/chargers?lat=${fallback.lat}&lng=${fallback.lng}&radius=${radiusKm}`)
            .then((res) => setStations(res.data))
            .catch(console.error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return;
    }

    setUserLocation(fallback);
    map.flyTo([fallback.lat, fallback.lng], 11, {
      animate: true,
      duration: 1.2,
    });
    axios.get(`/chargers?lat=${fallback.lat}&lng=${fallback.lng}&radius=${radiusKm}`)
      .then((res) => setStations(res.data))
      .catch(console.error);
  };

  return (
    <button
      onClick={goToMyLocation}
      title="Go to my location"
      style={{
        position: "absolute",
        bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 126px)" : 30,
        right: isMobile ? 8 : 12,
        zIndex: 1100,
        width: isMobile ? 40 : 40,
        height: isMobile ? 40 : 40,
        borderRadius: "50%",
        background: "#fff",
        border: "2px solid #e5e7eb",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        cursor: "pointer",
        fontSize: isMobile ? 18 : 18,
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
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showControlsPanel, setShowControlsPanel] = useState(false);
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
  const [showRoutePlanner, setShowRoutePlanner] = useState(false);
  const [reportingIssueId, setReportingIssueId] = useState(null);
  const [plugFilter, setPlugFilter] = useState("any");
  const [showNearbyPanel, setShowNearbyPanel] = useState(window.innerWidth > 768);
  const [showMapActions, setShowMapActions] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [searchRadiusKm, setSearchRadiusKm] = useState("50");
  const [recentLocationSearches, setRecentLocationSearches] = useState(() => {
    try {
      const raw = localStorage.getItem("evassist.recentLocationSearches");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const mapRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const estimateWait = async (station) => {
    if (!station?.id || waitTimes[station.id] || waitLoading[station.id]) return;

    setWaitLoading((prev) => ({ ...prev, [station.id]: true }));
    try {
      const occupancyHint = Math.min(
        Number(station.quantity || 2),
        Math.max(0, Math.round(Number(station.open_issue_count || 0) * 0.35))
      );
      const res = await axios.post("/chargers/predict-wait", {
        power_kw: station.power_kw || 22,
        num_ports: station.quantity || 2,
        current_occupancy: occupancyHint,
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

  const chargerIcon = L.divIcon({
    className: "",
    html: `
      <svg width="32" height="44" viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16 43C16 43 2 29 2 16C2 8.3 8.3 2 16 2C23.7 2 30 8.3 30 16C30 29 16 43 16 43Z" fill="#718096"/>
        <circle cx="16" cy="16" r="11" fill="#e45747"/>
        <path d="M17.8 8.8L12.2 17.2H16.1L14.4 23.2L19.8 14.8H15.9L17.8 8.8Z" fill="#111827"/>
      </svg>
    `,
    iconSize: [32, 44],
    iconAnchor: [16, 43],
    popupAnchor: [0, -36],
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

  const reportIssue = async (station) => {
    if (!user || !token) {
      alert("Please sign in to report charger issues.");
      return;
    }

    const typed = window.prompt(
      "Issue type?\nUse one: offline, connector_broken, payment_failed, blocked, slow_charging, other"
    );
    if (!typed) return;

    const issueType = String(typed).trim().toLowerCase();
    const allowed = [
      "offline",
      "connector_broken",
      "payment_failed",
      "blocked",
      "slow_charging",
      "other",
    ];

    if (!allowed.includes(issueType)) {
      alert("Invalid issue type. Please use one of the listed values.");
      return;
    }

    const note = window.prompt("Optional note (max 300 chars)") || "";
    setReportingIssueId(station.id);
    try {
      await axios.post(
        `/chargers/${station.id}/report-issue`,
        { issueType, note: note.slice(0, 300) || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert("Issue reported. Thank you!");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to report issue");
    } finally {
      setReportingIssueId(null);
    }
  };

  const filteredStations = useMemo(() => {
    let list = stations.filter((s) => s.latitude && s.longitude);

    if (plugFilter === "dc") {
      list = list.filter((s) => {
        const current = String(s.current_type || "").toLowerCase();
        return current.includes("dc") || Number(s.power_kw) >= 50;
      });
    } else if (plugFilter === "ac") {
      list = list.filter((s) => {
        const current = String(s.current_type || "").toLowerCase();
        return current.includes("ac") || (Number(s.power_kw) > 0 && Number(s.power_kw) < 50);
      });
    } else if (plugFilter === "fast") {
      list = list.filter((s) => Number(s.power_kw) >= 50);
    }

    // Default sort: nearest first
    const sorted = [...list];
    sorted.sort((a, b) => Number(a.distance_km || Number.MAX_VALUE) - Number(b.distance_km || Number.MAX_VALUE));
    return sorted;
  }, [stations, plugFilter]);

  const saveRecentSearch = useCallback((entry) => {
    setRecentLocationSearches((prev) => {
      const deduped = prev.filter(
        (item) =>
          String(item.label || "").toLowerCase() !== String(entry.label || "").toLowerCase()
      );
      const next = [entry, ...deduped].slice(0, 5);
      try {
        localStorage.setItem("evassist.recentLocationSearches", JSON.stringify(next));
      } catch {
        // Ignore local storage issues and keep in-memory state.
      }
      return next;
    });
  }, []);

  const fetchChargersAt = useCallback(async (lat, lng, zoom = 12) => {
    const radius = Number(searchRadiusKm || 50);
    const nextLocation = { lat: Number(lat), lng: Number(lng) };
    setUserLocation(nextLocation);

    if (mapRef.current) {
      mapRef.current.flyTo([nextLocation.lat, nextLocation.lng], zoom, {
        animate: true,
        duration: 1.2,
      });
    }

    const chargersRes = await axios.get(
      `/chargers?lat=${nextLocation.lat}&lng=${nextLocation.lng}&radius=${radius}`
    );
    setStations(chargersRes.data || []);

    if (Array.isArray(chargersRes.data) && chargersRes.data.length === 0) {
      alert(`No chargers found within ${radius}km of this location.`);
    }
  }, [searchRadiusKm]);

  const searchLocationChargers = useCallback(async () => {
    const query = String(locationQuery || "").trim();
    if (!query) {
      alert("Please enter a location to search.");
      return;
    }

    setIsSearchingLocation(true);
    try {
      const geocodeRes = await axios.get(`/chargers/geocode?text=${encodeURIComponent(query)}`);
      const firstFeature = geocodeRes.data?.features?.[0];
      const coords = firstFeature?.geometry?.coordinates;

      if (!Array.isArray(coords) || coords.length < 2) {
        alert("Location not found. Try a more specific place name.");
        return;
      }

      const [lng, lat] = coords;
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        alert("Could not resolve coordinates for this location.");
        return;
      }

      await fetchChargersAt(lat, lng, 12);
      saveRecentSearch({ label: query, lat: Number(lat), lng: Number(lng) });
    } catch (err) {
      console.error("Location search error:", err);
      alert("Location search failed. Please try again.");
    } finally {
      setIsSearchingLocation(false);
    }
  }, [fetchChargersAt, locationQuery, saveRecentSearch]);

  const searchCurrentMapArea = useCallback(async () => {
    const center = mapRef.current?.getCenter?.();
    if (!center) {
      alert("Map is still loading. Please try again in a moment.");
      return;
    }

    setIsSearchingLocation(true);
    try {
      await fetchChargersAt(center.lat, center.lng, mapRef.current.getZoom());
    } catch (err) {
      console.error("Search map area error:", err);
      alert("Could not fetch chargers for this map area.");
    } finally {
      setIsSearchingLocation(false);
    }
  }, [fetchChargersAt]);

  const uniqueStations = useMemo(() => {
    const seen = new Set();
    return filteredStations.filter((station) => {
      const hasCoords = Number.isFinite(Number(station.latitude)) && Number.isFinite(Number(station.longitude));
      const normalizeText = (value) => String(value || "")
        .toLowerCase()
        .replace(/charging station|ev station|station|charger/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const normalizedName = normalizeText(station.name) || normalizeText(station.address) || "unknown";
      const latKey = hasCoords ? Number(station.latitude).toFixed(3) : "na";
      const lngKey = hasCoords ? Number(station.longitude).toFixed(3) : "na";
      const key = hasCoords
        ? `${normalizedName}|${latKey}|${lngKey}`
        : station.ocm_id
          ? `ocm-${station.ocm_id}`
          : `${normalizedName}|${normalizeText(station.town)}|${normalizeText(station.state)}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredStations]);

  if (!userLocation) return <p>Loading map...</p>;

  const routePanelTop = isMobile ? 64 : 10;
  const controlsToggleTop = isMobile
    ? routePanelTop + (showRoutePlanner ? routePanelHeight + 8 : 0)
    : 10;
  const controlsPanelTop = isMobile ? controlsToggleTop + 36 : 54;

  return (
    <>
      <button
        onClick={() => setShowMapActions((prev) => !prev)}
        style={{
          position: "absolute",
          top: isMobile ? "10px" : "10px",
          left: "10px",
          zIndex: 1122,
          padding: isMobile ? "8px 12px" : "7px 11px",
          borderRadius: 999,
          border: "1px solid #d1d5db",
          background: "rgba(255,255,255,0.95)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          fontSize: isMobile ? "12px" : "11px",
          fontWeight: 700,
          cursor: "pointer",
          color: "#111827",
        }}
      >
        {showMapActions ? "Close Actions" : "Map Actions"}
      </button>

      {showMapActions && (
        <div
          style={{
            position: "absolute",
            top: isMobile ? "48px" : "44px",
            left: "10px",
            zIndex: 1122,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "rgba(255,255,255,0.96)",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(0,0,0,0.16)",
            padding: 8,
            width: isMobile ? "min(220px, calc(100vw - 20px))" : 200,
          }}
        >
          <button
            onClick={() => {
              setShowNearbyPanel((prev) => !prev);
              setShowMapActions(false);
            }}
            style={{
              padding: isMobile ? "8px 10px" : "8px 11px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontSize: isMobile ? 13 : 12,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              color: "#111827",
            }}
          >
            {showNearbyPanel ? "Hide Nearby List" : "Show Nearby List"}
          </button>

          <button
            onClick={() => {
              setShowRoutePlanner((prev) => !prev);
              setShowMapActions(false);
            }}
            style={{
              padding: isMobile ? "8px 10px" : "8px 11px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontSize: isMobile ? 13 : 12,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              color: "#111827",
            }}
          >
            {showRoutePlanner ? "Hide Route" : "Find Route"}
          </button>
        </div>
      )}

      <button
        onClick={() => setShowControlsPanel((prev) => !prev)}
        style={{
          position: "absolute",
          top: isMobile ? `${controlsToggleTop}px` : "10px",
          left: isMobile ? "10px" : "168px",
          right: isMobile ? "auto" : "auto",
          zIndex: 1121,
          padding: isMobile ? "6px 10px" : "7px 11px",
          borderRadius: 999,
          border: "1px solid #d1d5db",
          background: "rgba(255,255,255,0.95)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          fontSize: isMobile ? "12px" : "11px",
          fontWeight: 700,
          cursor: "pointer",
          color: "#111827",
        }}
      >
        {showControlsPanel ? "Hide Controls" : "Show Controls"}
      </button>

      <div style={{
        padding: "10px",
        display: showControlsPanel ? "flex" : "none",
        flexWrap: "wrap",
        gap: "8px",
        zIndex: 1000,
        position: "absolute",
        top: `${controlsPanelTop}px`,
        left: isMobile ? "auto" : "10px",
        right: isMobile ? "10px" : "auto",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        borderRadius: "8px",
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
        width: isMobile ? "min(360px, calc(100vw - 20px))" : "min(880px, calc(100vw - 20px))",
      }}>
        <div style={{
          display: "flex",
          gap: 8,
          width: "100%",
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}>
          <input
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchLocationChargers();
              }
            }}
            placeholder="Search location (e.g. Connaught Place, Delhi)"
            style={{
              flex: 1,
              minWidth: isMobile ? "100%" : 260,
              padding: isMobile ? "7px 10px" : "8px 12px",
              fontSize: isMobile ? "12px" : "14px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              background: "#fff",
            }}
          />
          <button
            onClick={searchLocationChargers}
            disabled={isSearchingLocation}
            style={{
              padding: isMobile ? "7px 10px" : "8px 12px",
              fontSize: isMobile ? "12px" : "14px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              background: isSearchingLocation ? "#e5e7eb" : "#fff",
              cursor: isSearchingLocation ? "not-allowed" : "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap",
              width: isMobile ? "100%" : "auto",
            }}
          >
            {isSearchingLocation ? "Searching..." : "🔎 Search Location"}
          </button>
        </div>
        <div style={{
          display: "flex",
          gap: 8,
          width: "100%",
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}>
          <select
            value={searchRadiusKm}
            onChange={(e) => setSearchRadiusKm(e.target.value)}
            style={{
              padding: isMobile ? "7px 10px" : "8px 12px",
              fontSize: isMobile ? "12px" : "14px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              background: "#fff",
              minWidth: isMobile ? "calc(50% - 4px)" : 170,
            }}
          >
            <option value="10">Radius: 10 km</option>
            <option value="25">Radius: 25 km</option>
            <option value="50">Radius: 50 km</option>
            <option value="100">Radius: 100 km</option>
          </select>
          <button
            onClick={searchCurrentMapArea}
            disabled={isSearchingLocation}
            style={{
              padding: isMobile ? "7px 10px" : "8px 12px",
              fontSize: isMobile ? "12px" : "14px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              background: isSearchingLocation ? "#e5e7eb" : "#fff",
              cursor: isSearchingLocation ? "not-allowed" : "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap",
              width: isMobile ? "calc(50% - 4px)" : "auto",
            }}
          >
            🗺️ Search This Map Area
          </button>
        </div>
        <div style={{
          display: "flex",
          gap: 8,
          width: "100%",
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}>
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              const [latRaw, lngRaw, label] = value.split("|");
              const lat = Number(latRaw);
              const lng = Number(lngRaw);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
              setLocationQuery(label || "");
              fetchChargersAt(lat, lng, 12).catch((err) => {
                console.error("Recent search load error:", err);
                alert("Failed to load chargers for selected recent search.");
              });
            }}
            style={{
              padding: isMobile ? "7px 10px" : "8px 12px",
              fontSize: isMobile ? "12px" : "14px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              background: "#fff",
              minWidth: isMobile ? "100%" : 260,
              flex: 1,
            }}
          >
            <option value="">Recent location searches</option>
            {recentLocationSearches.map((item) => (
              <option
                key={`${item.label}-${item.lat}-${item.lng}`}
                value={`${item.lat}|${item.lng}|${item.label}`}
              >
                {item.label}
              </option>
            ))}
          </select>
          {recentLocationSearches.length > 0 ? (
            <button
              onClick={() => {
                setRecentLocationSearches([]);
                try {
                  localStorage.removeItem("evassist.recentLocationSearches");
                } catch {
                  // Ignore local storage issues and keep in-memory state.
                }
              }}
              style={{
                padding: isMobile ? "7px 10px" : "8px 12px",
                fontSize: isMobile ? "12px" : "14px",
                borderRadius: "6px",
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
                width: isMobile ? "100%" : "auto",
              }}
            >
              Clear Recent
            </button>
          ) : null}
        </div>
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
        <select
          value={plugFilter}
          onChange={(e) => setPlugFilter(e.target.value)}
          style={{
            padding: isMobile ? "7px 10px" : "8px 12px",
            fontSize: isMobile ? "12px" : "14px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            background: "#fff",
            minWidth: isMobile ? "calc(50% - 4px)" : "150px",
          }}
        >
          <option value="any">Any plugs</option>
          <option value="dc">DC</option>
          <option value="ac">AC</option>
          <option value="fast">Fast (50kW+)</option>
        </select>

        <div style={{ width: "100%", fontSize: 12, color: "#4b5563", fontWeight: 600 }}>
          Nearby chargers shown: {uniqueStations.length} (within {searchRadiusKm}km of selected location)
        </div>
      </div>
      {showRoutePlanner && (
        <RoutePlanner
          setStations={setStations}
          setRoute={setRoute}
          isMobile={isMobile}
          onHeightChange={setRoutePanelHeight}
        />
      )}

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

        <MapUpdater userLocation={userLocation} setStations={setStations} mapRef={mapRef} radiusKm={Number(searchRadiusKm || 50)} />
        <LocateMe userLocation={userLocation} setUserLocation={setUserLocation} setStations={setStations} isMobile={isMobile} radiusKm={Number(searchRadiusKm || 50)} />
        <ZoomControl position={isMobile ? "bottomright" : "bottomleft"} />

        <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
          <Popup>You are here</Popup>
        </Marker>
        {route.length > 0 && (
          <Polyline positions={route} pathOptions={{ color: "blue", weight: 5 }} />
        )}
        {uniqueStations.map((station) => (
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
                {station.distance_km ? <>📏 Distance: <b>{Number(station.distance_km).toFixed(1)} km</b><br /></> : null}
                {station.rating ? <>⭐ Rating: <b>{Number(station.rating).toFixed(1)}</b>{station.review_count ? ` (${station.review_count})` : ""}<br /></> : <>⭐ Rating: N/A<br /></>}
                {station.reliability_score ? <>🛡️ Reliability: <b>{station.reliability_score}/100</b><br /></> : null}
                {station.status_confidence ? <>📶 Data confidence: <b>{station.data_confidence_label || "medium"} ({station.status_confidence}/100)</b><br /></> : null}
                {typeof station.is_operational === "boolean" ? (
                  <>🟢 Status: <b>{station.is_operational ? "Open now" : "May be closed"}</b><br /></>
                ) : station.status_text ? (
                  <>🟢 Status: <b>{station.status_text}</b><br /></>
                ) : null}
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
                      <button
                        onClick={() => reportIssue(station)}
                        disabled={reportingIssueId === station.id}
                        style={{ padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "none", background: "#f59e0b", color: "#111827", cursor: "pointer", fontWeight: 700, opacity: reportingIssueId === station.id ? 0.7 : 1 }}
                      >
                        {reportingIssueId === station.id ? "Reporting..." : "⚠️ Report"}
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

      {showNearbyPanel && (
        <div style={{
          position: "absolute",
          left: isMobile ? 10 : "auto",
          right: 10,
          bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : 12,
          width: isMobile ? "calc(100vw - 20px)" : "min(460px, 42vw)",
          maxHeight: isMobile ? "42vh" : "52vh",
          overflowY: "auto",
          zIndex: 1050,
          background: "rgba(255,255,255,0.96)",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          boxShadow: "0 10px 26px rgba(0,0,0,0.16)",
          padding: 12,
          backdropFilter: "blur(2px)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: isMobile ? 18 : 16 }}>Nearby EV charging stations</div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{uniqueStations.length} results</div>
          </div>

          {uniqueStations.length === 0 ? (
            <div style={{ fontSize: 13, color: "#6b7280", padding: "10px 4px" }}>
              No chargers match your filters within {searchRadiusKm}km.
            </div>
          ) : (
            uniqueStations.slice(0, 20).map((station) => (
              <div key={`card-${station.id}`} style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: 10,
                marginBottom: 8,
                background: "#fff",
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 4 }}>{station.name}</div>
                <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 6 }}>
                  {(station.town || station.state) ? `${station.town || ""}${station.town && station.state ? ", " : ""}${station.state || ""}` : (station.address || "Address unavailable")}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#1f2937", fontWeight: 600 }}>
                  <span>⭐ {station.rating ? Number(station.rating).toFixed(1) : "N/A"}{station.review_count ? ` (${station.review_count})` : ""}</span>
                  <span>🛡️ {station.reliability_score ? `${station.reliability_score}/100` : "N/A"}</span>
                  <span>📏 {station.distance_km ? `${Number(station.distance_km).toFixed(1)} km` : "-"}</span>
                  <span>⚡ {getPowerLabel(station)}</span>
                  <span>{station.is_operational === true ? "🟢 Open now" : station.is_operational === false ? "🔴 Closed/Unknown" : "⚪ Status N/A"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
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