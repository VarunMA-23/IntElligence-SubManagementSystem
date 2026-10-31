"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, Toast } from "@/components/ui";
import { apiFetch, date, monthStart, nextMonthStart, titleCase } from "@/lib/api";

interface GroupedUsage {
  dimensions: Record<string, string>;
  value: string;
}

interface UsageRow {
  metric_id: string;
  metric_name: string;
  metric_code: string;
  total_value: string;
  grouped_usage: GroupedUsage[];
}

interface Customer {
  id: string;
  name: string;
  alias: string;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [period, setPeriod] = useState({ start: monthStart(), end: nextMonthStart() });
  const [customerId, setCustomerId] = useState("");
  const [customerUsage, setCustomerUsage] = useState<UsageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [event, setEvent] = useState({
    code: "",
    customer: "",
    value: "1",
    timestamp: new Date().toISOString().slice(0, 16),
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ period_start: period.start, period_end: period.end });
      const [usageResult, customerResult] = await Promise.all([
        apiFetch<{ data: UsageRow[] }>(`/usage?${query}`),
        apiFetch<Page<Customer>>("/customers?per_page=100"),
      ]);
      setUsage(usageResult.data);
      setCustomers(customerResult.data);
      if (!event.customer && customerResult.data[0]) {
        setEvent((current) => ({ ...current, customer: customerResult.data[0]!.alias }));
      }
      if (!event.code && usageResult.data[0]) {
        setEvent((current) => ({ ...current, code: usageResult.data[0]!.metric_code }));
      }
      if (customerId) {
        const detailQuery = new URLSearchParams({ period_start: period.start, period_end: period.end });
        const detail = await apiFetch<{ data: UsageRow[] }>(`/customers/${customerId}/usage?${detailQuery}`);
        setCustomerUsage(detail.data);
      } else {
        setCustomerUsage(null);
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [period.start, period.end, customerId, event.customer, event.code]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function ingest(submit: React.FormEvent) {
    submit.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              code: event.code,
              customer_id: event.customer,
              timestamp: new Date(event.timestamp).toISOString(),
              properties: { value: event.value, source: "dashboard" },
            },
          ],
          allow_backfilling: false,
          allow_partial_failures: false,
        }),
      });
      setOpen(false);
      setToast("Event accepted");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  const rows = customerUsage ?? usage;

  return (
    <Shell>
      <PageHeader
        title="Usage"
        sub="Raw events roll up into billable metrics in real time."
        actions={<button className="btn primary" onClick={() => setOpen(true)}>+ Send test event</button>}
      />

      <div className="card">
        <div className="card-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="inline">
            <input className="input" type="date" style={{ maxWidth: 160 }} value={period.start} onChange={(event) => setPeriod({ ...period, start: event.target.value })} />
            <span className="muted">→</span>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={period.end} onChange={(event) => setPeriod({ ...period, end: event.target.value })} />
            <select className="input" style={{ maxWidth: 220 }} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">All customers</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </div>
          <div className="small muted">{date(period.start)} → {date(period.end)}</div>
        </div>

        {error && !open ? <div style={{ padding: 20 }}><ErrorBox error={error} /></div> : null}
        {loading ? <Loading label="Aggregating usage" /> : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Metric</th><th>Code</th><th style={{ textAlign: "right" }}>Total</th><th>Dimensions</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.metric_id}>
                    <td className="table-title">{row.metric_name}</td>
                    <td className="mono">{row.metric_code}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, fontSize: 16 }}>{row.total_value}</td>
                    <td>
                      <div className="inline" style={{ flexWrap: "wrap" }}>
                        {row.grouped_usage.slice(0, 6).map((group, index) => (
                          <span className="pill neutral" key={`${row.metric_id}-${index}`}>
                            {Object.entries(group.dimensions).map(([key, value]) => `${key}=${value}`).join(", ") || "all"} · {group.value}
                          </span>
                        ))}
                        {!row.grouped_usage.length ? <span className="muted small">No events in period</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No usage in this period"
            body="Send an event to see aggregation, grouped dimensions and invoice effects."
            action={<button className="btn primary" onClick={() => setOpen(true)}>Send test event</button>}
          />
        )}
      </div>

      <div className="grid cols-3" style={{ marginTop: 18 }}>
        <div className="card pad">
          <div className="small muted">Metrics tracked</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em" }}>{usage.length}</div>
        </div>
        <div className="card pad">
          <div className="small muted">Events aggregated</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.04em" }}>
            {usage.reduce((total, row) => total + Number(row.total_value), 0).toLocaleString()}
          </div>
        </div>
        <div className="card pad">
          <div className="small muted">Scope</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{customerId ? titleCase(customers.find((item) => item.id === customerId)?.name ?? "Customer") : "Whole tenant"}</div>
        </div>
      </div>

      {open ? (
        <Modal
          title="Send test event"
          subtitle="Events are idempotent by event_id and validated against the metric aggregation."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="event-form" type="submit" disabled={saving}>{saving ? "Sending…" : "Send event"}</button>
            </>
          }
        >
          <form id="event-form" className="form" onSubmit={ingest}>
            <ErrorBox error={error} />
            <div className="field">
              <label>Metric code</label>
              <select className="input" value={event.code} onChange={(change) => setEvent({ ...event, code: change.target.value })} required>
                <option value="">Select metric</option>
                {usage.map((row) => <option key={row.metric_id} value={row.metric_code}>{row.metric_name} ({row.metric_code})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Customer alias</label>
              <select className="input" value={event.customer} onChange={(change) => setEvent({ ...event, customer: change.target.value })} required>
                <option value="">Select customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.alias}>{customer.name} ({customer.alias})</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="field"><label>Value</label><input className="input" value={event.value} onChange={(change) => setEvent({ ...event, value: change.target.value })} required inputMode="decimal" /></div>
              <div className="field"><label>Timestamp</label><input className="input" type="datetime-local" value={event.timestamp} onChange={(change) => setEvent({ ...event, timestamp: change.target.value })} required /></div>
            </div>
          </form>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
