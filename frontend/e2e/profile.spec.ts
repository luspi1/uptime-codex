import { expect, test } from "@playwright/test";

test("avatar previews before save, retries failure and persists throughout the app", async ({ page }) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=", "base64");
  let user = { id: 1, email: "user@example.com", name: "", avatar_url: "" };
  let uploads = 0;
  await page.route("**/api/auth/**", async (route) => {
    if (route.request().url().includes("/avatars/")) {
      await route.fulfill({ contentType: "image/png", body: png });
    } else if (route.request().method() === "PATCH") {
      uploads += 1;
      expect(route.request().headers().authorization).toBe("Bearer test-access");
      expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
      expect(route.request().postDataBuffer()?.includes(png)).toBe(true);
      if (uploads === 1) {
        await route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Save failed" } } });
      } else {
        user = { ...user, avatar_url: "/api/auth/avatars/" + "a".repeat(32) + ".png" };
        await route.fulfill({ json: user });
      }
    } else if (route.request().url().endsWith("/refresh")) {
      await route.fulfill({ json: { user, access_token: "test-access", token_type: "Bearer", expires_in: 900 } });
    } else {
      await route.fulfill({ json: user });
    }
  });
  await page.goto("/profile");
  const input = page.getByLabel("Загрузить аватар");
  await input.setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("bad") });
  await expect(page.locator("form").getByRole("alert")).toContainText("PNG или JPEG");
  await expect(page.getByText("Файл не выбран", { exact: true })).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Загрузить аватар" }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("avatar.png", { exact: true })).toBeVisible();
  const preview = page.locator("form").getByRole("img", { name: "Аватар пользователя" });
  await expect(preview).toHaveAttribute("src", /^blob:/);
  expect(uploads).toBe(0);
  await expect(page.locator("header img")).toHaveCount(0);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Не удалось сохранить");
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await input.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Профиль сохранён.");
  await expect(page.getByText("Файл не выбран", { exact: true })).toBeVisible();
  await expect(page.locator("header img")).toHaveAttribute("src", new RegExp(user.avatar_url + "$"));
  await expect(preview).toHaveAttribute("src", new RegExp(user.avatar_url + "$"));
  await expect(preview).toHaveJSProperty("naturalWidth", 1);
  await page.screenshot({ path: "test-results/avatar-desktop.png" });
  await page.getByRole("link", { name: "Uptime App" }).click();
  await expect(page.locator("header img")).toHaveAttribute("src", new RegExp(user.avatar_url + "$"));
  await page.reload();
  await expect(page.locator("header img")).toHaveAttribute("src", new RegExp(user.avatar_url + "$"));
  await page.goto("/profile");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(preview).toHaveAttribute("src", new RegExp(user.avatar_url + "$"));
  await page.screenshot({ path: "test-results/avatar-mobile.png" });
  expect(uploads).toBe(2);
});

test("profile saves name, handles failure and persists after reload", async ({ page }) => {
  let user = { id: 1, email: "user@example.com", name: "" };
  let failSave = true;
  let updates = 0;
  await page.route("**/api/auth/**", async (route) => {
    if (route.request().method() === "PATCH") {
      updates += 1;
      expect(route.request().headers().authorization).toBe("Bearer test-access");
      if (failSave) {
        failSave = false;
        await route.abort("failed");
      } else {
        user = { ...user, ...route.request().postDataJSON() };
        await route.fulfill({ json: user });
      }
    } else if (route.request().url().endsWith("/refresh")) {
      await route.fulfill({ json: { user, access_token: "test-access", token_type: "Bearer", expires_in: 900 } });
    } else {
      await route.fulfill({ json: user });
    }
  });
  await page.goto("/");
  await page.locator("summary").click();
  await page.getByRole("link", { name: "Мой профиль" }).click();
  await expect(page).toHaveURL("/profile");
  await expect(page.getByLabel("Email")).toHaveValue(user.email);
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  const name = page.getByLabel("Имя пользователя");
  await name.fill("   ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("от 1 до 100");
  expect(updates).toBe(0);
  await name.fill("  Анна Иванова  ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Не удалось сохранить");
  await expect(name).toHaveValue("  Анна Иванова  ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Профиль сохранён.");
  await page.locator("summary").click();
  await expect(page.getByRole("navigation").getByText("Анна Иванова")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/profile-desktop.png" });
  await page.reload();
  await expect(name).toHaveValue("Анна Иванова");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/profile-mobile.png" });
  expect(updates).toBe(2);
});

test("anonymous user opening profile is redirected to login", async ({ page }) => {
  await page.route("**/api/auth/**", (route) => route.fulfill({
    status: 401, json: { error: { code: "invalid_token", message: "Session ended" } },
  }));
  await page.goto("/profile");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { name: "Войти в аккаунт" })).toBeVisible();
});
