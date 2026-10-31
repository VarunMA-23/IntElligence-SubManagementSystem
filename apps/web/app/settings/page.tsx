"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { ErrorBox, Loading, Modal, PageHeader, StatusPill, Toast } from "@/components/ui";
import { apiFetch, date, getSession, titleCase } from "@/lib/api";

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  tenants: Array<{ id: string; name: string; slug: string; currency: string }>;
}

interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  role: string;
  last_used_at: string | null;
  created_at: string;
}

interface Entity {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  default_currency: string;
  net_terms: number;
  is_default: boolean;
}

export default function SettingsPage() {
  const session = getSession();
  const orgId = session?.org_id ?? "";
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [orgForm, setOrgForm] = useState({ name: "", slug: "" });
  const [tenantForm, setTenantForm] = useState({ name: "", currency: "USD" });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "member" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenForm, setTokenForm] = useState({ name: "", role: "member" });
  const [tokenValue, setTokenValue] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orgResult, memberResult, inviteResult, tokenResult, entityResult] = await Promise.all([
        apiFetch<Organization>(`/organizations/${orgId}`),
        apiFetch<{ data: Member[] }>(`/organizations/${orgId}/members`),
        apiFetch<{ data: Invite[] }>(`/organizations/${orgId}/invites`),
        apiFetch<{ data: ApiToken[] }>("/api-tokens"),
        apiFetch<{ data: Entity[] }>("/invoicing-entities"),
      ]);
      setOrg(orgResult);
      setOrgForm({ name: orgResult.name, slug: orgResult.slug });
      const tenant = orgResult.tenants[0];
      if (tenant) setTenantForm({ name: tenant.name, currency: tenant.currency });
      setMembers(memberResult.data);
      setInvites(inviteResult.data);
      setTokens(tokenResult.data);
      setEntities(entityResult.data);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function saveOrganization(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/organizations/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: orgForm.name, slug: orgForm.slug }),
      });
      setToast("Organization updated");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function saveTenant(event: React.FormEvent) {
    event.preventDefault();
    if (!org?.tenants[0]) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/tenants/${org.tenants[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: tenantForm.name, currency: tenantForm.currency }),
      });
      setToast("Workspace updated");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<{ invite_token: string }>(`/organizations/${orgId}/invites`, {
        method: "POST",
        body: JSON.stringify(inviteForm),
      });
      setInviteOpen(false);
      setInviteLink(created.invite_token);
      setInviteForm({ email: "", role: "member" });
      setToast("Invite created");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvite(invite: Invite) {
    try {
      await apiFetch(`/organizations/${orgId}/invites/${invite.id}`, { method: "DELETE" });
      setToast("Invite revoked");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  async function changeRole(member: Member, role: string) {
    try {
      await apiFetch(`/organizations/${orgId}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setToast("Role updated");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.email} from the organization?`)) return;
    try {
      await apiFetch(`/organizations/${orgId}/members/${member.id}`, { method: "DELETE" });
      setToast("Member removed");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<{ token: string }>("/api-tokens", {
        method: "POST",
        body: JSON.stringify(tokenForm),
      });
      setTokenOpen(false);
      setTokenValue(created.token);
      setTokenForm({ name: "", role: "member" });
      setToast("API token created");
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function revokeToken(token: ApiToken) {
    if (!window.confirm(`Revoke ${token.name}? Applications using it will fail immediately.`)) return;
    try {
      await apiFetch(`/api-tokens/${token.id}`, { method: "DELETE" });
      setToast("Token revoked");
      await load();
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <Shell>
      <PageHeader title="Settings" sub="Organization, workspace, team access and API credentials." />

      {!orgId ? <ErrorBox error={new Error("Create or select an organization first.")} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {loading ? <Loading label="Loading settings" /> : null}

      {!loading && org ? (
        <div className="stack">
          <div className="grid cols-2">
            <form className="card" onSubmit={saveOrganization}>
              <div className="card-head"><h3>Organization</h3><span className="pill neutral">Owner workspace</span></div>
              <div className="card-body form">
                <div className="field"><label>Name</label><input className="input" value={orgForm.name} onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })} required /></div>
                <div className="field"><label>Slug</label><input className="input mono" value={orgForm.slug} onChange={(event) => setOrgForm({ ...orgForm, slug: event.target.value })} required /></div>
                <div className="small muted">Created {date(org.created_at)}</div>
                <div><button className="btn primary" type="submit" disabled={saving}>Save organization</button></div>
              </div>
            </form>

            <form className="card" onSubmit={saveTenant}>
              <div className="card-head"><h3>Workspace</h3><span className="pill neutral">{org.tenants.length} tenant{org.tenants.length === 1 ? "" : "s"}</span></div>
              <div className="card-body form">
                <div className="field"><label>Workspace name</label><input className="input" value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} required /></div>
                <div className="field">
                  <label>Reporting currency</label>
                  <select className="input" value={tenantForm.currency} onChange={(event) => setTenantForm({ ...tenantForm, currency: event.target.value })}>
                    {["USD", "EUR", "GBP", "CAD", "AUD", "INR", "SGD"].map((code) => <option key={code}>{code}</option>)}
                  </select>
                </div>
                <div className="small muted">Subscriptions and invoices are issued in this currency unless overridden.</div>
                <div><button className="btn primary" type="submit" disabled={saving}>Save workspace</button></div>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Team</h3>
              <button className="btn sm" onClick={() => setInviteOpen(true)}>+ Invite member</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th /></tr></thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <div className="table-title">{member.name || member.email}</div>
                        <div className="table-sub">{member.email}</div>
                      </td>
                      <td>
                        <select className="input" style={{ maxWidth: 130, padding: "6px 10px" }} value={member.role} onChange={(event) => changeRole(member, event.target.value)}>
                          {["owner", "admin", "member", "viewer"].map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}
                        </select>
                      </td>
                      <td className="small">{date(member.joined_at)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn sm ghost danger" onClick={() => removeMember(member)} disabled={member.id === session?.user.id}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invites.length ? (
              <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="label small muted" style={{ marginBottom: 10 }}>Pending invites</div>
                <div className="stack sm">
                  {invites.map((invite) => (
                    <div className="spread" key={invite.id}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{invite.email}</div>
                        <div className="small muted">{titleCase(invite.role)} · expires {date(invite.expires_at)}</div>
                      </div>
                      <button className="btn sm ghost danger" onClick={() => revokeInvite(invite)}>Revoke</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid cols-2">
            <div className="card">
              <div className="card-head"><h3>API tokens</h3><button className="btn sm" onClick={() => setTokenOpen(true)}>+ New token</button></div>
              <div className="card-body stack sm">
                {tokens.length ? tokens.map((token) => (
                  <div className="spread" key={token.id}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{token.name}</div>
                      <div className="small muted mono">{token.prefix}… · {titleCase(token.role)} · {token.last_used_at ? `used ${date(token.last_used_at)}` : "never used"}</div>
                    </div>
                    <button className="btn sm ghost danger" onClick={() => revokeToken(token)}>Revoke</button>
                  </div>
                )) : <div className="small muted">No API tokens. Use them for server-to-server metering.</div>}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Invoicing entities</h3><span className="pill neutral">{entities.length}</span></div>
              <div className="card-body stack sm">
                {entities.length ? entities.map((entity) => (
                  <div key={entity.id}>
                    <div className="spread">
                      <div style={{ fontWeight: 600 }}>{entity.name}</div>
                      <StatusPill status={entity.is_default ? "ACTIVE" : "PAUSED"} />
                    </div>
                    <div className="small muted">{entity.legal_name ?? "No legal name"} · {entity.default_currency} · net {entity.net_terms}</div>
                  </div>
                )) : <div className="small muted">No invoicing entity configured for this workspace.</div>}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {inviteOpen ? (
        <Modal
          title="Invite a member"
          subtitle="Invites expire after seven days. Share the generated token directly."
          onClose={() => setInviteOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button className="btn primary" form="invite-form" type="submit" disabled={saving}>{saving ? "Inviting…" : "Create invite"}</button>
            </>
          }
        >
          <form id="invite-form" className="form" onSubmit={invite}>
            <ErrorBox error={error} />
            <div className="field"><label>Email</label><input className="input" type="email" value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} required /></div>
            <div className="field">
              <label>Role</label>
              <select className="input" value={inviteForm.role} onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value })}>
                {["admin", "member", "viewer"].map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      ) : null}

      {inviteLink ? (
        <Modal title="Invite token" subtitle="The recipient can accept this from the register flow." onClose={() => setInviteLink(null)} footer={<button className="btn primary" onClick={() => setInviteLink(null)}>Done</button>}>
          <textarea className="input mono" readOnly rows={3} value={inviteLink} />
        </Modal>
      ) : null}

      {tokenOpen ? (
        <Modal
          title="New API token"
          subtitle="Tokens inherit a fixed role and can never be shown again."
          onClose={() => setTokenOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setTokenOpen(false)}>Cancel</button>
              <button className="btn primary" form="token-form" type="submit" disabled={saving}>{saving ? "Creating…" : "Create token"}</button>
            </>
          }
        >
          <form id="token-form" className="form" onSubmit={createToken}>
            <ErrorBox error={error} />
            <div className="field"><label>Name</label><input className="input" value={tokenForm.name} onChange={(event) => setTokenForm({ ...tokenForm, name: event.target.value })} placeholder="Production metering" required /></div>
            <div className="field">
              <label>Role</label>
              <select className="input" value={tokenForm.role} onChange={(event) => setTokenForm({ ...tokenForm, role: event.target.value })}>
                {["admin", "member", "viewer"].map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}
              </select>
            </div>
          </form>
        </Modal>
      ) : null}

      {tokenValue ? (
        <Modal title="API token" subtitle="Copy it now. Only the prefix is stored." onClose={() => setTokenValue(null)} footer={<button className="btn primary" onClick={() => setTokenValue(null)}>Done</button>}>
          <div className="stack">
            <div className="callout"><div className="callout-icon">!</div><div>Send it as <span className="mono">Authorization: Bearer &lt;token&gt;</span>.</div></div>
            <textarea className="input mono" readOnly rows={3} value={tokenValue} />
          </div>
        </Modal>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Shell>
  );
}
