import { expect, test } from "@playwright/test";
for (const path of ["/admin/coverage?year=2026&month=10", "/admin/imports?year=2026&month=10"]) {
  test(`일반 사용자 관리자 데이터 비공개 ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status() === 404 || page.url().includes("/admin/login")).toBe(true);
    await expect(page.getByTestId("feature-coverage")).toHaveCount(0);
    await expect(page.getByTestId("import-row")).toHaveCount(0);
  });
}
