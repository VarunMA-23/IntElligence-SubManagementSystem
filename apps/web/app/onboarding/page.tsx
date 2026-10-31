"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthArt } from "@/components/AuthArt";
import { ErrorBox } from "@/components/ui";
import { apiFetch, getSession, setSession } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) router.replace("/login");
    else if (session.tenant_id) router.replace("/dashboard");
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const session = getSession();
    if (!session) return;
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        organization: { id: string; name: string };
        tenant: { id: string; name: string };
      }>("/auth/organizations", {
        method: "POST",
        body: JSON.stringify({ name, tenant_name: name, currency }),
      });
      setSession({
        ...session,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_in: result.expires_in,
        org_id: result.organization.id,
        tenant_id: result.tenant.id,
      });
      router.replace("/dashboard");
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
          <h2>Name your workspace</h2>
          <p className="muted">This is where your catalog, plans, customers and invoices live.</p>
          <form className="form" onSubmit={submit}>
            <ErrorBox error={error} />
            <div className="field">
              <label htmlFor="workspace">Workspace name</label>
              <input
                id="workspace"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Cloud"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="currency">Billing currency</label>
              <select id="currency" className="input" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {["USD", "EUR", "GBP", "CAD", "AUD", "INR", "SGD"].map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </div>
            <button className="btn primary" type="submit" disabled={loading} style={{ justifyContent: "center" }}>
              {loading ? <span className="spin" /> : null}
              {loading ? "Creating workspace" : "Create workspace"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
