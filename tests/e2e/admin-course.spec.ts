import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");

test("Flow C: admin → 과목 미확정 자료 → 수동 과목 지정 → 게시", async ({ page, request }) => {
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // 실제 구조 미검증 source 는 "정상" 으로 보이지 않는다
  await expect(page.getByText("실제 구조 미검증").first()).toBeVisible();
  await expect(page.getByText("fixture 검증 필요").first()).toBeVisible();

  await page.getByRole("link", { name: "검토 대기" }).click();
  const item = page.getByTestId("unresolved-artifact").filter({ hasText: '표기 "윤리 문제"' });
  await expect(item).toBeVisible();
  await item.getByLabel("세부과목").selectOption("life-and-ethics");
  await item.getByRole("button", { name: "과목 지정" }).click();
  await expect(page.getByRole("status")).toContainText("life-and-ethics");
  await expect(page.getByTestId("unresolved-artifact")).toHaveCount(0);

  // 공개 페이지에 바로 반영 (ISR 대상이 아닌 on-demand 페이지)
  await page.goto("/exam/2022/high3/09/social/life-and-ethics");
  const link = page.getByRole("link", { name: /생활과 윤리 시험지 다운로드/ });
  await expect(link).toBeVisible();
  await expect(page.getByText("출처: EBSi")).toBeVisible();
  const res = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("/f/ethics.pdf");
});
