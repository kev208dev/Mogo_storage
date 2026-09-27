import { expect, test, type Page } from "@playwright/test";

/** 문항 카드는 hydration 뒤에 연다 (그 전 클릭은 브라우저 기본 동작만 일어난다) */
async function openExamPage(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("question-explorer")).toHaveAttribute("data-ready", "");
}

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");
// 승인은 DB 에 남는다 — 재시도하면 처음 상태(검토 대기 1건)가 아니므로 재시도하지 않는다
test.describe.configure({ retries: 0 });

test("개념 태그: 문항 카드 → 개념 페이지 → 관리자 승인 → 공개", async ({ page }) => {
  // 승인된 연결만 공개 화면에 나온다
  await openExamPage(page, "/exam/2022/high3/09");
  const q1 = page.locator("#q-1");
  await q1.locator("summary").first().click();
  const tag = q1.getByRole("link", { name: /세부 내용 파악/ });
  await expect(tag).toBeVisible();
  const q2 = page.locator("#q-2");
  await q2.locator("summary").first().click();
  await expect(q2.getByRole("link", { name: /세부 내용 파악/ })).toHaveCount(0);

  await tag.click();
  await expect(page.getByRole("heading", { level: 1, name: "세부 내용 파악" })).toBeVisible();
  const list = page.getByTestId("concept-questions");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("근거: 해설지 머리말");

  // 관리자: 검토 대기 → 승인
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: "개념 태그" }).click();
  const review = page.getByTestId("concept-review-list").getByRole("listitem");
  await expect(review).toHaveCount(1);
  await expect(review).toContainText("검토 사유");
  await review.getByRole("button", { name: "승인" }).click();
  await expect(page.getByRole("status")).toContainText("승인했습니다");

  // ISR: revalidatePath 는 stale-while-revalidate — 다시 생성된 페이지가 나올 때까지 새로 연다
  await expect(async () => {
    await openExamPage(page, "/exam/2022/high3/09");
    const again = page.locator("#q-2");
    await again.locator("summary").first().click();
    await expect(again.getByRole("link", { name: /세부 내용 파악/ })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
});
