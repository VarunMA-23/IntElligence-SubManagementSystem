import { test, expect } from "@playwright/test";

test.describe("Dashboard and navigation", () => {
  /**
   * Helper: creates a user + org via API, then sets the session cookie/localStorage
   * so the browser is authenticated without going through the login UI.
   */
  async function authenticateViaApi(request: any, page: any) {
    const ts = Date.now();
    const email = `e2e-dash-${ts}@brightloop.test`;
    const password = "E2ePassword1!";
    const API = "http://localhost:8080/api/v1/auth";

    const reg = await request.post(`${API}/register`, { data: { email, password, name: "Dash User" } });
    const { verification_token_hint: token } = await reg.json() as { verification_token_hint: string };
    await request.post(`${API}/verify-email`, { data: { token } });
    const login = await request.post(`${API}/login`, { data: { email, password } });
    const { access_token: accessToken } = await login.json() as { access_token: string };

    // Create org
    const orgRes = await request.post(`${API}/organizations`, {
      data: { name: "Dash Org", slug: `dash-org-${ts}` },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const orgBody = await orgRes.json() as { access_token: string; tenant: { id: string } };

    // Inject session into browser localStorage (matches what the web app uses)
    await page.goto("/login");
    await page.evaluate((session: { access_token: string; tenant_id: string }) => {
      localStorage.setItem("bl_session", JSON.stringify(session));
    }, { access_token: orgBody.access_token, tenant_id: orgBody.tenant.id });
  }

  test("authenticated user sees dashboard page", async ({ page, request }) => {
    await authenticateViaApi(request, page);
    await page.goto("/dashboard");
    // Dashboard should load (not redirect to login)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });
    await expect(page.locator("body")).toBeVisible();
  });

  test("unauthenticated user is redirected to login from dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test("customers page is accessible when authenticated", async ({ page, request }) => {
    await authenticateViaApi(request, page);
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/customers/, { timeout: 8000 });
    await expect(page.locator("body")).toBeVisible();
  });

  test("invoices page is accessible when authenticated", async ({ page, request }) => {
    await authenticateViaApi(request, page);
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices/, { timeout: 8000 });
  });

  test("plans page is accessible when authenticated", async ({ page, request }) => {
    await authenticateViaApi(request, page);
    await page.goto("/plans");
    await expect(page).toHaveURL(/\/plans/, { timeout: 8000 });
  });
});