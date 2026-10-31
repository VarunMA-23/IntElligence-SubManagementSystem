"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthArt } from "@/components/AuthArt";
import { ErrorBox, SuccessBox } from "@/components/ui";
import { register } from "@/lib/api";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [verification, setVerification] = useState<{ token?: string; email: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await register({ name, email: email.trim().toLowerCase(), password });
      setVerification({ token: result.verification_token_hint, email: result.user.email });
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }

  if (verification) {
    return (
      <div className="auth-shell">
        <AuthArt />
        <section className="auth-panel">
          <div className="auth-card">
            <div className="brand" style={{ marginBottom: 38 }}>
              <span className="brand-mark">B</span>
              <span>BrightLoop</span>
            </div>
            <h2>Check your inbox</h2>
            <p className="muted">
              We sent a verification link to <strong>{verification.email}</strong>. Verify the address, then sign in.
            </p>
            <div style={{ marginTop: 24 }} className="stack">
              {verification.token ? (
                <SuccessBox>
                  Local mail delivery is enabled.{" "}
                  <Link
                    href={`/verify-email?token=${verification.token}`}
                    style={{ color: "var(--green)", fontWeight: 800 }}
                  >
                    Verify this email now
                  </Link>
                </SuccessBox>
              ) : null}
              <Link className="btn primary" href="/login" style={{ justifyContent: "center" }}>
                Continue to sign in
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
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
          <h2>Create your account</h2>
          <p className="muted">Spin up a workspace in under a minute.</p>
          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters with a number"
                minLength={8}
                required
              />
              <div className="hint">Use 8+ characters with at least one letter and one number.</div>
            </div>
            <button className="btn primary" type="submit" disabled={loading} style={{ justifyContent: "center" }}>
              {loading ? <span className="spin" /> : null}
              {loading ? "Creating account" : "Create account"}
            </button>
          </form>
          <p className="muted small" style={{ marginTop: 22 }}>
            Already have an account? <Link href="/login" style={{ color: "var(--blue)", fontWeight: 700 }}>Sign in</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
