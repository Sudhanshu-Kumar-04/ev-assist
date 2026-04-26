import React, { useState, useEffect, useMemo, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer
} from "recharts";

const API = "/admin";
const STATUS_COLORS = {
  confirmed: "#10b981", pending: "#f59e0b",
  cancelled: "#ef4444", completed: "#6366f1"
};
const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6366f1"];

export default function AdminDashboard({ onClose }) {
  const { token, user } = useAuth();
  const [tab, setTab] = useState("overview");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  if (user?.role !== "admin") {
    return (
      <div style={s.overlay}>
        <div style={{ ...s.panel, alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 48 }}>🚫</p>
          <p style={{ fontWeight: 600 }}>Admin access only</p>
          <button style={s.btn} onClick={onClose}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.overlay}>
      <div style={s.panel}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.title}>⚡ EV Assist Admin</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={s.adminBadge}>Admin</span>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {["overview", "chargers", "reservations", "users", "issues"].map(t => (
            <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => setTab(t)}>
              {t === "overview" ? "📊 Overview" :
                t === "chargers" ? "⚡ Chargers" :
                  t === "reservations" ? "📅 Reservations" :
                    t === "users" ? "👥 Users" : "🚨 Issues"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={s.content}>
          {tab === "overview" && <OverviewTab headers={headers} />}
          {tab === "chargers" && <ChargersTab headers={headers} />}
          {tab === "reservations" && <ReservationsTab headers={headers} />}
          {tab === "users" && <UsersTab headers={headers} />}
          {tab === "issues" && <IssuesTab headers={headers} />}
        </div>
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────
function OverviewTab({ headers }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get(`${API}/stats`, { headers }).then(r => setStats(r.data)).catch(console.error);
  }, [headers]);

  if (!stats) return <p style={s.loading}>Loading stats...</p>;

  const pieData = stats.reservationsByStatus.map(r => ({
    name: r.status, value: parseInt(r.count)
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Stat cards */}
      <div style={s.statGrid}>
        <StatCard icon="⚡" label="Total Chargers" value={stats.totalChargers} color="#2563eb" />
        <StatCard icon="👥" label="Total Users" value={stats.totalUsers} color="#10b981" />
        <StatCard icon="📅" label="All Bookings" value={stats.totalReservations} color="#8b5cf6" />
        <StatCard icon="🕐" label="Today's Bookings" value={stats.todayReservations} color="#f59e0b" />
        <StatCard icon="🚨" label="Open Issues" value={stats.openIssues || 0} color="#ef4444" />
        <StatCard icon="⚠️" label="Critical Open" value={stats.criticalOpenIssues || 0} color="#dc2626" />
        <StatCard icon="✅" label="Resolved Issues" value={stats.resolvedIssues || 0} color="#059669" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Daily bookings bar chart */}
        <div style={s.chartBox}>
          <h4 style={s.chartTitle}>Bookings — Last 7 Days</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.dailyBookings}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                tickFormatter={d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Reservation status pie */}
        <div style={s.chartBox}>
          <h4 style={s.chartTitle}>Reservations by Status</h4>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={60}
                  dataKey="value" label={({ name, value }) => `${name}: ${value}`}
                  labelLine={false} fontSize={11}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <p style={s.empty}>No reservation data yet</p>}
        </div>
      </div>

      {/* Top chargers */}
      <div style={s.chartBox}>
        <h4 style={s.chartTitle}>Top 5 Most Booked Chargers</h4>
        {stats.topChargers.length > 0 ? (
          <table style={s.table}>
            <thead>
              <tr style={s.theadRow}>
                <th style={s.th}>Name</th>
                <th style={s.th}>Address</th>
                <th style={s.th}>Power</th>
                <th style={s.th}>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {stats.topChargers.map((c, i) => (
                <tr key={i} style={s.tbodyRow}>
                  <td style={s.td}>{c.name || "—"}</td>
                  <td style={s.td}>{c.address || "—"}</td>
                  <td style={s.td}>{c.power_kw || "N/A"} kW</td>
                  <td style={s.td}><strong>{c.booking_count}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={s.empty}>No booking data yet</p>}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{ ...s.statCard, borderTop: `4px solid ${color}` }}>
      <span style={{ fontSize: 28 }}>{icon}</span>
      <div>
        <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color }}>{value}</p>
        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{label}</p>
      </div>
    </div>
  );
}

// ── Chargers Tab ──────────────────────────────────────────
function ChargersTab({ headers }) {
  const [chargers, setChargers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingCharger, setEditingCharger] = useState(null);
  const LIMIT = 15;

  const fetchChargers = useCallback(() => {
    axios.get(`${API}/chargers?page=${page}&limit=${LIMIT}&search=${search}`, { headers })
      .then(r => { setChargers(r.data.chargers); setTotal(r.data.total); })
      .catch(console.error);
  }, [headers, page, search]);

  useEffect(() => { fetchChargers(); }, [fetchChargers]);

  const deleteCharger = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This will also remove all its reservations.`)) return;
    try {
      await axios.delete(`${API}/chargers/${id}`, { headers });
      fetchChargers();
    } catch (err) {
      alert(err.response?.data?.error || "Delete failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input style={{ ...s.searchInput, flex: 1 }} placeholder="🔍 Search chargers..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <button style={s.btn} onClick={() => { setEditingCharger(null); setShowForm(true); }}>
          + Add Charger
        </button>
      </div>

      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{total} chargers total</p>

      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <th style={s.th}>ID</th>
            <th style={s.th}>Name</th>
            <th style={s.th}>Address</th>
            <th style={s.th}>Power</th>
            <th style={s.th}>Type</th>
            <th style={s.th}>Ports</th>
            <th style={s.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {chargers.map(c => (
            <tr key={c.id} style={s.tbodyRow}>
              <td style={s.td}>{c.id}</td>
              <td style={s.td}>{c.name || "—"}</td>
              <td style={{ ...s.td, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.address || "—"}</td>
              <td style={s.td}>{c.power_kw || "—"} kW</td>
              <td style={s.td}>{c.connection_type || "—"}</td>
              <td style={s.td}>{c.quantity}</td>
              <td style={s.td}>
                <button style={s.editBtn} onClick={() => { setEditingCharger(c); setShowForm(true); }}>Edit</button>
                <button style={s.deleteBtn} onClick={() => deleteCharger(c.id, c.name)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <button style={s.pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
        <span style={{ fontSize: 13 }}>Page {page} of {Math.ceil(total / LIMIT)}</span>
        <button style={s.pageBtn} disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>

      {showForm && (
        <ChargerForm
          headers={headers}
          charger={editingCharger}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchChargers(); }}
        />
      )}
    </div>
  );
}

function ChargerForm({ headers, charger, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: charger?.name || "",
    address: charger?.address || "",
    power_kw: charger?.power_kw || "",
    connection_type: charger?.connection_type || "",
    current_type: charger?.current_type || "",
    quantity: charger?.quantity || 1,
    latitude: charger?.latitude || "",
    longitude: charger?.longitude || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = e => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    setLoading(true);
    setError("");
    try {
      if (charger) {
        await axios.put(`${API}/chargers/${charger.id}`, form, { headers });
      } else {
        await axios.post(`${API}/chargers`, form, { headers });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.formOverlay}>
      <div style={s.formBox}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          {charger ? "Edit Charger" : "Add New Charger"}
        </h3>
        {[
          ["name", "Station Name *"],
          ["address", "Address"],
          ["power_kw", "Power (kW)"],
          ["connection_type", "Connection Type"],
          ["current_type", "Current Type"],
          ["quantity", "Number of Ports"],
          ["latitude", "Latitude *"],
          ["longitude", "Longitude *"],
        ].map(([field, label]) => (
          <div key={field} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{label}</label>
            <input style={s.formInput} name={field} value={form[field]}
              onChange={handle} placeholder={label} />
          </div>
        ))}
        {error && <p style={{ color: "#dc2626", fontSize: 12, margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button style={s.btn} onClick={submit} disabled={loading}>
            {loading ? "Saving..." : charger ? "Update" : "Add Charger"}
          </button>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Reservations Tab ──────────────────────────────────────
function ReservationsTab({ headers }) {
  const [reservations, setReservations] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    axios.get(`${API}/reservations?page=${page}&limit=15&status=${statusFilter}`, { headers })
      .then(r => setReservations(r.data))
      .catch(console.error);
  }, [headers, page, statusFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["", "confirmed", "cancelled", "completed"].map(st => (
          <button key={st}
            style={{ ...s.filterBtn, ...(statusFilter === st ? s.filterBtnActive : {}) }}
            onClick={() => { setStatusFilter(st); setPage(1); }}>
            {st === "" ? "All" : st.charAt(0).toUpperCase() + st.slice(1)}
          </button>
        ))}
      </div>

      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <th style={s.th}>ID</th>
            <th style={s.th}>User</th>
            <th style={s.th}>Charger</th>
            <th style={s.th}>Date</th>
            <th style={s.th}>Time</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Vehicle</th>
          </tr>
        </thead>
        <tbody>
          {reservations.length === 0 ? (
            <tr><td colSpan={7} style={{ textAlign: "center", padding: 20, color: "#9ca3af" }}>No reservations found</td></tr>
          ) : reservations.map(r => (
            <tr key={r.id} style={s.tbodyRow}>
              <td style={s.td}>{r.id}</td>
              <td style={s.td}>
                <div style={{ fontWeight: 500, fontSize: 12 }}>{r.user_name}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.user_email}</div>
              </td>
              <td style={{ ...s.td, fontSize: 12 }}>{r.charger_name}</td>
              <td style={s.td}>{new Date(r.reservation_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
              <td style={s.td}>{r.start_time?.slice(0, 5)} – {r.end_time?.slice(0, 5)}</td>
              <td style={s.td}>
                <span style={{
                  padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                  background: STATUS_COLORS[r.status] + "22",
                  color: STATUS_COLORS[r.status]
                }}>
                  {r.status}
                </span>
              </td>
              <td style={s.td}>{r.vehicle_model || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button style={s.pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
        <span style={{ fontSize: 13, padding: "4px 8px" }}>Page {page}</span>
        <button style={s.pageBtn} disabled={reservations.length < 15} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────
function UsersTab({ headers }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    axios.get(`${API}/users`, { headers }).then(r => setUsers(r.data)).catch(console.error);
  }, [headers]);

  return (
    <div>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>{users.length} registered users</p>
      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <th style={s.th}>Name</th>
            <th style={s.th}>Email</th>
            <th style={s.th}>Vehicle</th>
            <th style={s.th}>Battery</th>
            <th style={s.th}>Range</th>
            <th style={s.th}>Bookings</th>
            <th style={s.th}>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.filter(u => u.role !== "admin").map(u => (
            <tr key={u.id} style={s.tbodyRow}>
              <td style={s.td}>{u.name}</td>
              <td style={{ ...s.td, fontSize: 11 }}>{u.email}</td>
              <td style={s.td}>{u.vehicle_model || "—"}</td>
              <td style={s.td}>{u.battery_capacity_kwh ? `${u.battery_capacity_kwh} kWh` : "—"}</td>
              <td style={s.td}>{u.range_km ? `${u.range_km} km` : "—"}</td>
              <td style={s.td}><strong>{u.reservation_count}</strong></td>
              <td style={s.td}>{new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuesTab({ headers }) {
  const [issues, setIssues] = useState([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [updatingId, setUpdatingId] = useState(null);
  const LIMIT = 15;

  const fetchIssues = useCallback(() => {
    axios.get(`${API}/issues?page=${page}&limit=${LIMIT}&status=${status}&issueType=${type}`, { headers })
      .then((r) => {
        setIssues(r.data.issues || []);
        setTotal(r.data.total || 0);
      })
      .catch(console.error);
  }, [headers, page, status, type]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const updateStatus = async (issueId, nextStatus) => {
    setUpdatingId(issueId);
    try {
      await axios.patch(`${API}/issues/${issueId}`, { status: nextStatus }, { headers });
      fetchIssues();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update issue");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          style={s.searchInput}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In review</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          style={s.searchInput}
          value={type}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
        >
          <option value="">All issue types</option>
          <option value="offline">Offline</option>
          <option value="connector_broken">Connector broken</option>
          <option value="payment_failed">Payment failed</option>
          <option value="blocked">Blocked</option>
          <option value="slow_charging">Slow charging</option>
          <option value="other">Other</option>
        </select>
      </div>

      <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{total} issue reports</p>

      <table style={s.table}>
        <thead>
          <tr style={s.theadRow}>
            <th style={s.th}>When</th>
            <th style={s.th}>Station</th>
            <th style={s.th}>Issue</th>
            <th style={s.th}>Reporter</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {issues.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: "center", padding: 20, color: "#9ca3af" }}>No issue reports found</td></tr>
          ) : issues.map((issue) => (
            <tr key={issue.id} style={s.tbodyRow}>
              <td style={s.td}>{new Date(issue.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td style={s.td}>
                <div style={{ fontWeight: 600 }}>{issue.charger_name || "—"}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{issue.charger_address || "—"}</div>
              </td>
              <td style={s.td}>
                <div style={{ fontWeight: 600 }}>{issue.issue_type}</div>
                <div style={{ fontSize: 11, color: "#6b7280", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{issue.note || "No note"}</div>
              </td>
              <td style={s.td}>{issue.reported_by_name || issue.reported_by_email || "Anonymous"}</td>
              <td style={s.td}>{issue.status}</td>
              <td style={s.td}>
                <select
                  style={s.searchInput}
                  value={issue.status}
                  disabled={updatingId === issue.id}
                  onChange={(e) => updateStatus(issue.id, e.target.value)}
                >
                  <option value="open">open</option>
                  <option value="in_review">in_review</option>
                  <option value="resolved">resolved</option>
                  <option value="dismissed">dismissed</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button style={s.pageBtn} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        <span style={{ fontSize: 13, padding: "4px 8px" }}>Page {page} of {Math.max(1, Math.ceil(total / LIMIT))}</span>
        <button style={s.pageBtn} disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────
const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000 },
  panel: { background: "#f9fafb", borderRadius: 16, width: "95vw", maxWidth: 1100, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", background: "#1e293b", borderRadius: "16px 16px 0 0" },
  title: { margin: 0, color: "#fff", fontSize: 18, fontWeight: 700 },
  adminBadge: { background: "#3b82f6", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20 },
  closeBtn: { background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" },
  tabs: { display: "flex", background: "#fff", borderBottom: "1px solid #e5e7eb" },
  tab: { padding: "12px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#6b7280", borderBottom: "3px solid transparent" },
  tabActive: { color: "#2563eb", borderBottom: "3px solid #2563eb" },
  content: { flex: 1, overflowY: "auto", padding: 20 },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 },
  statCard: { background: "#fff", borderRadius: 10, padding: "16px", display: "flex", gap: 12, alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  chartBox: { background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  chartTitle: { margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "#374151" },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", fontSize: 13 },
  theadRow: { background: "#f1f5f9" },
  tbodyRow: { borderTop: "1px solid #f1f5f9", cursor: "default" },
  th: { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "#475569" },
  td: { padding: "10px 12px", color: "#374151" },
  btn: { padding: "8px 16px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  editBtn: { padding: "4px 10px", borderRadius: 6, background: "#dbeafe", color: "#1d4ed8", border: "none", fontSize: 12, cursor: "pointer", marginRight: 4, fontWeight: 500 },
  deleteBtn: { padding: "4px 10px", borderRadius: 6, background: "#fee2e2", color: "#dc2626", border: "none", fontSize: 12, cursor: "pointer", fontWeight: 500 },
  cancelBtn: { padding: "8px 16px", borderRadius: 8, background: "#f1f5f9", color: "#374151", border: "none", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  pageBtn: { padding: "6px 14px", borderRadius: 7, background: "#f1f5f9", color: "#374151", border: "none", fontSize: 13, cursor: "pointer", fontWeight: 500 },
  filterBtn: { padding: "6px 14px", borderRadius: 20, background: "#f1f5f9", color: "#6b7280", border: "none", fontSize: 12, cursor: "pointer", fontWeight: 500 },
  filterBtnActive: { background: "#dbeafe", color: "#1d4ed8" },
  searchInput: { padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, outline: "none" },
  formOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000 },
  formBox: { background: "#fff", borderRadius: 12, padding: 24, width: 400, display: "flex", flexDirection: "column", gap: 10, maxHeight: "90vh", overflowY: "auto" },
  formInput: { padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: 13, outline: "none" },
  loading: { color: "#9ca3af", textAlign: "center", padding: 40 },
  empty: { color: "#9ca3af", textAlign: "center", padding: 20, fontSize: 13 },
};