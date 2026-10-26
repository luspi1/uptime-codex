import { expect, test } from "@playwright/test";

test("profile menu logs out and keeps the login page after reload", async ({ page }) => {
  let signedOut = false;
  let logoutRequests = 0;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/logout")) {
      expect(route.request().method()).toBe("POST");
      logoutRequests += 1;
      // Hold the response so the pending state can be checked.
      await new Promise((resolve) => setTimeout(resolve, 300));
      signedOut = true;
      await route.fulfill({ status: 204 });
    } else if (signedOut) {
      await route.fulfill({ status: 401, json: { error: { code: "invalid_token", message: "Session ended" } } });
    } else if (path.endsWith("/refresh")) {
      await route.fulfill({ json: {
        user: { id: 1, email: "user@example.com", name: "" },
        access_token: "test-access", token_type: "Bearer", expires_in: 900,
      } });
    } else {
      await route.fulfill({ json: { id: 1, email: "user@example.com", name: "" } });
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Профиль пользователя" })).toBeVisible();
  const profile = page.locator("summary");
  await profile.click();
  await expect(page.getByRole("navigation").getByText("user@example.com")).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard-profile-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeHidden();
  await expect(profile).toBeFocused();
  await profile.click();
  await page.getByText("Uptime App", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeHidden();
  await profile.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выходим…" })).toBeDisabled();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  expect(logoutRequests).toBe(1);
  await expect(page.getByRole("navigation", { name: "Профиль пользователя" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("failed logout stays on the dashboard and allows retry on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let logoutRequests = 0;
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/logout")) {
      logoutRequests += 1;
      if (logoutRequests === 1) {
        await route.abort("failed");
      } else {
        await route.fulfill({ status: 204 });
      }
    } else if (path.endsWith("/refresh")) {
      await route.fulfill({ json: {
        user: { id: 1, email: "user@example.com", name: "" },
        access_token: "test-access", token_type: "Bearer", expires_in: 900,
      } });
    } else {
      await route.fulfill({ json: { id: 1, email: "user@example.com", name: "" } });
    }
  });

  await page.goto("/");
  await page.locator("summary").click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("navigation").getByRole("alert")).toHaveText("Не удалось выйти. Проверьте соединение и повторите попытку.");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Выйти", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/dashboard-profile-mobile.png" });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
  expect(logoutRequests).toBe(2);
});
