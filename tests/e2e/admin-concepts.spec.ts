import { expect, test, type Page } from "@playwright/test";

/** 문항 카드는 hydration 뒤에 연다 (그 전 클릭은 브라우저 기본 동작만 일어난다) */
async function openExamPage(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("question-explorer")).toHaveAttribute("data-ready", "");
}

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");
// 승인은 DB 에 남는다 — 재시도하면 처음 상태(검토 대기 2건)가 아니므로 재시도하지 않는다
test.describe.configure({ retries: 0 });

test("개념 태그: 관리자 승인 → 문항 카드 · 개념 페이지에는 승인된 연결만", async ({ page }) => {
  // 관리자: 검토 대기 2건 중 2번만 승인 (3번은 검토 대기로 남는다)
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: "개념 태그" }).click();
  const review = page.getByTestId("concept-review-list").getByRole("listitem");
  await expect(review).toHaveCount(2);
  await expect(review.first()).toContainText("검토 사유");
  await review.filter({ hasText: "2번" }).getByRole("button", { name: "승인" }).click();
  await expect(page.getByRole("status")).toContainText("승인했습니다");
  await expect(review).toHaveCount(1);
  await expect(review).toContainText("3번");

  // 공개 화면 (이 시험·개념 페이지는 여기서 처음 열린다)
  await openExamPage(page, "/exam/2022/high3/07");
  for (const [n, visible] of [
    [1, true],
    [2, true],
    [3, false],
  ] as const) {
    const card = page.locator(`#q-${n}`);
    await card.locator("summary").first().click();
    await expect(card).toHaveAttribute("open", "");
    await expect(card.getByRole("link", { name: /세부 내용 파악/ })).toHaveCount(visible ? 1 : 0);
  }

  await page
    .locator("#q-1")
    .getByRole("link", { name: /세부 내용 파악/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "세부 내용 파악" })).toBeVisible();
  const list = page.getByTestId("concept-questions");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("근거: 해설지 머리말");
});
