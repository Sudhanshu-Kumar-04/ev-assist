import React, { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import MapView from "./components/MapView";
import AuthModal from "./components/AuthModal";
import UserProfile from "./components/UserProfile";
import AdminDashboard from "./pages/AdminDashboard";

function AppInner() {
  const { user, logout, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const authBarStyle = {
    position: "absolute",
    top: 10,
    right: 10,
    left: "auto",
    zIndex: 3000,
    display: "flex",
    gap: isMobile ? 4 : 6,
    alignItems: "center",
    flexWrap: "nowrap",
    justifyContent: "flex-end",
    maxWidth: "calc(100vw - 20px)",
    background: "rgba(255,255,255,0.9)",
    borderRadius: 10,
    padding: isMobile ? "4px" : "4px 6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
  };

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;

  return (
    <>
      {/* Auth bar — top right */}
      <div style={authBarStyle}>
        {user ? (
          <>
            <span
              onClick={() => setShowProfile(true)}
              style={{
                background: "#fff", padding: isMobile ? "6px 8px" : "6px 12px", borderRadius: 8, fontSize: isMobile ? 12 : 13,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)", cursor: "pointer"
              }}
              title="Open profile"
            >
              {isMobile ? "👤 Profile" : `👤 ${user.name}`}
            </span>
            {user?.role === "admin" && (
              <button onClick={() => setShowAdmin(true)}
                style={{ padding: isMobile ? "6px 8px" : "6px 12px", borderRadius: 8, background: "#1e293b", color: "#fff", border: "none", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
                {isMobile ? "⚙️" : "⚙️ Admin"}
              </button>
            )}
            <button onClick={logout} style={{ padding: isMobile ? "6px 8px" : "6px 12px", borderRadius: 8, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
              {isMobile ? "⎋" : "Sign out"}
            </button>
          </>
        ) : (
          <button onClick={() => setShowAuth(true)} style={{ padding: "6px 14px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Sign in
          </button>
        )}
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
      {showProfile && <UserProfile onClose={() => setShowProfile(false)} />}
      <MapView />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}