"use client";
import { useEffect, type ReactNode } from "react";
import { titleCase } from "@/lib/api";

export function StatusPill({ status }: { status: string | null | undefined }) {
  const value = (status ?? "neutral").toLowerCase();
  return <span className={`pill ${value}`}>{titleCase(status ?? "Unknown")}</span>;
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="hint" style={{ marginTop: 5 }}>{subtitle}</div> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toast({ message, tone = "ok" }: { message: string; tone?: "ok" | "error" }) {
  return <div className={`toast ${tone === "error" ? "error" : ""}`}>{message}</div>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <div>{body}</div>
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="empty">
      <div className="spin" style={{ borderTopColor: "var(--blue)", borderColor: "var(--line)" }} />
      <div style={{ marginTop: 10 }}>{label}…</div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <div className="error-box">{message}</div>;
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return <div className="success-box">{children}</div>;
}

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="top-actions">{actions}</div> : null}
    </div>
  );
}
