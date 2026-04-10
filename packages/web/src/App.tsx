import { useEffect, useRef, useState } from "react";
import { Device, Call } from "@twilio/voice-sdk";

type CallStatus = "idle" | "connecting" | "ringing" | "active" | "ended" | "error";
type Tab = "call" | "orders" | "reservations";

interface Order {
  id: string;
  status: string;
  total: string;
  notes: string | null;
  customerName: string | null;
  callerPhone: string | null;
  createdAt: string;
  items?: { name: string; quantity: number; unitPrice: string }[];
}

interface Reservation {
  id: string;
  guestName: string;
  guestPhone: string;
  partySize: number;
  date: string;
  timeSlot: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  @keyframes pulse-ring { 0%{transform:scale(1);opacity:.4} 100%{transform:scale(1.8);opacity:0} }
  @keyframes pulse-ring2 { 0%{transform:scale(1);opacity:.25} 100%{transform:scale(2.2);opacity:0} }
  @keyframes glow { 0%,100%{box-shadow:0 0 20px rgba(16,185,129,0.3)} 50%{box-shadow:0 0 40px rgba(16,185,129,0.6)} }
  @keyframes wave { 0%{height:4px} 50%{height:28px} 100%{height:4px} }
  @keyframes fade-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
  @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }

  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.12;
    animation: float 8s ease-in-out infinite;
    pointer-events: none;
  }

  .card { animation: fade-in 0.5s ease-out both; }
  .card:hover { border-color: rgba(255,255,255,0.15) !important; background: rgba(255,255,255,0.06) !important; }

  .tab-btn { position: relative; overflow: hidden; }
  .tab-btn::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent);
    transform: translateX(-100%);
    transition: transform 0.3s;
  }
  .tab-btn:hover::after { transform: translateX(100%); }

  .call-btn {
    position: relative;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .call-btn:hover { transform: scale(1.08); }
  .call-btn:active { transform: scale(0.95); }

  .status-dot {
    animation: breathe 2s ease-in-out infinite;
  }
`;

export function App() {
  const [tab, setTab] = useState<Tab>("call");

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0e1a",
      fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      <style>{CSS}</style>

      {/* Animated background orbs */}
      <div className="orb" style={{ width: "500px", height: "500px", background: "#10b981", top: "-150px", right: "-100px", animationDelay: "0s" }} />
      <div className="orb" style={{ width: "400px", height: "400px", background: "#3b82f6", bottom: "-100px", left: "-100px", animationDelay: "3s" }} />
      <div className="orb" style={{ width: "300px", height: "300px", background: "#8b5cf6", top: "40%", left: "60%", animationDelay: "5s" }} />

      {/* Header */}
      <header style={{
        background: "rgba(10,14,26,0.7)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}>
        <img
          src="https://storage.googleapis.com/mhp-media/img/8bf03907-8ab3-49ee-949c-ba1eb8e05b06.png"
          alt="A2B"
          style={{ height: "34px", borderRadius: "8px" }}
        />
        <nav style={{
          display: "flex",
          gap: "2px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "14px",
          padding: "3px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          {(["call", "orders", "reservations"] as Tab[]).map((t) => (
            <button
              key={t}
              className="tab-btn"
              onClick={() => setTab(t)}
              style={{
                padding: "8px 22px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
                fontFamily: "inherit",
                background: tab === t
                  ? "linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.9))"
                  : "transparent",
                color: tab === t ? "#fff" : "rgba(255,255,255,0.45)",
                transition: "all 0.25s ease",
                boxShadow: tab === t ? "0 2px 12px rgba(16,185,129,0.3)" : "none",
              }}
            >
              {t === "call" ? "AI Assist" : t === "orders" ? "Orders" : "Reservations"}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ position: "relative", zIndex: 1 }}>
        {tab === "call" ? <CallPanel /> : tab === "orders" ? <OrdersPanel /> : <ReservationsPanel />}
      </main>
    </div>
  );
}

function CallPanel() {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    deviceRef.current?.destroy();
  }, []);

  async function startCall() {
    setError(""); setStatus("connecting"); setDuration(0);
    try {
      const res = await fetch("/api/token");
      const { token } = await res.json();
      const device = new Device(token, { logLevel: "error" });
      await device.register();
      deviceRef.current = device;
      const call = await device.connect({ params: { To: "+16406008373" } });
      callRef.current = call;
      call.on("ringing", () => setStatus("ringing"));
      call.on("accept", () => {
        setStatus("active");
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      });
      call.on("disconnect", () => {
        setStatus("ended");
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => setStatus("idle"), 3000);
      });
      call.on("error", (err: Error) => {
        setError(err.message); setStatus("error");
        if (timerRef.current) clearInterval(timerRef.current);
      });
    } catch (err: any) {
      setError(err.message || "Failed to connect"); setStatus("error");
    }
  }

  function endCall() {
    callRef.current?.disconnect();
    deviceRef.current?.destroy();
    deviceRef.current = null; callRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus("idle");
  }

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const isBusy = ["connecting", "ringing", "active"].includes(status);
  const isActive = status === "active";

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "calc(100vh - 59px)", padding: "20px",
    }}>
      <div style={{
        background: "rgba(255,255,255,0.02)",
        backdropFilter: "blur(30px)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "32px",
        padding: "48px 40px 40px",
        width: "380px",
        textAlign: "center",
        boxShadow: "0 40px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
        animation: "fade-in 0.6s ease-out",
      }}>

        {/* Active call: waveform */}
        {isActive && (
          <div style={{
            display: "flex", justifyContent: "center", gap: "4px",
            marginBottom: "28px", height: "40px", alignItems: "center",
            animation: "fade-in 0.3s ease-out",
          }}>
            {[...Array(16)].map((_, i) => (
              <div key={i} style={{
                width: "3px",
                borderRadius: "3px",
                background: "linear-gradient(to top, #10b981, #6ee7b7)",
                animation: `wave ${0.8 + Math.random() * 0.6}s ease-in-out ${i * 0.05}s infinite`,
              }} />
            ))}
          </div>
        )}

        {/* Idle state */}
        {!isActive && !isBusy && (
          <div style={{ animation: "fade-in 0.5s ease-out" }}>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px", margin: "0 0 36px", lineHeight: 1.6, letterSpacing: "0.2px" }}>
              Order food, book a table, or ask about our menu
            </p>
          </div>
        )}

        {/* Connecting/ringing state */}
        {(status === "connecting" || status === "ringing") && (
          <div style={{ marginBottom: "20px", animation: "fade-in 0.3s ease-out" }}>
            <div style={{
              width: "12px", height: "12px", borderRadius: "50%",
              border: "2px solid rgba(245,158,11,0.3)",
              borderTopColor: "#f59e0b",
              animation: "spin-slow 0.8s linear infinite",
              margin: "0 auto 12px",
            }} />
          </div>
        )}

        {/* Call button with pulse rings */}
        <div style={{ position: "relative", marginBottom: "28px", display: "flex", justifyContent: "center" }}>
          {/* Pulse rings for active/connecting states */}
          {(isBusy || status === "idle") && (
            <>
              <div style={{
                position: "absolute", width: "100px", height: "100px",
                top: "0", left: "50%", transform: "translateX(-50%)",
                borderRadius: "50%",
                border: `2px solid ${isBusy ? "#ef4444" : "#10b981"}`,
                animation: "pulse-ring 2s ease-out infinite",
                pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", width: "100px", height: "100px",
                top: "0", left: "50%", transform: "translateX(-50%)",
                borderRadius: "50%",
                border: `2px solid ${isBusy ? "#ef4444" : "#10b981"}`,
                animation: "pulse-ring2 2s ease-out 0.5s infinite",
                pointerEvents: "none",
              }} />
            </>
          )}

          <button
            className="call-btn"
            onClick={isBusy ? endCall : startCall}
            style={{
              width: "100px", height: "100px",
              borderRadius: "50%",
              border: "none",
              background: isBusy
                ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              cursor: "pointer",
              fontSize: "38px",
              boxShadow: isBusy
                ? "0 8px 32px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.2)"
                : "0 8px 32px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: isActive ? "glow 2s ease-in-out infinite" : undefined,
              position: "relative",
              zIndex: 1,
            }}
          >
            <span style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }}>
              {isBusy ? "\u{23F9}\u{FE0F}" : "\u{1F4DE}"}
            </span>
          </button>
        </div>

        {/* Status label */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: "8px", marginBottom: "8px",
        }}>
          <div className="status-dot" style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: isBusy ? (isActive ? "#10b981" : "#f59e0b") : status === "error" ? "#ef4444" : "#10b981",
            boxShadow: `0 0 10px ${isBusy ? (isActive ? "#10b981" : "#f59e0b") : "#10b981"}`,
          }} />
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px", fontWeight: 500 }}>
            {status === "idle" ? "Tap to start" : status === "connecting" ? "Connecting..." : status === "ringing" ? "Ringing..." : isActive ? "Listening" : status === "ended" ? "Call ended" : "Error"}
          </span>
        </div>

        {/* Timer */}
        {isActive && (
          <div style={{
            color: "#10b981", fontSize: "36px", fontWeight: 800,
            letterSpacing: "4px", marginTop: "8px",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 0 20px rgba(16,185,129,0.3)",
            animation: "fade-in 0.3s ease-out",
          }}>
            {fmt(duration)}
          </div>
        )}

        {isActive && (
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: "11px", marginTop: "12px", letterSpacing: "0.5px" }}>
            Speak naturally — I can take orders, book tables & answer questions
          </p>
        )}

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
            borderRadius: "12px", padding: "10px 14px", color: "#fca5a5", fontSize: "12px",
            marginTop: "16px", animation: "fade-in 0.3s ease-out",
          }}>
            {error}
          </div>
        )}

        {/* Feature pills */}
        {status === "idle" && (
          <>
            <div style={{
              display: "flex", justifyContent: "center", gap: "8px",
              marginTop: "32px", flexWrap: "wrap",
            }}>
              {[
                { label: "Takeaway Orders", icon: "\u{1F6D2}" },
                { label: "Table Booking", icon: "\u{1F4C5}" },
                { label: "Menu Info", icon: "\u{1F4CB}" },
              ].map((f, i) => (
                <span key={f.label} style={{
                  padding: "7px 14px",
                  borderRadius: "20px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.4)",
                  fontSize: "11px",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  animation: `slide-up 0.4s ease-out ${0.1 + i * 0.1}s both`,
                }}>
                  <span style={{ fontSize: "13px" }}>{f.icon}</span>
                  {f.label}
                </span>
              ))}
            </div>

            {/* Divider */}
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              margin: "28px 0 20px",
              animation: "slide-up 0.4s ease-out 0.5s both",
            }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
              <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", fontWeight: 500, letterSpacing: "1px" }}>OR</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
            </div>

            {/* Call phone number directly */}
            <a
              href="tel:+16406008373"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                padding: "14px 24px",
                borderRadius: "16px",
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.2)",
                color: "#60a5fa",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "inherit",
                textDecoration: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                animation: "slide-up 0.4s ease-out 0.6s both",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(59,130,246,0.15)";
                e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                e.currentTarget.style.borderColor = "rgba(59,130,246,0.2)";
              }}
            >
              <span style={{ fontSize: "18px" }}>{"\u{260E}\u{FE0F}"}</span>
              Call +1 (640) 600-8373
            </a>
            <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", marginTop: "8px", animation: "slide-up 0.4s ease-out 0.7s both" }}>
              Call from your phone — same AI assistant answers
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function OrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const statusColor: Record<string, string> = {
    pending: "#f59e0b", confirmed: "#3b82f6", preparing: "#8b5cf6",
    ready: "#10b981", served: "#6b7280", cancelled: "#ef4444",
  };

  async function load() {
    setLoading(true);
    const res = await fetch("/api/orders");
    setOrders(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  const nextStatus: Record<string, string> = {
    pending: "confirmed", confirmed: "preparing", preparing: "ready", ready: "served",
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", animation: "fade-in 0.4s ease-out" }}>
        <h2 style={{ color: "#fff", margin: 0, fontSize: "18px", fontWeight: 700 }}>Orders</h2>
        <button onClick={load} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.6)", padding: "8px 18px", borderRadius: "10px",
          cursor: "pointer", fontSize: "13px", fontWeight: 500, fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px" }}>
          <div style={{
            width: "24px", height: "24px", borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#10b981",
            animation: "spin-slow 0.7s linear infinite", margin: "0 auto",
          }} />
        </div>
      ) : orders.length === 0 ? (
        <div className="card" style={{
          textAlign: "center", padding: "80px 40px",
          background: "rgba(255,255,255,0.02)", borderRadius: "20px",
          border: "1px dashed rgba(255,255,255,0.08)",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.3 }}>&#x1F6D2;</div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "14px", fontWeight: 500 }}>No orders yet</div>
          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", marginTop: "6px" }}>Orders placed via AI Assist will appear here</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {orders.map((order, i) => (
            <div key={order.id} className="card" style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "16px",
              padding: "16px 20px",
              transition: "all 0.2s",
              animationDelay: `${i * 0.05}s`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "11px", fontFamily: "monospace" }}>#{order.id.slice(-8).toUpperCase()}</span>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px", marginTop: "2px" }}>
                    {order.customerName || "Walk-in"} &mdash; ${parseFloat(order.total || "0").toFixed(2)}
                  </div>
                  <div style={{ color: "rgba(16,185,129,0.5)", fontSize: "11px", marginTop: "3px", fontWeight: 500, letterSpacing: "0.3px" }}>Pay at store</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{
                    background: `${statusColor[order.status]}12`,
                    color: statusColor[order.status],
                    border: `1px solid ${statusColor[order.status]}30`,
                    padding: "4px 12px", borderRadius: "20px", fontSize: "11px",
                    fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
                  }}>
                    {order.status}
                  </span>
                  {nextStatus[order.status] && (
                    <button onClick={() => updateStatus(order.id, nextStatus[order.status])} style={{
                      background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
                      color: "#10b981", padding: "4px 14px", borderRadius: "8px",
                      cursor: "pointer", fontSize: "11px", fontWeight: 600, fontFamily: "inherit",
                      transition: "all 0.2s",
                    }}>
                      {nextStatus[order.status]}
                    </button>
                  )}
                </div>
              </div>
              {order.items && order.items.length > 0 && (
                <div style={{ marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {order.items.map((item: any) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ color: "rgba(255,255,255,0.55)" }}>{item.quantity} x {item.name}</span>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: "rgba(255,255,255,0.18)", fontSize: "11px", marginTop: "10px" }}>
                {new Date(order.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReservationsPanel() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  const statusColor: Record<string, string> = {
    pending: "#f59e0b", confirmed: "#10b981", seated: "#3b82f6",
    completed: "#6b7280", cancelled: "#ef4444", no_show: "#ef4444",
  };

  async function load() {
    setLoading(true);
    const res = await fetch("/api/reservations");
    setReservations(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", animation: "fade-in 0.4s ease-out" }}>
        <h2 style={{ color: "#fff", margin: 0, fontSize: "18px", fontWeight: 700 }}>Reservations</h2>
        <button onClick={load} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.6)", padding: "8px 18px", borderRadius: "10px",
          cursor: "pointer", fontSize: "13px", fontWeight: 500, fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px" }}>
          <div style={{
            width: "24px", height: "24px", borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#10b981",
            animation: "spin-slow 0.7s linear infinite", margin: "0 auto",
          }} />
        </div>
      ) : reservations.length === 0 ? (
        <div className="card" style={{
          textAlign: "center", padding: "80px 40px",
          background: "rgba(255,255,255,0.02)", borderRadius: "20px",
          border: "1px dashed rgba(255,255,255,0.08)",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.3 }}>&#x1F4C5;</div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "14px", fontWeight: 500 }}>No reservations yet</div>
          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", marginTop: "6px" }}>Reservations via AI Assist will appear here</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {reservations.map((r, i) => (
            <div key={r.id} className="card" style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "16px",
              padding: "16px 20px",
              transition: "all 0.2s",
              animationDelay: `${i * 0.05}s`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>{r.guestName}</div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", marginTop: "5px", display: "flex", gap: "12px", alignItems: "center" }}>
                    <span>{r.partySize} guests</span>
                    <span style={{ color: "rgba(255,255,255,0.15)" }}>&middot;</span>
                    <span>{new Date(r.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}</span>
                    <span style={{ color: "rgba(255,255,255,0.15)" }}>&middot;</span>
                    <span>{r.timeSlot}</span>
                  </div>
                  {r.notes && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px", marginTop: "5px", fontStyle: "italic" }}>{r.notes}</div>}
                </div>
                <span style={{
                  background: `${statusColor[r.status] || "#6b7280"}12`,
                  color: statusColor[r.status] || "#6b7280",
                  border: `1px solid ${statusColor[r.status] || "#6b7280"}30`,
                  padding: "4px 12px", borderRadius: "20px", fontSize: "11px",
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  {r.status}
                </span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.15)", fontSize: "11px", marginTop: "12px" }}>
                Booked {new Date(r.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
