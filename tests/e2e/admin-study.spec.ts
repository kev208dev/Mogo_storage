import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");

test("관리자: 운영 설정(값 비노출) · 학습 자료 검토 · 시험 일정 화면", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const config = page.getByTestId("config-panel");
  await expect(config).toContainText("스토리지");
  // 비밀 값은 어떤 화면에도 나오지 않는다
  const html = await page.content();
  for (const secret of [
    "e2e-token-0123456789abcdefghij",
    "e2e-session-secret-0123456789abcdefghij",
  ])
    expect(html).not.toContain(secret);
  expect(html).not.toMatch(/postgres:\/\/[^"<\s]*:[^"<\s]*@/);

  await page.getByRole("link", { name: "학습 자료" }).click();
  await expect(page).toHaveURL(/\/admin\/study$/);
  await expect(page.getByRole("region", { name: /검토 대기/ })).toBeVisible();
  await expect(page.getByTestId("english-coverage")).toBeVisible();

  await page.getByRole("link", { name: "시험 일정" }).click();
  await expect(page).toHaveURL(/\/admin\/schedules$/);
  await expect(page.getByRole("region", { name: /시험 일정/ })).toBeVisible();
});
