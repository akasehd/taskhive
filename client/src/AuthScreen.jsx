import { useState } from "react";
import { api } from "./api.js";

export function AuthScreen({ onAuthed, inviting }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const { user } = mode === "login" ? await api.login(form) : await api.register(form);
      onAuthed(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand lg"><span className="logo" aria-hidden="true" />TaskHive</div>
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="muted">{inviting ? "Sign in to join the board you were invited to." : "Real-time boards for small teams."}</p>
        <form onSubmit={submit} className="stack">
          {mode === "register" && (
            <label className="field">Name<input name="name" autoComplete="name" required maxLength={60} /></label>
          )}
          <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
          <label className="field">Password
            <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <p className="muted small center-text">
          {mode === "login" ? "New to TaskHive? " : "Already have an account? "}
          <button className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
