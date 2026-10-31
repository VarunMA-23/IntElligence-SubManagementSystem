"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, PageHeader, StatusPill } from "@/components/ui";
import { apiFetch, date, dateTime, money, monthStart, nextMonthStart, relative, titleCase } from "@/lib/api";

interface Page<T> {
  data: T[];
  meta?: { total: number };
}

interface Customer {
  id: string;
  name: string;
  alias: string;
  currency: string;
}

interface Subscription {
  id: string;
  status: string;
  customer_alias?: string | null;
  currency: string;
  current_period_end: string;
  plan_id: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  currency: string;
  invoice_date: string;
  customer_details?: { name?: string };
}

interface Activity {
  id: string;
  entity_type: string;
  action: string;
  created_at: string;
  actor_id: string | null;
}

interface UsageRow {
  metric_id: string;
  metric_name: string;
  metric_code: string;
  total_value: string;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [customers, setCustomers] = useState<Page<Customer>>({ data: [] });
  const [subscriptions, setSubscriptions] = useState<Page<Subscription>>({ data: [] });
  const [invoices, setInvoices] = useState<Page<Invoice>>({ data: [] });
  const [activities, setActivities] = useState<Page<Activity>>({ data: [] });
  const [usage, setUsage] = useState<UsageRow[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<Page<Customer>>("/customers?per_page=5"),
      apiFetch<Page<Subscription>>("/subscriptions?per_page=100"),
      apiFetch<Page<Invoice>>("/invoices?per_page=6"),
      apiFetch<Page<Activity>>("/activities?per_page=8"),
      apiFetch<{ data: UsageRow[] }>(`/usage?period_start=${monthStart()}&period_end=${nextMonthStart()}`),
    ])
      .then(([customerPage, subscriptionPage, invoicePage, activityPage, usageResult]) => {
        if (!active) return;
        setCustomers(customerPage);
        setSubscriptions(subscriptionPage);
        setInvoices(invoicePage);
        setActivities(activityPage);
        setUsage(usageResult.data);
      })
      .catch((cause) => active && setError(cause))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const activeSubs = subscriptions.data.filter((subscription) =>
    ["ACTIVE", "TRIAL_ACTIVE", "TRIAL_EXPIRED", "PAST_DUE"].includes(subscription.status),
  );
  const openInvoices = invoices.data.filter((invoice) => ["DRAFT", "FINALIZED"].includes(invoice.status));
  const revenue = openInvoices.reduce((total, invoice) => total + invoice.total, 0);
  const currency = invoices.data[0]?.currency ?? "USD";
  const maxUsage = Math.max(1, ...usage.map((row) => Number(row.total_value)));

  return (
    <Shell>
      <PageHeader
        title="Control room"
        sub="A live read on customers, revenue and product usage."
        actions={
          <>
            <Link className="btn" href="/customers">Add customer</Link>
            <Link className="btn primary" href="/subscriptions">New subscription</Link>
          </>
        }
      />

      {error ? <ErrorBox error={error} /> : null}

      <div className="banner" style={{ marginBottom: 18 }}>
        <div>
          <h2>Usage is the product now.</h2>
          <p>
            {activeSubs.length} active subscription{activeSubs.length === 1 ? "" : "s"} ·{" "}
            {customers.meta?.total ?? customers.data.length} customer{customers.meta?.total === 1 ? "" : "s"} ·{" "}
            {usage.length} tracked metric{usage.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link className="btn" href="/usage">Send test events →</Link>
      </div>

      {loading ? (
        <Loading label="Loading your workspace" />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 18 }}>
            <div className="card metric">
              <div className="label">Active subscriptions</div>
              <div className="value">{activeSubs.length}</div>
              <div className="hint">{subscriptions.meta?.total ?? subscriptions.data.length} total on record</div>
              <div className="glyph">↻</div>
            </div>
            <div className="card metric">
              <div className="label">Open invoices</div>
              <div className="value">{openInvoices.length}</div>
              <div className="hint">{money(revenue, currency)} in current view</div>
              <div className="glyph">$</div>
            </div>
            <div className="card metric">
              <div className="label">Customers</div>
              <div className="value">{customers.meta?.total ?? customers.data.length}</div>
              <div className="hint">Billing profiles in this workspace</div>
              <div className="glyph">◉</div>
            </div>
            <div className="card metric">
              <div className="label">Metered usage</div>
              <div className="value">
                {usage.reduce((total, row) => total + Number(row.total_value), 0).toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}
              </div>
              <div className="hint">All metrics this billing month</div>
              <div className="glyph">⌁</div>
            </div>
          </div>

          <div className="split">
            <div className="stack">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Recent invoices</h2>
                    <div className="sub">Drafts and finalized bills</div>
                  </div>
                  <Link className="btn sm ghost" href="/invoices">View all</Link>
                </div>
                {invoices.data.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Customer</th>
                          <th>Status</th>
                          <th style={{ textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.data.map((invoice) => (
                          <tr key={invoice.id}>
                            <td>
                              <div className="mono">{invoice.invoice_number}</div>
                              <div className="table-sub">{date(invoice.invoice_date)}</div>
                            </td>
                            <td>{invoice.customer_details?.name ?? "—"}</td>
                            <td><StatusPill status={invoice.status} /></td>
                            <td style={{ textAlign: "right", fontWeight: 700 }}>
                              {money(invoice.total, invoice.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No invoices yet"
                    body="Generate an invoice from a subscription to see it here."
                    action={<Link className="btn primary" href="/invoices">Open invoices</Link>}
                  />
                )}
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Usage this month</h2>
                    <div className="sub">Aggregated across every customer</div>
                  </div>
                  <Link className="btn sm ghost" href="/usage">Inspect</Link>
                </div>
                <div className="card-body">
                  {usage.length ? (
                    <div className="stack" style={{ gap: 17 }}>
                      {usage.map((row) => (
                        <div key={row.metric_id}>
                          <div className="spread" style={{ marginBottom: 7 }}>
                            <div>
                              <div className="table-title">{row.metric_name}</div>
                              <div className="mono muted">{row.metric_code}</div>
                            </div>
                            <strong>{Number(row.total_value).toLocaleString("en-US")}</strong>
                          </div>
                          <div className="bar lime">
                            <span style={{ width: `${Math.max(4, (Number(row.total_value) / maxUsage) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty title="No usage recorded" body="Send your first metered events to light this up." />
                  )}
                </div>
              </div>
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Subscriptions</h2>
                    <div className="sub">Latest activity</div>
                  </div>
                </div>
                <div className="card-body">
                  {subscriptions.data.length ? (
                    <div className="stack" style={{ gap: 13 }}>
                      {subscriptions.data.slice(0, 6).map((subscription) => (
                        <div className="spread" key={subscription.id}>
                          <div>
                            <div className="table-title">{subscription.customer_alias ?? "Customer"}</div>
                            <div className="table-sub">renews {date(subscription.current_period_end)}</div>
                          </div>
                          <StatusPill status={subscription.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty title="Nothing subscribed yet" body="Attach a plan to your first customer." />
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div>
                    <h2>Audit trail</h2>
                    <div className="sub">Who changed what</div>
                  </div>
                </div>
                <div className="card-body">
                  {activities.data.length ? (
                    <div className="stack" style={{ gap: 14 }}>
                      {activities.data.map((activity) => (
                        <div key={activity.id} className="inline" style={{ alignItems: "flex-start" }}>
                          <div className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                            {titleCase(activity.entity_type).slice(0, 1)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>
                              {titleCase(activity.entity_type)} {activity.action}
                            </div>
                            <div className="hint">
                              {dateTime(activity.created_at)} · {relative(activity.created_at)} ago
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty title="Quiet in here" body="Changes to customers, plans and invoices appear here." />
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
