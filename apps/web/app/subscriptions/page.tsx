"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, date, money, today, titleCase } from "@/lib/api";

interface Subscription {
  id: string;
  customer_id: string;
  customer_alias?: string | null;
  plan_id: string;
  status: string;
  currency: string;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  start_date: string;
  created_at: string;
}

interface Customer {
  id: string;
  name: string;
  alias: string;
}

interface Plan {
  id: string;
  name: string;
  status: string;
  currency: string;
  trial_days: number;
  components: Array<{ pricing: { rate?: string } }>;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Page<Subscription> | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    plan_id: "",
    customer_id_or_alias: "",
    start_date: today(),
    trial_days: "0",
    billing_day_anchor: "1",
    net_terms: "30",
    coupon_code: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ per_page: "100" });
      if (status) query.set("status", status);
      const [subscriptionResult, customerResult, planResult] = await Promise.all([
        apiFetch<Page<Subscription>>(`/subscriptions?${query}`),
        apiFetch<Page<Customer>>("/customers?per_page=100"),
        apiFetch<{ data: Plan[] }>("/plans?per_page=100"),
      ]);
      setSubscriptions(subscriptionResult);
      setCustomers(customerResult.data);
      setPlans(planResult.data);
      if (!form.plan_id && planResult.data[0]) setForm((current) => ({ ...current, plan_id: planResult.data[0]!.id }));
      if (!form.customer_id_or_alias && customerResult.data[0]) {
        setForm((current) => ({ ...current, customer_id_or_alias: customerResult.data[0]!.id }));
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [status, form.plan_id, form.customer_id_or_alias]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function createSubscription(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          plan_id: form.plan_id,
          customer_id_or_alias: form.customer_id_or_alias,
          start_date: form.start_date,
          activation_condition: "ON_START",
          trial_days: Number(form.trial_days || 0),
          billing_day_anchor: Number(form.billing_day_anchor || 1),
          net_terms: Number(form.net_terms || 30),
          coupon_codes: form.coupon_code ? [form.coupon_code] : [],
          add_ons: [],
          auto_advance_invoices: true,
          charge_automatically: false,
        }),
      });
      setOpen(false);
      setToast("Subscription started");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function cancel(subscription: Subscription) {
    if (!window.confirm(`Cancel the subscription for ${subscription.customer_alias ?? "this customer"}?`)) return;
    try {
      await apiFetch(`/subscriptions/${subscription.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ effective_date: today(), reason: "Cancelled from dashboard" }),
      });
      setToast("Subscription cancelled");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  const planNames = new Map(plans.map((plan) => [plan.id, plan.name]));
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));

  return (
    <Shell>
      <PageHeader
        title="Subscriptions"
        sub="Recurring revenue, trials and the period each customer is in."
        actions={<button className="btn primary" onClick={() => setOpen(true)}>+ Start subscription</button>}
      />

      <div className="card">
        <div className="card-head">
          <div className="inline">
            <select className="input" style={{ maxWidth: 190 }} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {["ACTIVE", "TRIAL_ACTIVE", "PENDING_ACTIVATION", "PAST_DUE", "CANCELLED"].map((value) => (
                <option key={value} value={value}>{titleCase(value)}</option>
              ))}
            </select>
          </div>
          <div className="small muted">{subscriptions?.meta.total ?? 0} subscriptions</div>
        </div>

        {error && !open ? <div style={{ padding: 20 }}><ErrorBox error={error} /></div> : null}
        {loading ? <Loading label="Loading subscriptions" /> : subscriptions?.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Customer</th><th>Plan</th><th>Status</th><th>Current period</th><th style={{ textAlign: "right" }}>MRR</th><th /></tr>
              </thead>
              <tbody>
                {subscriptions.data.map((subscription) => {
                  const plan = plans.find((item) => item.id === subscription.plan_id);
                  const rate = Number(plan?.components[0]?.pricing.rate ?? 0);
                  return (
                    <tr key={subscription.id}>
                      <td>
                        <div className="table-title">{customerNames.get(subscription.customer_id) ?? subscription.customer_alias ?? "Customer"}</div>
                        <div className="table-sub mono">{subscription.customer_alias ?? subscription.customer_id.slice(0, 8)}</div>
                      </td>
                      <td>{planNames.get(subscription.plan_id) ?? "—"}</td>
                      <td><StatusPill status={subscription.status} /></td>
                      <td>
                        <div>{date(subscription.current_period_start)} → {date(subscription.current_period_end)}</div>
                        {subscription.trial_ends_at ? <div className="table-sub">trial ends {date(subscription.trial_ends_at)}</div> : null}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(rate * 100, subscription.currency)}</td>
                      <td style={{ textAlign: "right" }}>
                        {!["CANCELLED", "COMPLETED", "SUPERSEDED"].includes(subscription.status) ? (
                          <button className="btn sm ghost danger" onClick={() => cancel(subscription)}>Cancel</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No subscriptions"
            body="Pick a customer and a published plan to start billing."
            action={<button className="btn primary" onClick={() => setOpen(true)}>Start subscription</button>}
          />
        )}
      </div>

      {open ? (
        <Modal
          title="Start subscription"
          subtitle="The customer is billed from the plan's current published version."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="subscription-form" type="submit" disabled={saving}>{saving ? "Starting…" : "Start subscription"}</button>
            </>
          }
        >
          <form id="subscription-form" className="form" onSubmit={createSubscription}>
            <ErrorBox error={error} />
            <div className="field">
              <label>Customer</label>
              <select className="input" value={form.customer_id_or_alias} onChange={(event) => setForm({ ...form, customer_id_or_alias: event.target.value })} required>
                <option value="">Select customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.alias})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Plan</label>
              <select className="input" value={form.plan_id} onChange={(event) => setForm({ ...form, plan_id: event.target.value })} required>
                <option value="">Select plan</option>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.status}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="field"><label>Start date</label><input className="input" type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></div>
              <div className="field"><label>Trial days</label><input className="input" type="number" min={0} value={form.trial_days} onChange={(event) => setForm({ ...form, trial_days: event.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Billing day</label><input className="input" type="number" min={1} max={31} value={form.billing_day_anchor} onChange={(event) => setForm({ ...form, billing_day_anchor: event.target.value })} /></div>
              <div className="field"><label>Net terms (days)</label><input className="input" type="number" min={0} value={form.net_terms} onChange={(event) => setForm({ ...form, net_terms: event.target.value })} /></div>
            </div>
            <div className="field">
              <label>Coupon code (optional)</label>
              <input className="input" value={form.coupon_code} onChange={(event) => setForm({ ...form, coupon_code: event.target.value.toUpperCase() })} placeholder="LAUNCH20" />
            </div>
          </form>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
