import { useEffect, useRef, useState } from "react";
import { Device, Call } from "@twilio/voice-sdk";

type CallStatus = "idle" | "connecting" | "ringing" | "active" | "ended" | "error";
type Tab = "call" | "orders";

interface Order {
  id: string;
  status: string;
  total: string;
  notes: string | null;
  callerPhone: string | null;
  createdAt: string;
  items?: { name: string; quantity: number; unitPrice: string }[];
}

export function App() {
  const [tab, setTab] = useState<Tab>("call");

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "rgba(255,255,255,0.05)",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="https://storage.googleapis.com/mhp-media/img/8bf03907-8ab3-49ee-949c-ba1eb8e05b06.png" alt="A2B Logo" style={{ height: "40px", borderRadius: "6px" }} />
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>Voice Ordering System</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["call", "orders"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 20px",
              borderRadius: "20px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              background: tab === t ? "#10b981" : "rgba(255,255,255,0.1)",
              color: tab === t ? "#fff" : "rgba(255,255,255,0.6)",
              transition: "all 0.2s",
            }}>
              {t === "call" ? "📞 Call" : "📋 Orders"}
            </button>
          ))}
        </div>
      </div>

      {tab === "call" ? <CallPanel /> : <OrdersPanel />}
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

  const fmt = (s: number) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
  const isBusy = ["connecting","ringing","active"].includes(status);
  const isActive = status === "active";

  const cfg: Record<CallStatus, { color: string; label: string; pulse: boolean }> = {
    idle:       { color: "#6b7280", label: "Ready to order",   pulse: false },
    connecting: { color: "#f59e0b", label: "Connecting...",    pulse: true  },
    ringing:    { color: "#3b82f6", label: "Ringing...",       pulse: true  },
    active:     { color: "#10b981", label: "Call active",      pulse: false },
    ended:      { color: "#6b7280", label: "Call ended",       pulse: false },
    error:      { color: "#ef4444", label: "Connection error", pulse: false },
  };
  const { color, label, pulse } = cfg[status];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 73px)" }}>
      <div style={{
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "24px",
        padding: "48px 40px",
        width: "340px",
        textAlign: "center",
        boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
      }}>
        <img src="https://storage.googleapis.com/mhp-media/img/8bf03907-8ab3-49ee-949c-ba1eb8e05b06.png" alt="A2B" style={{ height: "60px", borderRadius: "8px", marginBottom: "16px" }} />
        <h2 style={{ color: "#fff", fontSize: "20px", margin: "0 0 4px" }}>A2B Indian Veg Restaurant</h2>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", margin: "0 0 36px" }}>Voice Ordering</p>

        <div style={{ position: "relative", marginBottom: "28px", display: "flex", justifyContent: "center" }}>
          {pulse && <div style={{
            position: "absolute", width: "124px", height: "124px",
            top: "-12px", left: "50%", transform: "translateX(-50%)",
            borderRadius: "50%", background: color, opacity: 0.2,
            animation: "pulse 1.5s infinite",
          }} />}
          <button onClick={isBusy ? endCall : startCall} style={{
            width: "100px", height: "100px", borderRadius: "50%", border: "none",
            background: isBusy ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#10b981,#059669)",
            cursor: "pointer", fontSize: "36px",
            boxShadow: `0 0 30px ${isBusy ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)"}`,
          }}>
            {isBusy ? "📵" : "📞"}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "14px" }}>{label}</span>
        </div>

        {isActive && <div style={{ color: "#10b981", fontSize: "28px", fontWeight: 700, letterSpacing: "2px", marginBottom: "8px" }}>{fmt(duration)}</div>}
        {error && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "10px", color: "#fca5a5", fontSize: "12px", marginTop: "12px" }}>{error}</div>}
        {status === "idle" && <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px", marginTop: "20px", lineHeight: 1.6 }}>Press to call and place your order by speaking</p>}
        {isActive && <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px", marginTop: "8px" }}>Speak your order clearly</p>}
      </div>
      <style>{`@keyframes pulse { 0%,100%{transform:translateX(-50%) scale(1);opacity:.2} 50%{transform:translateX(-50%) scale(1.15);opacity:.1} }`}</style>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ color: "#fff", margin: 0, fontSize: "18px" }}>Orders</h2>
        <button onClick={load} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "8px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color: "rgba(255,255,255,0.5)", textAlign: "center", padding: "40px" }}>Loading...</div>
      ) : orders.length === 0 ? (
        <div style={{ color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "60px", fontSize: "14px" }}>No orders yet. Place a voice order to see it here.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {orders.map((order) => (
            <div key={order.id} style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              padding: "16px 20px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>#{order.id.slice(-8).toUpperCase()}</span>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px", marginTop: "2px" }}>
                    ${parseFloat(order.total || "0").toFixed(2)}
                  </div>
                  {order.callerPhone && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px" }}>{order.callerPhone}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{
                    background: `${statusColor[order.status]}22`,
                    color: statusColor[order.status],
                    border: `1px solid ${statusColor[order.status]}44`,
                    padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: 600,
                  }}>
                    {order.status}
                  </span>
                  {nextStatus[order.status] && (
                    <button onClick={() => updateStatus(order.id, nextStatus[order.status])} style={{
                      background: "#10b981", border: "none", color: "#fff",
                      padding: "4px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                    }}>
                      → {nextStatus[order.status]}
                    </button>
                  )}
                </div>
              </div>
              {order.items && order.items.length > 0 && (
                <div style={{ marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {order.items.map((item: any) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ color: "rgba(255,255,255,0.7)" }}>
                        {item.quantity}× {item.name}
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "8px" }}>
                {new Date(order.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
