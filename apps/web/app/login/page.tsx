"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthArt } from "@/components/AuthArt";
import { ErrorBox } from "@/components/ui";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await login(email.trim().toLowerCase(), password);
      router.replace(session.tenant_id ? "/dashboard" : "/onboarding");
    } catch (cause) {
      setError(cause);
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <AuthArt />
      <section className="auth-panel">
        <div className="auth-card">
          <div className="brand" style={{ marginBottom: 38 }}>
            <span className="brand-mark">B</span>
            <span>BrightLoop</span>
          </div>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to your billing control room.</p>
          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <button className="btn primary" type="submit" disabled={loading} style={{ justifyContent: "center" }}>
              {loading ? <span className="spin" /> : null}
              {loading ? "Signing in" : "Sign in"}
            </button>
          </form>
          <p className="muted small" style={{ marginTop: 22 }}>
            New to BrightLoop? <Link href="/register" style={{ color: "var(--blue)", fontWeight: 700 }}>Create an account</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
