"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, date, titleCase } from "@/lib/api";

interface Customer {
  id: string;
  alias: string;
  name: string;
  billing_email: string | null;
  invoicing_emails: string[];
  currency: string;
  vat_number: string | null;
  custom_taxes: Array<{ name: string; rate: string }>;
  is_tax_exempt: boolean;
  archived: boolean;
  created_at: string;
}

interface Page<T> {
  data: T[];
  meta: { total: number };
}

const blankForm = {
  name: "",
  alias: "",
  email: "",
  currency: "USD",
  phone: "",
  vat_number: "",
  tax_name: "",
  tax_rate: "",
};

export default function CustomersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Page<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page - 1), per_page: "20" });
      if (search.trim()) query.set("search", search.trim());
      setData(await apiFetch<Page<Customer>>(`/customers?${query}`));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function createCustomer(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        alias: form.alias,
        invoicing_emails: [form.email],
        billing_email: form.email || null,
        phone: form.phone || null,
        vat_number: form.vat_number || null,
        currency: form.currency,
        custom_taxes: form.tax_rate ? [{ name: form.tax_name || "Tax", rate: form.tax_rate }] : [],
        is_tax_exempt: false,
      };
      await apiFetch("/customers", { method: "POST", body: JSON.stringify(payload) });
      setOpen(false);
      setForm(blankForm);
      setToast("Customer created");
      setPage(1);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function archive(customer: Customer) {
    if (!window.confirm(`Archive ${customer.name}? New subscriptions will be blocked.`)) return;
    try {
      await apiFetch(`/customers/${customer.id}`, { method: "DELETE" });
      setToast("Customer archived");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Customers"
        sub="Billing profiles, tax settings and subscription history."
        actions={<button className="btn primary" onClick={() => setOpen(true)}>+ Add customer</button>}
      />

      <div className="card">
        <div className="card-head">
          <div className="inline" style={{ flex: 1 }}>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Search by name, alias or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="small muted">{data?.meta.total ?? 0} customers</div>
        </div>

        {error && !open ? <div style={{ padding: 20 }}><ErrorBox error={error} /></div> : null}
        {loading ? (
          <Loading label="Loading customers" />
        ) : data?.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Billing email</th>
                  <th>Currency</th>
                  <th>Tax</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="table-title">{customer.name}</div>
                      <div className="mono table-sub">{customer.alias}</div>
                    </td>
                    <td>{customer.billing_email ?? customer.invoicing_emails[0] ?? "—"}</td>
                    <td>{customer.currency}</td>
                    <td>
                      {customer.is_tax_exempt
                        ? "Exempt"
                        : customer.custom_taxes.length
                          ? `${customer.custom_taxes[0]?.name} ${customer.custom_taxes[0]?.rate}%`
                          : "—"}
                    </td>
                    <td>{date(customer.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <div className="inline" style={{ justifyContent: "flex-end" }}>
                        <StatusPill status={customer.archived ? "archived" : "active"} />
                        {!customer.archived ? (
                          <button className="btn sm ghost danger" onClick={() => archive(customer)}>
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No customers yet"
            body="Add your first billing profile to start a subscription."
            action={<button className="btn primary" onClick={() => setOpen(true)}>Add customer</button>}
          />
        )}

        {data && data.meta.total > 20 ? (
          <div className="card-head" style={{ borderTop: "1px solid var(--line)", borderBottom: 0 }}>
            <div className="small muted">
              Page {page} of {Math.ceil(data.meta.total / 20)}
            </div>
            <div className="inline">
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <button
                className="btn sm"
                disabled={page >= Math.ceil(data.meta.total / 20)}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {open ? (
        <Modal
          title="Add customer"
          subtitle="We'll use this profile for invoices, tax and portal access."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" form="customer-form" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Create customer"}
              </button>
            </>
          }
        >
          <form id="customer-form" className="form" onSubmit={createCustomer}>
            <ErrorBox error={error} />
            <div className="form-row">
              <div className="field">
                <label>Company name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    const alias = name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                      .slice(0, 64);
                    setForm((current) => ({ ...current, name, alias: current.alias || alias }));
                  }}
                  placeholder="Acme Corporation"
                  required
                />
              </div>
              <div className="field">
                <label>Alias</label>
                <input
                  className="input"
                  value={form.alias}
                  onChange={(event) => setForm({ ...form, alias: event.target.value })}
                  placeholder="acme"
                  required
                  pattern="[a-z0-9][a-z0-9_-]{1,63}"
                />
                <div className="hint">Lowercase, stable identifier used by the API.</div>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Billing email</label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="billing@acme.com"
                  required
                />
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
                <label>Phone (optional)</label>
                <input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </div>
              <div className="field">
                <label>VAT / tax ID (optional)</label>
                <input className="input" value={form.vat_number} onChange={(event) => setForm({ ...form, vat_number: event.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Tax name (optional)</label>
                <input
                  className="input"
                  value={form.tax_name}
                  onChange={(event) => setForm({ ...form, tax_name: event.target.value })}
                  placeholder="Sales tax"
                />
              </div>
              <div className="field">
                <label>Tax rate % (optional)</label>
                <input
                  className="input"
                  value={form.tax_rate}
                  onChange={(event) => setForm({ ...form, tax_rate: event.target.value })}
                  placeholder="8.25"
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="hint">{titleCase("tax applies to every invoice line for this customer")}.</div>
          </form>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
