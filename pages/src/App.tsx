import { useState, useEffect } from "react";
import { api, saveAuth, getAuth, logout, type UserPublic } from "./api";
import VegaApp from "./VegaApp";

// ─── Auth Styles ──────────────────────────────────────
const AUTH_CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing:border-box; margin:0; padding:0; }
body { background:#090b0f; color:#b8bfd0; font-family:'IBM Plex Mono','JetBrains Mono','Fira Code',monospace; }
::-webkit-scrollbar { width:3px } ::-webkit-scrollbar-track { background:#090b0f } ::-webkit-scrollbar-thumb { background:#1a1f2e; border-radius:2px }

.auth-page { min-height:100vh; display:flex; align-items:center; justify-content:center; background:radial-gradient(ellipse at 50% 0%, #0d1a12 0%, #090b0f 60%); position:relative; overflow:hidden; }
.auth-bg { position:absolute; inset:0; }
.auth-bg::before { content:''; position:absolute; top:20%; left:50%; transform:translateX(-50%); width:600px; height:600px; background:radial-gradient(circle, #00e87a08 0%, transparent 70%); }

.auth-card { position:relative; z-index:1; width:100%; max-width:420px; background:#0d0f16; border:1px solid #1a1f2e; border-radius:8px; padding:40px 36px; }
.auth-logo { text-align:center; margin-bottom:32px; }
.auth-logo span { color:#00e87a; font-size:28px; font-weight:700; letter-spacing:4px; font-family:'Inter','Segoe UI',sans-serif; }
.auth-logo p { color:#3a4055; font-size:10px; letter-spacing:2px; text-transform:uppercase; margin-top:6px; }

.auth-tabs { display:flex; margin-bottom:28px; border-bottom:1px solid #1a1f2e; }
.auth-tab { flex:1; padding:10px; text-align:center; background:none; border:none; border-bottom:2px solid transparent; color:#3a4055; font-size:10px; letter-spacing:2px; text-transform:uppercase; font-family:inherit; cursor:pointer; transition:all .2s; }
.auth-tab.active { color:#00e87a; border-bottom-color:#00e87a; }

.auth-field { margin-bottom:16px; }
.auth-field label { display:block; color:#3a4055; font-size:8px; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px; }
.auth-field input { width:100%; padding:12px 14px; background:#111420; border:1px solid #1a1f2e; border-radius:4px; color:#b8bfd0; font-size:13px; font-family:inherit; outline:none; transition:border-color .2s; }
.auth-field input:focus { border-color:#00e87a; }
.auth-field input::placeholder { color:#2a2f40; }

.auth-btn { width:100%; padding:14px; background:#00e87a18; border:2px solid #00e87a; border-radius:4px; color:#00e87a; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; font-family:inherit; cursor:pointer; transition:all .2s; margin-top:8px; }
.auth-btn:hover { background:#00e87a28; }
.auth-btn:disabled { opacity:.4; cursor:not-allowed; }

.auth-error { background:#ff3d5a12; border:1px solid #ff3d5a30; border-radius:4px; color:#ff3d5a; font-size:11px; padding:10px 14px; margin-bottom:16px; text-align:center; }
.auth-success { background:#00e87a12; border:1px solid #00e87a30; border-radius:4px; color:#00e87a; font-size:11px; padding:10px 14px; margin-bottom:16px; text-align:center; }

.auth-footer { text-align:center; margin-top:20px; color:#3a4055; font-size:10px; }
.auth-footer a { color:#5b9ef7; cursor:pointer; text-decoration:none; }

.user-bar { position:fixed; top:0; right:0; z-index:9999; padding:5px 12px; display:flex; align-items:center; gap:8px; background:#0d0f16ee; border:1px solid #1a1f2e; border-radius:0 0 0 6px; font-size:10px; }
.user-bar span { color:#3a4055; }
.user-bar .uname { color:#00e87a; font-weight:600; }
.user-bar button { background:none; border:1px solid #3a4055; border-radius:3px; color:#3a4055; padding:3px 8px; font-family:inherit; font-size:9px; cursor:pointer; letter-spacing:1px; }
.user-bar button:hover { border-color:#ff3d5a; color:#ff3d5a; }
`;

// ─── Login/Register Screen ────────────────────────────
function AuthScreen({ onAuth }: { onAuth: (user: UserPublic, token: string) => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "register") {
        const result = await api.register(username, email, password);
        saveAuth(result.user, result.token);
        onAuth(result.user, result.token);
      } else {
        const result = await api.login(username, password);
        saveAuth(result.user, result.token);
        onAuth(result.user, result.token);
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{AUTH_CSS}</style>
      <div className="auth-page">
        <div className="auth-bg" />
        <div className="auth-card">
          <div className="auth-logo">
            <span>VEGA</span>
            <p>AI-Powered Trading Intelligence</p>
          </div>

          <div className="auth-tabs">
            <button className={`auth-tab ${tab === "login" ? "active" : ""}`} onClick={() => { setTab("login"); setError(""); }}>Sign In</button>
            <button className={`auth-tab ${tab === "register" ? "active" : ""}`} onClick={() => { setTab("register"); setError(""); }}>Create Account</button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label>Username</label>
              <input type="text" placeholder="Enter username" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
            </div>

            {tab === "register" && (
              <div className="auth-field">
                <label>Email</label>
                <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            )}

            <div className="auth-field">
              <label>Password</label>
              <input type="password" placeholder="Enter password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? "Processing..." : tab === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="auth-footer">
            {tab === "login" ? (
              <>No account? <a onClick={() => setTab("register")}>Create one</a></>
            ) : (
              <>Already have an account? <a onClick={() => setTab("login")}>Sign in</a></>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main App ─────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    if (auth?.token) {
      api.me()
        .then(u => setUser(u))
        .catch(() => { localStorage.removeItem("stock-ai-auth"); })
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, []);

  if (checking) {
    return (
      <div style={{ background: "#090b0f", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#00e87a", fontFamily: "monospace", fontSize: 16, letterSpacing: 4 }}>VEGA LOADING...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuth={(u) => setUser(u)} />;
  }

  return (
    <>
      <style>{AUTH_CSS}</style>
      <div className="user-bar">
        <span className="uname">{user.username}</span>
        <span>|</span>
        <span>{user.email}</span>
        <button onClick={logout}>LOGOUT</button>
      </div>
      <VegaApp />
    </>
  );
}
