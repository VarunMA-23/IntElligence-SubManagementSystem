"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, titleCase } from "@/lib/api";

interface Family {
  id: string;
  name: string;
  alias: string;
  archived: boolean;
}

interface Product {
  id: string;
  family_id: string;
  name: string;
  alias: string;
  fee_type: string;
  archived: boolean;
}

interface Feature {
  id: string;
  name: string;
  code: string;
  feature_type: string;
  archived: boolean;
}

interface Metric {
  id: string;
  name: string;
  code: string;
  aggregation: string;
  field: string | null;
  segmentation_keys: string[];
  archived: boolean;
}

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount: { type: string; percentage?: string; amount?: string; currency?: string };
  reusable: boolean;
  redemption_count: number;
  redemption_limit: number | null;
  archived: boolean;
}

type Tab = "families" | "products" | "features" | "metrics" | "coupons";
type CreateType = "family" | "product" | "feature" | "metric" | "coupon";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "families", label: "Product families" },
  { id: "products", label: "Products" },
  { id: "features", label: "Features" },
  { id: "metrics", label: "Metrics" },
  { id: "coupons", label: "Coupons" },
];

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("families");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [create, setCreate] = useState<CreateType | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [familyResult, productResult, featureResult, metricResult, couponResult] = await Promise.all([
        apiFetch<{ data: Family[] }>("/product-families"),
        apiFetch<{ data: Product[] }>("/products?per_page=100"),
        apiFetch<{ data: Feature[] }>("/features"),
        apiFetch<{ data: Metric[] }>("/metrics"),
        apiFetch<{ data: Coupon[] }>("/coupons?per_page=100"),
      ]);
      setFamilies(familyResult.data);
      setProducts(productResult.data);
      setFeatures(featureResult.data);
      setMetrics(metricResult.data);
      setCoupons(couponResult.data);
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

  function openCreate(type: CreateType) {
    setForm(type === "metric" ? { aggregation: "COUNT" } : {});
    setError(null);
    setCreate(type);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!create) return;
    setSaving(true);
    setError(null);
    try {
      let path = "";
      let payload: Record<string, unknown> = {};
      if (create === "family") {
        path = "/product-families";
        payload = { name: form.name, alias: form.alias };
      } else if (create === "product") {
        path = "/products";
        payload = {
          family_id: form.family_id,
          name: form.name,
          alias: form.alias,
          fee_type: form.fee_type,
          description: form.description || null,
        };
      } else if (create === "feature") {
        path = "/features";
        payload = { name: form.name, code: form.code, feature_type: form.feature_type };
      } else if (create === "metric") {
        path = "/metrics";
        payload = {
          name: form.name,
          code: form.code,
          aggregation: form.aggregation,
          field: form.aggregation === "COUNT" ? null : form.field || null,
          segmentation_keys: form.segmentation_keys
            ? form.segmentation_keys.split(",").map((value) => value.trim()).filter(Boolean)
            : [],
        };
      } else {
        path = "/coupons";
        payload = {
          code: form.code,
          description: form.description || null,
          discount:
            form.discount_type === "FIXED"
              ? { type: "FIXED", currency: form.currency || "USD", amount: form.amount }
              : { type: "PERCENTAGE", percentage: form.percentage },
          reusable: form.reusable === "true",
          redemption_limit: form.redemption_limit ? Number(form.redemption_limit) : null,
        };
      }
      await apiFetch(path, { method: "POST", body: JSON.stringify(payload) });
      setToast(`${titleCase(create)} created`);
      setCreate(null);
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  const familyNames = new Map(families.map((family) => [family.id, family.name]));

  return (
    <Shell>
      <PageHeader
        title="Catalog"
        sub="The building blocks for plans: families, products, features, metrics and discounts."
        actions={
          <button className="btn primary" onClick={() => openCreate(tab === "families" ? "family" : tab === "products" ? "product" : tab === "features" ? "feature" : tab === "metrics" ? "metric" : "coupon")}>
            + New {tab === "families" ? "family" : tab.slice(0, -1)}
          </button>
        }
      />

      <div className="tabs">
        {TABS.map((item) => (
          <button key={item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {error && !create ? <ErrorBox error={error} /> : null}
      {loading ? <Loading label="Loading catalog" /> : null}

      {!loading && tab === "families" ? (
        <div className="grid cols-3">
          {families.map((family) => (
            <div className="card pad" key={family.id}>
              <div className="spread">
                <div className="brand-mark" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>◈</div>
                <StatusPill status="active" />
              </div>
              <h3 style={{ marginTop: 16, fontSize: 17 }}>{family.name}</h3>
              <div className="mono muted">{family.alias}</div>
              <div className="divider" />
              <div className="small muted">
                {products.filter((product) => product.family_id === family.id).length} products
              </div>
            </div>
          ))}
          {!families.length ? (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <Empty title="No product families" body="Families group products so plans stay tidy." action={<button className="btn primary" onClick={() => openCreate("family")}>Create family</button>} />
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === "products" ? (
        <div className="card">
          {products.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Family</th><th>Fee type</th><th>Alias</th><th>Status</th></tr></thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td className="table-title">{product.name}</td>
                      <td>{familyNames.get(product.family_id) ?? "—"}</td>
                      <td>{titleCase(product.fee_type)}</td>
                      <td className="mono">{product.alias}</td>
                      <td><StatusPill status="active" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No products yet" body="Create a product inside a family before composing a plan." action={<button className="btn primary" onClick={() => openCreate("product")}>Create product</button>} />
          )}
        </div>
      ) : null}

      {!loading && tab === "features" ? (
        <div className="grid cols-3">
          {features.map((feature) => (
            <div className="card pad" key={feature.id}>
              <div className="spread">
                <span className="pill trial_active">{titleCase(feature.feature_type)}</span>
                <span className="mono muted">{feature.code}</span>
              </div>
              <h3 style={{ marginTop: 14, fontSize: 17 }}>{feature.name}</h3>
              <div className="small muted" style={{ marginTop: 6 }}>
                Used in entitlements and plan access rules.
              </div>
            </div>
          ))}
          {!features.length ? (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <Empty title="No features" body="Add a feature flag or metered capability." action={<button className="btn primary" onClick={() => openCreate("feature")}>Create feature</button>} />
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === "metrics" ? (
        <div className="card">
          {metrics.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Metric</th><th>Code</th><th>Aggregation</th><th>Field</th><th>Segments</th></tr></thead>
                <tbody>
                  {metrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="table-title">{metric.name}</td>
                      <td className="mono">{metric.code}</td>
                      <td>{titleCase(metric.aggregation)}</td>
                      <td className="mono muted">{metric.field ?? "—"}</td>
                      <td>
                        <div className="chip-row">
                          {metric.segmentation_keys.length
                            ? metric.segmentation_keys.map((key) => <span className="chip" key={key}>{key}</span>)
                            : <span className="muted">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No metrics yet" body="Metrics define how raw events become billable usage." action={<button className="btn primary" onClick={() => openCreate("metric")}>Create metric</button>} />
          )}
        </div>
      ) : null}

      {!loading && tab === "coupons" ? (
        <div className="grid cols-3">
          {coupons.map((coupon) => (
            <div className="card pad" key={coupon.id}>
              <div className="spread">
                <div className="mono" style={{ fontSize: 17, fontWeight: 800 }}>{coupon.code}</div>
                <StatusPill status="active" />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 12 }}>
                {coupon.discount.type === "PERCENTAGE"
                  ? `${coupon.discount.percentage}% off`
                  : `${coupon.discount.amount} ${coupon.discount.currency} off`}
              </div>
              <div className="small muted" style={{ marginTop: 5 }}>{coupon.description ?? "No description"}</div>
              <div className="divider" />
              <div className="spread small">
                <span className="muted">{coupon.reusable ? "Reusable" : "Single use"}</span>
                <span>{coupon.redemption_count}{coupon.redemption_limit ? ` / ${coupon.redemption_limit}` : ""} redeemed</span>
              </div>
            </div>
          ))}
          {!coupons.length ? (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <Empty title="No coupons" body="Create a discount code for acquisition or win-back." action={<button className="btn primary" onClick={() => openCreate("coupon")}>Create coupon</button>} />
            </div>
          ) : null}
        </div>
      ) : null}

      {create ? (
        <Modal
          title={`New ${create}`}
          onClose={() => setCreate(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCreate(null)}>Cancel</button>
              <button className="btn primary" form="catalog-form" type="submit" disabled={saving}>{saving ? "Saving…" : "Create"}</button>
            </>
          }
        >
          <form id="catalog-form" className="form" onSubmit={submit}>
            <ErrorBox error={error} />
            {create === "family" ? (
              <div className="form-row">
                <div className="field"><label>Name</label><input className="input" value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
                <div className="field"><label>Alias</label><input className="input" value={form.alias ?? ""} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="cloud-platform" required /></div>
              </div>
            ) : null}
            {create === "product" ? (
              <>
                <div className="field">
                  <label>Product family</label>
                  <select className="input" value={form.family_id ?? ""} onChange={(event) => setForm({ ...form, family_id: event.target.value })} required>
                    <option value="">Select a family</option>
                    {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <div className="field"><label>Name</label><input className="input" value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
                  <div className="field"><label>Alias</label><input className="input" value={form.alias ?? ""} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="api-overage" required /></div>
                </div>
                <div className="field">
                  <label>Fee type</label>
                  <select className="input" value={form.fee_type ?? "USAGE"} onChange={(event) => setForm({ ...form, fee_type: event.target.value })}>
                    {["RATE", "SLOT", "CAPACITY", "USAGE", "EXTRA_RECURRING", "ONE_TIME"].map((type) => <option key={type}>{type}</option>)}
                  </select>
                </div>
              </>
            ) : null}
            {create === "feature" ? (
              <>
                <div className="form-row">
                  <div className="field"><label>Name</label><input className="input" value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
                  <div className="field"><label>Code</label><input className="input" value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="sso" required /></div>
                </div>
                <div className="field">
                  <label>Type</label>
                  <select className="input" value={form.feature_type ?? "BOOLEAN"} onChange={(event) => setForm({ ...form, feature_type: event.target.value })}>
                    <option>BOOLEAN</option><option>METERED</option>
                  </select>
                </div>
              </>
            ) : null}
            {create === "metric" ? (
              <>
                <div className="form-row">
                  <div className="field"><label>Name</label><input className="input" value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
                  <div className="field"><label>Code</label><input className="input" value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="api_requests" required /></div>
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>Aggregation</label>
                    <select className="input" value={form.aggregation ?? "COUNT"} onChange={(event) => setForm({ ...form, aggregation: event.target.value })}>
                      {["COUNT", "LATEST", "MAX", "MIN", "MEAN", "SUM", "COUNT_DISTINCT"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Value field {form.aggregation === "COUNT" ? "(not used)" : ""}</label>
                    <input className="input" value={form.field ?? ""} disabled={form.aggregation === "COUNT"} onChange={(event) => setForm({ ...form, field: event.target.value })} placeholder="tokens" />
                  </div>
                </div>
                <div className="field">
                  <label>Segmentation keys</label>
                  <input className="input" value={form.segmentation_keys ?? ""} onChange={(event) => setForm({ ...form, segmentation_keys: event.target.value })} placeholder="endpoint, region" />
                  <div className="hint">Comma-separated. Used to group usage breakdowns.</div>
                </div>
              </>
            ) : null}
            {create === "coupon" ? (
              <>
                <div className="form-row">
                  <div className="field"><label>Code</label><input className="input" value={form.code ?? ""} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="LAUNCH20" required /></div>
                  <div className="field">
                    <label>Discount type</label>
                    <select className="input" value={form.discount_type ?? "PERCENTAGE"} onChange={(event) => setForm({ ...form, discount_type: event.target.value })}>
                      <option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option>
                    </select>
                  </div>
                </div>
                {form.discount_type === "FIXED" ? (
                  <div className="form-row">
                    <div className="field"><label>Amount</label><input className="input" value={form.amount ?? ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="25.00" required /></div>
                    <div className="field"><label>Currency</label><input className="input" value={form.currency ?? "USD"} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></div>
                  </div>
                ) : (
                  <div className="field"><label>Percentage</label><input className="input" value={form.percentage ?? ""} onChange={(event) => setForm({ ...form, percentage: event.target.value })} placeholder="20" required /></div>
                )}
                <div className="form-row">
                  <div className="field"><label>Redemption limit (optional)</label><input className="input" type="number" min={1} value={form.redemption_limit ?? ""} onChange={(event) => setForm({ ...form, redemption_limit: event.target.value })} /></div>
                  <div className="field">
                    <label>Reuse</label>
                    <select className="input" value={form.reusable ?? "false"} onChange={(event) => setForm({ ...form, reusable: event.target.value })}>
                      <option value="false">Single use</option><option value="true">Reusable</option>
                    </select>
                  </div>
                </div>
                <div className="field"><label>Description</label><textarea className="input" value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
              </>
            ) : null}
          </form>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
