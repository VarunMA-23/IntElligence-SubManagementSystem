import { test, expect } from "@playwright/test";

test.describe("Authentication flow", () => {
  test("login page loads and shows form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator("input[type=email], input[name=email]")).toBeVisible();
    await expect(page.locator("input[type=password]")).toBeVisible();
    await expect(page.locator("button[type=submit]")).toBeVisible();
  });

  test("register page loads and shows form", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator("form")).toBeVisible();
    await expect(page.locator("input[type=email], input[name=email]")).toBeVisible();
    await expect(page.locator("input[type=password]")).toBeVisible();
  });

  test("root page redirects to login when not authenticated", async ({ page }) => {
    await page.goto("/");
    // Should end up at /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows error on invalid login credentials", async ({ page }) => {
    await page.goto("/login");
    await page.locator("input[type=email], input[name=email]").fill("nobody@brightloop.test");
    await page.locator("input[type=password]").fill("wrongpassword");
    await page.locator("button[type=submit]").click();
    // Wait for error message to appear
    await expect(page.locator("[class*=error], [role=alert], [class*=Error]")).toBeVisible({ timeout: 5000 });
  });

  test("full register → verify → login → dashboard flow", async ({ page, request }) => {
    const ts = Date.now();
    const email = `e2e-auth-${ts}@brightloop.test`;
    const password = "E2ePassword1!";

    // Register via API (faster than UI form)
    const reg = await request.post("http://localhost:8080/api/v1/auth/register", {
      data: { email, password, name: "E2E Auth User" },
    });
    expect(reg.status()).toBe(201);
    const { verification_token_hint: token } = await reg.json() as { verification_token_hint: string };

    // Verify email via API
    await request.post("http://localhost:8080/api/v1/auth/verify-email", {
      data: { token },
    });

    // Login via UI
    await page.goto("/login");
    await page.locator("input[type=email], input[name=email]").fill(email);
    await page.locator("input[type=password]").fill(password);
    await page.locator("button[type=submit]").click();

    // Should redirect to onboarding (no org yet) or dashboard
    await expect(page).toHaveURL(/\/(onboarding|dashboard)/, { timeout: 10000 });
  });

  test("verify-email page loads", async ({ page }) => {
    await page.goto("/verify-email");
    // Should show some content (verification form or message)
    await expect(page.locator("body")).toBeVisible();
  });
});