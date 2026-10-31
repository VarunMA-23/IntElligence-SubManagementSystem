"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, money, titleCase } from "@/lib/api";

interface Component {
  id?: string;
  name: string;
  fee_type: string;
  billing_period: string;
  billing_type: string;
  pricing: { type: string; rate?: string; block_size?: number };
}

interface Plan {
  id: string;
  name: string;
  alias: string;
  description: string | null;
  status: string;
  plan_type: string;
  currency: string;
  billing_period: string;
  trial_days: number;
  components: Component[];
  current_version?: { version: number; published_at: string | null; components?: Component[] };
  current_version_id: string | null;
  archived: boolean;
}

interface Family {
  id: string;
  name: string;
}

interface Metric {
  id: string;
  name: string;
  code: string;
}

const baseForm = {
  name: "",
  alias: "",
  description: "",
  family_id: "",
  currency: "USD",
  billing_period: "MONTHLY",
  trial_days: "14",
  base_price: "",
  metric_id: "",
  usage_rate: "",
  publish: "true",
};

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(baseForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [detail, setDetail] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planResult, familyResult, metricResult] = await Promise.all([
        apiFetch<{ data: Plan[] }>("/plans?per_page=100"),
        apiFetch<{ data: Family[] }>("/product-families"),
        apiFetch<{ data: Metric[] }>("/metrics"),
      ]);
      setPlans(planResult.data);
      setFamilies(familyResult.data);
      setMetrics(metricResult.data);
      if (familyResult.data[0]) setForm((current) => ({ ...current, family_id: current.family_id || familyResult.data[0]!.id }));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const components: Component[] = [
        {
          name: "Platform access",
          fee_type: "RATE",
          billing_period: form.billing_period,
          billing_type: "ADVANCE",
          pricing: { type: "FLAT", rate: form.base_price || "0.00" },
        },
      ];
      if (form.metric_id && form.usage_rate) {
        components.push({
          name: "Metered usage",
          fee_type: "USAGE",
          billing_period: form.billing_period,
          billing_type: "ARREARS",
          pricing: { type: "PER_UNIT", rate: form.usage_rate },
        });
      }
      const created = await apiFetch<Plan>("/plans", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          alias: form.alias,
          description: form.description || null,
          plan_type: "STANDARD",
          product_family_id: form.family_id,
          currency: form.currency,
          billing_period: form.billing_period,
          billing_type: "ADVANCE",
          net_terms: 30,
          trial_days: Number(form.trial_days || 0),
          components: components.map((component, index) => ({
            product_id: null,
            metric_id: index === 1 ? form.metric_id : null,
            ...component,
            order: index,
          })),
          entitlements: [],
        }),
      });
      if (form.publish === "true") {
        await apiFetch(`/plans/${created.id}/publish`, { method: "POST", body: JSON.stringify({}) });
      }
      setToast(form.publish === "true" ? "Plan created and published" : "Draft plan created");
      setOpen(false);
      setForm({ ...baseForm, family_id: families[0]?.id ?? "" });
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function publish(plan: Plan) {
    try {
      await apiFetch(`/plans/${plan.id}/publish`, { method: "POST", body: JSON.stringify({}) });
      setToast("Plan published");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Plans"
        sub="Product packaging, pricing and the version history behind every subscription."
        actions={<button className="btn primary" onClick={() => setOpen(true)}>+ New plan</button>}
      />

      {error && !open ? <ErrorBox error={error} /> : null}
      {loading ? <Loading label="Loading plans" /> : null}

      {!loading ? (
        <div className="grid cols-3">
          {plans.map((plan) => (
            <div className="card" key={plan.id} style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-body" style={{ flex: 1 }}>
                <div className="spread">
                  <span className="pill neutral">{titleCase(plan.plan_type)}</span>
                  <StatusPill status={plan.status} />
                </div>
                <h3 style={{ fontSize: 21, letterSpacing: "-0.03em", marginTop: 16 }}>{plan.name}</h3>
                <div className="mono muted">{plan.alias}</div>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em", marginTop: 20 }}>
                  {money(Number(plan.components[0]?.pricing.rate ?? 0) * 100, plan.currency)}
                  <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}> /{plan.billing_period.toLowerCase()}</span>
                </div>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {plan.trial_days} day trial · {plan.components.length} price component{plan.components.length === 1 ? "" : "s"}
                </div>
                {plan.description ? <div className="small" style={{ marginTop: 14 }}>{plan.description}</div> : null}
              </div>
              <div className="card-head" style={{ borderBottom: 0, borderTop: "1px solid var(--line)", padding: "13px 18px" }}>
                <button className="btn sm ghost" onClick={() => setDetail(plan)}>Inspect</button>
                {plan.status === "DRAFT" ? (
                  <button className="btn sm lime" onClick={() => publish(plan)}>Publish</button>
                ) : (
                  <span className="small muted">v{plan.current_version?.version ?? 1}</span>
                )}
              </div>
            </div>
          ))}
          {!plans.length ? (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <Empty
                title="No plans yet"
                body="Create a family and a metric first if you want metered pricing."
                action={<button className="btn primary" onClick={() => setOpen(true)}>Create plan</button>}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <Modal
          title="New plan"
          subtitle="Start with a base price. Add metered usage if this plan bills by consumption."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="plan-form" type="submit" disabled={saving}>{saving ? "Creating…" : "Create plan"}</button>
            </>
          }
        >
          <form id="plan-form" className="form" onSubmit={createPlan}>
            <ErrorBox error={error} />
            <div className="form-row">
              <div className="field"><label>Plan name</label><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Growth" required /></div>
              <div className="field"><label>Alias</label><input className="input" value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="growth" required /></div>
            </div>
            <div className="field"><label>Description</label><textarea className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="For teams shipping their first usage-based product." /></div>
            <div className="form-row">
              <div className="field">
                <label>Product family</label>
                <select className="input" value={form.family_id} onChange={(event) => setForm({ ...form, family_id: event.target.value })} required>
                  <option value="">Select family</option>
                  {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Currency</label>
                <select className="input" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
                  {["USD", "EUR", "GBP", "CAD", "AUD", "INR", "SGD"].map((code) => <option key={code}>{code}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Billing period</label>
                <select className="input" value={form.billing_period} onChange={(event) => setForm({ ...form, billing_period: event.target.value })}>
                  {["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"].map((period) => <option key={period}>{period}</option>)}
                </select>
              </div>
              <div className="field"><label>Trial days</label><input className="input" type="number" min={0} max={365} value={form.trial_days} onChange={(event) => setForm({ ...form, trial_days: event.target.value })} /></div>
            </div>
            <div className="divider" />
            <div className="form-row">
              <div className="field"><label>Base price</label><input className="input" value={form.base_price} onChange={(event) => setForm({ ...form, base_price: event.target.value })} placeholder="199.00" required inputMode="decimal" /></div>
              <div className="field">
                <label>Usage metric (optional)</label>
                <select className="input" value={form.metric_id} onChange={(event) => setForm({ ...form, metric_id: event.target.value })}>
                  <option value="">No metered component</option>
                  {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}
                </select>
              </div>
            </div>
            {form.metric_id ? (
              <div className="field"><label>Usage rate per unit</label><input className="input" value={form.usage_rate} onChange={(event) => setForm({ ...form, usage_rate: event.target.value })} placeholder="0.008" inputMode="decimal" required /></div>
            ) : null}
            <div className="field">
              <label>Publish</label>
              <select className="input" value={form.publish} onChange={(event) => setForm({ ...form, publish: event.target.value })}>
                <option value="true">Publish immediately</option>
                <option value="false">Keep as draft</option>
              </select>
            </div>
          </form>
        </Modal>
      ) : null}

      {detail ? (
        <Modal title={detail.name} subtitle={`${titleCase(detail.status)} · ${detail.alias}`} onClose={() => setDetail(null)} wide>
          <div className="stack">
            <div className="grid cols-3">
              <div className="card pad"><div className="label muted small">Currency</div><strong>{detail.currency}</strong></div>
              <div className="card pad"><div className="label muted small">Billing period</div><strong>{titleCase(detail.billing_period)}</strong></div>
              <div className="card pad"><div className="label muted small">Trial</div><strong>{detail.trial_days} days</strong></div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Components</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Fee type</th><th>Billing</th><th>Pricing</th></tr></thead>
                  <tbody>
                    {(detail.current_version?.components ?? detail.components).map((component, index) => (
                      <tr key={`${component.name}-${index}`}>
                        <td className="table-title">{component.name}</td>
                        <td>{titleCase(component.fee_type)}</td>
                        <td>{titleCase(component.billing_type)} / {titleCase(component.billing_period)}</td>
                        <td className="mono">{component.pricing.type} {component.pricing.rate ? `· ${component.pricing.rate}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
