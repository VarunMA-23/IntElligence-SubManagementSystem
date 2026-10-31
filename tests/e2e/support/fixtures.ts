import { test as base, expect } from "@playwright/test";

/**
 * Extended test fixture with a reusable API helper for creating
 * tenant sessions during E2E tests, without going through the UI.
 */
export interface ApiSession {
  accessToken: string;
  tenantId: string;
  orgId: string;
}

async function createApiSession(baseURL: string, suffix: string): Promise<ApiSession> {
  const email = `e2e-${suffix}-${Date.now()}@brightloop.test`;
  const password = "E2ePassword1!";

  const reg = await fetch(`${baseURL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "E2E User" }),
  });
  const regBody = await reg.json() as { verification_token_hint: string };

  await fetch(`${baseURL}/api/v1/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: regBody.verification_token_hint }),
  });

  const login = await fetch(`${baseURL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json() as { access_token: string };

  const org = await fetch(`${baseURL}/api/v1/auth/organizations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${loginBody.access_token}`,
    },
    body: JSON.stringify({ name: "E2E Org", slug: `e2e-org-${Date.now()}` }),
  });
  const orgBody = await org.json() as {
    access_token: string;
    tenant: { id: string };
    organization: { id: string };
  };

  return {
    accessToken: orgBody.access_token,
    tenantId: orgBody.tenant.id,
    orgId: orgBody.organization.id,
  };
}

// Extended test with api session fixture
export const test = base.extend<{ apiSession: ApiSession }>({
  apiSession: async ({ baseURL }, use) => {
    const session = await createApiSession(baseURL ?? "http://localhost:8080", "fixture");
    await use(session);
  },
});

export { expect };
