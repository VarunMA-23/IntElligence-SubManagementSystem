export function AuthArt() {
  return (
    <section className="auth-art">
      <div className="auth-brand brand on-dark">
        <span className="brand-mark">B</span>
        <span>BrightLoop</span>
      </div>
      <div className="auth-copy">
        <h1>
          Billing that
          <br />
          keeps up with
          <br />
          <span>your usage.</span>
        </h1>
        <p>
          Customers, plans, metered events, invoices and webhooks in one calm control room. Built for
          teams who price by what people actually use.
        </p>
        <div className="auth-badges">
          <span>Usage metering</span>
          <span>Recurring invoices</span>
          <span>Credit notes</span>
          <span>Signed webhooks</span>
          <span>Audit trail</span>
        </div>
      </div>
      <div className="auth-foot">BrightLoop · usage billing without the busywork</div>
    </section>
  );
}
