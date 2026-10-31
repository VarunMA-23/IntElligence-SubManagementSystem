"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, apiUrl, date, getSession, money, monthStart, nextMonthStart, titleCase } from "@/lib/api";

interface LineItem {
  id: string;
  name: string;
  description: string | null;
  quantity: string;
  unit_price: string;
  amount: number;
  tax_rate: string;
  tax_amount: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  customer_id: string;
  subscription_id: string | null;
  currency: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_due: number;
  line_items: LineItem[];
  customer_details: { name?: string; email?: string; id?: string };
  coupons: Array<{ code: string; amount: string }>;
  memo: string | null;
  period_start: string | null;
  period_end: string | null;
  finalized_at: string | null;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

interface Subscription {
  id: string;
  customer_alias?: string | null;
  status: string;
  currency: string;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Page<Invoice> | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [creditFor, setCreditFor] = useState<Invoice | null>(null);
  const [credit, setCredit] = useState({ total: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({
    subscription_id: "",
    period_start: monthStart(),
    period_end: nextMonthStart(),
    finalize: "true",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ per_page: "100" });
      if (status) query.set("status", status);
      const [invoiceResult, subscriptionResult] = await Promise.all([
        apiFetch<Page<Invoice>>(`/invoices?${query}`),
        apiFetch<Page<Subscription>>("/subscriptions?per_page=100"),
      ]);
      setInvoices(invoiceResult);
      setSubscriptions(subscriptionResult.data);
      if (!form.subscription_id && subscriptionResult.data[0]) {
        setForm((current) => ({ ...current, subscription_id: subscriptionResult.data[0]!.id }));
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [status, form.subscription_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/invoices/generate", {
        method: "POST",
        body: JSON.stringify({
          subscription_id: form.subscription_id,
          period_start: form.period_start,
          period_end: form.period_end,
          finalize: form.finalize === "true",
        }),
      });
      setOpen(false);
      setToast("Invoice generated");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function finalize(invoice: Invoice) {
    setSaving(true);
    try {
      await apiFetch(`/invoices/${invoice.id}/finalize`, { method: "POST", body: JSON.stringify({}) });
      setToast("Invoice finalized");
      setDetail(null);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function submitCredit(event: React.FormEvent) {
    event.preventDefault();
    if (!creditFor) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/invoices/${creditFor.id}/credit-notes`, {
        method: "POST",
        body: JSON.stringify({ total: credit.total, reason: credit.reason }),
      });
      setCreditFor(null);
      setCredit({ total: "", reason: "" });
      setToast("Credit note issued");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function download(invoice: Invoice) {
    const session = getSession();
    const response = await fetch(apiUrl(`/invoices/${invoice.id}/pdf`), {
      headers: session ? { authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!response.ok) {
      setError(new Error("Could not render PDF"));
      return;
    }
    const blob = await response.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  async function openInvoice(invoice: Invoice) {
    try {
      setDetail(await apiFetch<Invoice>(`/invoices/${invoice.id}`));
    } catch (cause) {
      setError(cause);
    }
  }

  const subscriptionLabels = new Map(
    subscriptions.map((subscription) => [subscription.id, subscription.customer_alias ?? subscription.id.slice(0, 8)]),
  );

  return (
    <Shell>
      <PageHeader
        title="Invoices"
        sub="Generate, finalize, credit and download every bill."
        actions={<button className="btn primary" onClick={() => setOpen(true)}>+ Generate invoice</button>}
      />

      <div className="card">
        <div className="card-head">
          <div className="inline">
            <select className="input" style={{ maxWidth: 180 }} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {["DRAFT", "FINALIZED", "UNCOLLECTIBLE", "VOID"].map((value) => (
                <option key={value}>{titleCase(value)}</option>
              ))}
            </select>
          </div>
          <div className="small muted">{invoices?.meta.total ?? 0} invoices</div>
        </div>

        {error && !open && !detail && !creditFor ? <div style={{ padding: 20 }}><ErrorBox error={error} /></div> : null}
        {loading ? <Loading label="Loading invoices" /> : invoices?.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Invoice</th><th>Customer</th><th>Period</th><th>Status</th><th style={{ textAlign: "right" }}>Total</th><th /></tr>
              </thead>
              <tbody>
                {invoices.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <button className="icon-btn mono" style={{ padding: 0, fontWeight: 700 }} onClick={() => openInvoice(invoice)}>
                        {invoice.invoice_number}
                      </button>
                      <div className="table-sub">issued {date(invoice.invoice_date)} · due {date(invoice.due_date)}</div>
                    </td>
                    <td>
                      <div className="table-title">{invoice.customer_details?.name ?? "Customer"}</div>
                      <div className="table-sub">{invoice.subscription_id ? subscriptionLabels.get(invoice.subscription_id) ?? "" : "One-off"}</div>
                    </td>
                    <td className="small">{date(invoice.period_start)} → {date(invoice.period_end)}</td>
                    <td><StatusPill status={invoice.status} /></td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{money(invoice.total, invoice.currency)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="inline" style={{ justifyContent: "flex-end" }}>
                        <button className="btn sm ghost" onClick={() => openInvoice(invoice)}>View</button>
                        <button className="btn sm ghost" onClick={() => download(invoice)}>PDF</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No invoices yet"
            body="Generate a recurring invoice for a subscription. Usage charges are calculated from metered events."
            action={<button className="btn primary" onClick={() => setOpen(true)}>Generate invoice</button>}
          />
        )}
      </div>

      {open ? (
        <Modal
          title="Generate invoice"
          subtitle="A duplicate period for the same subscription is skipped automatically."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="invoice-form" type="submit" disabled={saving}>{saving ? "Generating…" : "Generate"}</button>
            </>
          }
        >
          <form id="invoice-form" className="form" onSubmit={generate}>
            <ErrorBox error={error} />
            <div className="field">
              <label>Subscription</label>
              <select className="input" value={form.subscription_id} onChange={(event) => setForm({ ...form, subscription_id: event.target.value })} required>
                <option value="">Select subscription</option>
                {subscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.customer_alias ?? subscription.id.slice(0, 8)} · {subscription.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field"><label>Period start</label><input className="input" type="date" value={form.period_start} onChange={(event) => setForm({ ...form, period_start: event.target.value })} required /></div>
              <div className="field"><label>Period end</label><input className="input" type="date" value={form.period_end} onChange={(event) => setForm({ ...form, period_end: event.target.value })} required /></div>
            </div>
            <div className="field">
              <label>After generation</label>
              <select className="input" value={form.finalize} onChange={(event) => setForm({ ...form, finalize: event.target.value })}>
                <option value="true">Finalize and assign a number</option>
                <option value="false">Leave as draft</option>
              </select>
            </div>
          </form>
        </Modal>
      ) : null}

      {detail ? (
        <Modal title={detail.invoice_number} subtitle={`${titleCase(detail.status)} · ${detail.customer_details?.name ?? "Customer"}`} onClose={() => setDetail(null)} wide>
          <div className="stack">
            <ErrorBox error={error} />
            <div className="grid cols-3">
              <div className="card pad"><div className="small muted">Invoice date</div><strong>{date(detail.invoice_date)}</strong></div>
              <div className="card pad"><div className="small muted">Due date</div><strong>{date(detail.due_date)}</strong></div>
              <div className="card pad"><div className="small muted">Amount due</div><strong>{money(detail.amount_due, detail.currency)}</strong></div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Line items</h3></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Tax</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                  <tbody>
                    {detail.line_items.length ? detail.line_items.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <div className="table-title">{line.name}</div>
                          <div className="table-sub">{line.description ?? ""}</div>
                        </td>
                        <td>{line.quantity}</td>
                        <td>{line.unit_price}</td>
                        <td>{line.tax_rate}%</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{money(line.amount, detail.currency)}</td>
                      </tr>
                    )) : <tr><td colSpan={5} className="muted">No stored line items on this response.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card pad">
              <div className="kv">
                <div className="kv-row"><span className="k">Subtotal</span><span className="v">{money(detail.subtotal, detail.currency)}</span></div>
                <div className="kv-row"><span className="k">Tax</span><span className="v">{money(detail.tax_amount, detail.currency)}</span></div>
                {detail.coupons.map((coupon) => (
                  <div className="kv-row" key={coupon.code}><span className="k">Coupon {coupon.code}</span><span className="v">−{coupon.amount} {detail.currency}</span></div>
                ))}
                <div className="kv-row"><span className="k" style={{ fontWeight: 800, color: "var(--ink)" }}>Total</span><span className="v" style={{ fontSize: 18 }}>{money(detail.total, detail.currency)}</span></div>
              </div>
            </div>
            <div className="inline" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => download(detail)}>Download PDF</button>
              {detail.status === "FINALIZED" ? (
                <button
                  className="btn"
                  onClick={() => {
                    setCredit({ total: (detail.total / 100).toFixed(2), reason: "" });
                    setCreditFor(detail);
                  }}
                >
                  Issue credit note
                </button>
              ) : null}
              {detail.status === "DRAFT" ? (
                <button className="btn primary" onClick={() => finalize(detail)} disabled={saving}>Finalize invoice</button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      {creditFor ? (
        <Modal
          title="Issue credit note"
          subtitle={`Against ${creditFor.invoice_number} · ${money(creditFor.total, creditFor.currency)}`}
          onClose={() => setCreditFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCreditFor(null)}>Cancel</button>
              <button className="btn primary" form="credit-form" type="submit" disabled={saving}>{saving ? "Issuing…" : "Issue credit"}</button>
            </>
          }
        >
          <form id="credit-form" className="form" onSubmit={submitCredit}>
            <ErrorBox error={error} />
            <div className="field"><label>Credit amount ({creditFor.currency})</label><input className="input" value={credit.total} onChange={(event) => setCredit({ ...credit, total: event.target.value })} required /></div>
            <div className="field"><label>Reason</label><textarea className="input" value={credit.reason} onChange={(event) => setCredit({ ...credit, reason: event.target.value })} required /></div>
          </form>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
