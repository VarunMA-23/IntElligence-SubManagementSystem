"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, date, time, titleCase } from "@/lib/api";

const EVENTS = [
  "customer.created",
  "customer.updated",
  "customer.archived",
  "subscription.created",
  "subscription.canceled",
  "invoice.finalized",
  "invoice.paid",
  "credit_note.issued",
  "checkout.completed",
  "event.ingested",
];

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
}

interface Delivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

interface DeadLetter {
  id: string;
  source: string;
  payload: unknown;
  error: string;
  failed_at: string;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Page<Delivery> | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ url: "", events: ["invoice.finalized", "subscription.created"] });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [webhookResult, deliveryResult, deadResult] = await Promise.all([
        apiFetch<{ data: Webhook[] }>("/webhooks"),
        apiFetch<Page<Delivery>>("/webhook-deliveries?per_page=50"),
        apiFetch<{ data: DeadLetter[] }>("/dead-letters"),
      ]);
      setWebhooks(webhookResult.data);
      setDeliveries(deliveryResult);
      setDeadLetters(deadResult.data);
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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<Webhook & { secret: string }>("/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: form.url, events: form.events, enabled: true }),
      });
      setSecret(created.secret);
      setOpen(false);
      setForm({ url: "", events: ["invoice.finalized", "subscription.created"] });
      setToast("Endpoint created");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(webhook: Webhook) {
    try {
      await apiFetch(`/webhooks/${webhook.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  async function remove(webhook: Webhook) {
    if (!window.confirm("Delete this webhook endpoint?")) return;
    try {
      await apiFetch(`/webhooks/${webhook.id}`, { method: "DELETE" });
      setToast("Endpoint deleted");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  async function processNow() {
    setSaving(true);
    try {
      const result = await apiFetch<{ outbox_dispatched: number; deliveries_processed: number }>("/webhooks/process", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setToast(`Processed ${result.deliveries_processed} deliveries, ${result.outbox_dispatched} outbox events`);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function replay(letter: DeadLetter) {
    try {
      await apiFetch(`/dead-letters/${letter.id}/replay`, { method: "POST", body: JSON.stringify({}) });
      setToast("Delivery replayed");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  function toggleEvent(name: string) {
    setForm((current) => ({
      ...current,
      events: current.events.includes(name)
        ? current.events.filter((item) => item !== name)
        : [...current.events, name],
    }));
  }

  return (
    <Shell>
      <PageHeader
        title="Webhooks"
        sub="Signed delivery, retry with backoff, and a dead-letter queue you can replay."
        actions={
          <div className="inline">
            <button className="btn" onClick={processNow} disabled={saving}>Process now</button>
            <button className="btn primary" onClick={() => setOpen(true)}>+ New endpoint</button>
          </div>
        }
      />

      {error && !open ? <ErrorBox error={error} /> : null}
      {loading ? <Loading label="Loading webhooks" /> : null}

      {!loading ? (
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Endpoints</h3><span className="small muted">{webhooks.length}</span></div>
            {webhooks.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Endpoint</th><th>Events</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {webhooks.map((webhook) => (
                      <tr key={webhook.id}>
                        <td className="mono">{webhook.url}</td>
                        <td>
                          <div className="inline" style={{ flexWrap: "wrap" }}>
                            {webhook.events.map((name) => <span className="pill neutral" key={name}>{name}</span>)}
                          </div>
                        </td>
                        <td><StatusPill status={webhook.enabled ? "ACTIVE" : "PAUSED"} /></td>
                        <td style={{ textAlign: "right" }}>
                          <div className="inline" style={{ justifyContent: "flex-end" }}>
                            <button className="btn sm ghost" onClick={() => toggle(webhook)}>{webhook.enabled ? "Pause" : "Enable"}</button>
                            <button className="btn sm ghost danger" onClick={() => remove(webhook)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No endpoints" body="Add an HTTPS endpoint to receive signed lifecycle events." action={<button className="btn primary" onClick={() => setOpen(true)}>Add endpoint</button>} />
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Deliveries</h3><span className="small muted">{deliveries?.meta.total ?? 0}</span></div>
            {deliveries?.data.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Response</th><th>Created</th></tr></thead>
                  <tbody>
                    {deliveries.data.map((delivery) => (
                      <tr key={delivery.id}>
                        <td className="table-title">{delivery.event_type}</td>
                        <td><StatusPill status={delivery.status} /></td>
                        <td>{delivery.attempts}</td>
                        <td>
                          <span className="mono">{delivery.response_status ?? "—"}</span>
                          {delivery.last_error ? <div className="table-sub danger-text">{delivery.last_error}</div> : null}
                        </td>
                        <td className="small">{date(delivery.created_at)} {time(delivery.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No deliveries yet" body="Finalize an invoice or start a subscription to trigger a lifecycle event." />
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Dead letters</h3><span className="small muted">{deadLetters.length}</span></div>
            {deadLetters.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Source</th><th>Error</th><th>Failed</th><th /></tr></thead>
                  <tbody>
                    {deadLetters.map((letter) => (
                      <tr key={letter.id}>
                        <td className="table-title">{letter.source}</td>
                        <td className="small">{letter.error}</td>
                        <td className="small">{date(letter.failed_at)}</td>
                        <td style={{ textAlign: "right" }}><button className="btn sm" onClick={() => replay(letter)}>Replay</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Queue is healthy" body="Failed deliveries land here after the retry schedule is exhausted." />
            )}
          </div>
        </div>
      ) : null}

      {open ? (
        <Modal
          title="New webhook endpoint"
          subtitle="A signing secret is shown once. Verify x-brightloop-signature on every request."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="webhook-form" type="submit" disabled={saving}>{saving ? "Creating…" : "Create endpoint"}</button>
            </>
          }
        >
          <form id="webhook-form" className="form" onSubmit={create}>
            <ErrorBox error={error} />
            <div className="field"><label>Endpoint URL</label><input className="input" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com/webhooks/brightloop" required /></div>
            <div className="field">
              <label>Subscribed events</label>
              <div className="grid cols-2" style={{ gap: 8 }}>
                {EVENTS.map((name) => (
                  <label key={name} className="check-row" style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={form.events.includes(name)} onChange={() => toggleEvent(name)} />
                    <span className="mono">{name}</span>
                  </label>
                ))}
              </div>
            </div>
          </form>
        </Modal>
      ) : null}

      {secret ? (
        <Modal
          title="Signing secret"
          subtitle="Copy it now. Only a hash is stored on the server."
          onClose={() => setSecret(null)}
          footer={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}
        >
          <div className="stack">
            <div className="callout"><div className="callout-icon">!</div><div>Use this secret to verify <span className="mono">x-brightloop-signature</span>.</div></div>
            <textarea className="input mono" readOnly rows={3} value={secret} />
          </div>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
