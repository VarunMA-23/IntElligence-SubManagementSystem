"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { apiFetch, getSession, logout, setSession, type Session } from "@/lib/api";

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  currency: string;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  tenants: TenantInfo[];
}

const navigation = [
  {
    group: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid" },
      { href: "/customers", label: "Customers", icon: "users" },
      { href: "/subscriptions", label: "Subscriptions", icon: "repeat" },
      { href: "/invoices", label: "Invoices", icon: "file" },
      { href: "/usage", label: "Usage", icon: "activity" },
    ],
  },
  {
    group: "Configure",
    items: [
      { href: "/catalog", label: "Catalog", icon: "box" },
      { href: "/plans", label: "Plans", icon: "tag" },
      { href: "/webhooks", label: "Webhooks", icon: "webhook" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

const paths: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 15.4c1.8.5 3 1.9 3 4.6" /></>,
  repeat: <><path d="M4 9a5 5 0 0 1 5-5h9l-2.5-2.5M20 15a5 5 0 0 1-5 5H6l2.5 2.5" /><path d="M17 4l2.5 2.5M7 20l-2.5-2.5" /></>,
  file: <><path d="M6 2.8h8l4 4V21H6z" /><path d="M14 2.8V7h4M9 12h6M9 16h6" /></>,
  activity: <path d="M3 12h4l2.5-7 4 14 2.5-7h5" />,
  box: <><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>,
  tag: <><path d="M3 11V4h7l10 10-7 7z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  webhook: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><circle cx="12" cy="5" r="2.5" /><path d="M10.5 7.2 7 15.8M13.5 7.2 17 15.8M8.5 18h7" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setLocalSession] = useState<Session | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = getSession();
    if (!current) {
      router.replace("/login");
      return;
    }
    setLocalSession(current);
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!session?.org_id) return;
    apiFetch<OrgInfo>(`/organizations/${session.org_id}`)
      .then(setOrg)
      .catch(() => setOrg(null));
  }, [session?.org_id]);

  async function switchTenant(event: React.ChangeEvent<HTMLSelectElement>) {
    const tenantId = event.target.value;
    if (!session || tenantId === session.tenant_id) return;
    const switched = await apiFetch<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      tenant_id: string;
    }>("/auth/switch-tenant", {
      method: "POST",
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    const next: Session = {
      ...session,
      access_token: switched.access_token,
      refresh_token: switched.refresh_token,
      expires_in: switched.expires_in,
      tenant_id: switched.tenant_id ?? tenantId,
    };
    setSession(next);
    setLocalSession(next);
    window.location.reload();
  }

  function signOut() {
    logout();
    router.replace("/login");
  }

  if (!ready || !session) {
    return (
      <div className="empty" style={{ minHeight: "100vh", display: "grid", placeContent: "center" }}>
        <div className="brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark">B</span> BrightLoop
        </div>
        <div className="muted" style={{ marginTop: 12 }}>Opening your workspace…</div>
      </div>
    );
  }

  const activeTenant = org?.tenants.find((tenant) => tenant.id === session.tenant_id);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand on-dark">
          <span className="brand-mark">B</span>
          <span>BrightLoop</span>
        </Link>

        {navigation.map((section) => (
          <div key={section.group}>
            <div className="nav-group">{section.group}</div>
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="sidebar-foot">
          {org && org.tenants.length > 1 ? (
            <label className="stack" style={{ marginBottom: 12 }}>
              <span className="nav-group" style={{ padding: 0 }}>Workspace</span>
              <select
                className="input"
                style={{ background: "#1a293c", color: "#fff", borderColor: "#2c3d53" }}
                value={session.tenant_id ?? ""}
                onChange={switchTenant}
              >
                {org.tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="nav-group" style={{ padding: "0 0 7px" }}>
              {activeTenant?.name ?? org?.name ?? "Workspace"}
            </div>
          )}
          <div className="sidebar-user">
            <div className="avatar">{initials(session.user.name || session.user.email)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="name">{session.user.name}</div>
              <div className="email">{session.user.email}</div>
            </div>
          </div>
          <button className="nav-link" style={{ width: "100%", border: 0, background: "transparent" }} onClick={signOut}>
            <span className="nav-icon">↪</span> Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
