import React, { useState } from "react";
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

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>;

  return (
    <>
      {/* Auth bar — top right */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 8, alignItems: "center" }}>
        {user ? (
          <>
            <span
              onClick={() => setShowProfile(true)}
              style={{
                background: "#fff", padding: "6px 12px", borderRadius: 8, fontSize: 13,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)", cursor: "pointer"
              }}>
              👤 {user.name}
            </span>
            {user?.role === "admin" && (
              <button onClick={() => setShowAdmin(true)}
                style={{ padding: "6px 12px", borderRadius: 8, background: "#1e293b", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>
                ⚙️ Admin
              </button>
            )}
            <button onClick={logout} style={{ padding: "6px 12px", borderRadius: 8, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>
              Sign out
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