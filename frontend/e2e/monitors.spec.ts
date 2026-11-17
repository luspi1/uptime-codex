import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`create monitor, retry and reload on ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 375, height: 812 });
    const items: { id: number; url: string; interval_minutes: number; created_at: string }[] = [];
    let posts = 0;
    await page.route("**/api/auth/**", async (route) => {
      const user = { id: 1, email: "user@example.com", name: "" };
      await route.fulfill({ json: route.request().url().endsWith("/refresh") ? {
        user, access_token: "test-access", token_type: "Bearer", expires_in: 900,
      } : user });
    });
    await page.route("**/api/monitors", async (route) => {
      expect(route.request().headers().authorization).toBe("Bearer test-access");
      if (route.request().method() === "GET") return route.fulfill({ json: items });
      posts += 1;
      expect(route.request().postDataJSON()).toEqual({ url: "https://example.com/health", interval_minutes: 7 });
      if (posts === 1) return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Error" } } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const item = { id: 1, ...route.request().postDataJSON(), created_at: "2026-10-26T12:00:00Z" };
      items.push(item);
      await route.fulfill({ status: 201, json: item });
    });
    await page.goto("/");
    await expect(page.getByText("Пока нет сайтов.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Добавить сайт", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(page.getByLabel("URL сайта")).toBeFocused();
    await page.getByLabel("URL сайта").fill("ftp://example.com");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("HTTP или HTTPS");
    expect(posts).toBe(0);
    await page.getByLabel("URL сайта").fill("https://example.com/health");
    await page.getByLabel("Частота опроса (минуты)").fill("0");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    expect(posts).toBe(0);
    await page.getByLabel("Частота опроса (минуты)").fill("7");
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Не удалось создать");
    await expect(page.getByLabel("URL сайта")).toHaveValue("https://example.com/health");
    await page.screenshot({ path: `test-results/monitor-form-${mobile ? "mobile" : "desktop"}.png` });
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(page.getByRole("button", { name: "Создаём…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("list", { name: "Точки мониторинга" })).toContainText("https://example.com/health");
    await expect(page.getByText("Частота опроса: 7 мин.")).toBeVisible();
    await expect(page.getByText("Ещё не проверялся")).toBeVisible();
    expect(posts).toBe(2);
    await page.reload();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("https://example.com/health", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/monitor-created-${mobile ? "mobile" : "desktop"}.png` });
    await page.getByRole("button", { name: "Добавить сайт", exact: true }).click();
    await page.getByLabel("URL сайта").fill("https://cancelled.example.com");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(posts).toBe(2);
  });
}

test("failed list load allows retry", async ({ page }) => {
  await page.route("**/api/auth/**", (route) => route.fulfill({ json: route.request().url().endsWith("/refresh") ? {
    user: { id: 1, email: "user@example.com", name: "" }, access_token: "test-access", token_type: "Bearer", expires_in: 900,
  } : { id: 1, email: "user@example.com", name: "" } }));
  let fail = true;
  await page.route("**/api/monitors", (route) => fail ? route.abort("failed") : route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось загрузить сайты" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByText("Пока нет сайтов.", { exact: false })).toBeVisible();
});

for (const mobile of [false, true]) {
  test(`edit and delete monitor on ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 375, height: 812 });
    let items = [{ id: 1, url: "https://example.com", interval_minutes: 5, created_at: "2026-10-26T12:00:00Z" }];
    let updates = 0;
    let deletes = 0;
    await page.route("**/api/auth/**", (route) => route.fulfill({ json: route.request().url().endsWith("/refresh") ? {
      user: { id: 1, email: "user@example.com", name: "" }, access_token: "test-access", token_type: "Bearer", expires_in: 900,
    } : { id: 1, email: "user@example.com", name: "" } }));
    await page.route("**/api/monitors", (route) => route.fulfill({ json: items }));
    await page.route("**/api/monitors/1", async (route) => {
      expect(route.request().headers().authorization).toBe("Bearer test-access");
      if (route.request().method() === "PUT") {
        updates += 1;
        expect(route.request().postDataJSON()).toEqual({ url: "https://updated.example.com", interval_minutes: 12 });
        if (updates === 1) return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Error" } } });
        await new Promise((resolve) => setTimeout(resolve, 300));
        items[0] = { ...items[0], ...route.request().postDataJSON() };
        return route.fulfill({ json: items[0] });
      }
      expect(route.request().method()).toBe("DELETE");
      deletes += 1;
      if (deletes === 1) return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Error" } } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      items = [];
      return route.fulfill({ status: 204 });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Редактировать сайт" });
    await expect(editDialog.getByLabel("URL сайта")).toHaveValue("https://example.com");
    await editDialog.getByLabel("URL сайта").fill("https://cancelled.example.com");
    await editDialog.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(updates).toBe(0);
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    await expect(editDialog.getByLabel("URL сайта")).toHaveValue("https://example.com");
    await editDialog.getByLabel("URL сайта").fill("https://updated.example.com");
    await editDialog.getByLabel("Частота опроса (минуты)").fill("12");
    await editDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(editDialog.getByRole("alert")).toContainText("Не удалось сохранить");
    await expect(page.getByRole("listitem")).toContainText("https://example.com");
    await editDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(editDialog.getByRole("button", { name: "Сохраняем…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(editDialog).toBeVisible();
    await expect(editDialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("listitem")).toContainText("https://updated.example.com");
    await expect(page.getByRole("listitem")).toContainText("Частота опроса: 12 мин.");
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Удалить сайт?" });
    await expect(deleteDialog).toContainText("https://updated.example.com");
    await deleteDialog.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(deletes).toBe(0);
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await deleteDialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(deleteDialog.getByRole("alert")).toContainText("Не удалось удалить");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await page.screenshot({ path: `test-results/monitor-delete-${mobile ? "mobile" : "desktop"}.png` });
    await deleteDialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(deleteDialog.getByRole("button", { name: "Удаляем…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByText("Пока нет сайтов.", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("listitem")).toHaveCount(0);
    expect(updates).toBe(2);
    expect(deletes).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
