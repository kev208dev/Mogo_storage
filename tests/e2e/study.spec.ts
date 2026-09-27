import { expect, test } from "@playwright/test";

const ENGLISH = "/exam/2025/high2/09/english";

test.describe("빠른 답 입력 · 채점", () => {
  test("붙여넣기는 1번부터 채워지고 진행률이 올라간다", async ({ page }) => {
    await page.goto(ENGLISH);
    const input = page.locator("#quick-answer");
    await input.fill("34244125");
    const grid = page.getByRole("list", { name: "문항별 입력 상태" });
    await expect(grid.getByRole("button", { name: /^1번 답 3/ })).toBeVisible();
    await expect(grid.getByRole("button", { name: /^8번 답 5/ })).toBeVisible();
    await expect(page.locator("#quick-progress")).toContainText("8 / 45");
  });

  test("타이핑은 자동으로 다음 문항, Backspace 는 이전 답을 지운다", async ({ page }) => {
    await page.goto(ENGLISH);
    const input = page.locator("#quick-answer");
    await input.click();
    await page.keyboard.type("123");
    const grid = page.getByRole("list", { name: "문항별 입력 상태" });
    await expect(grid.getByRole("button", { name: /^3번 답 3/ })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(grid.getByRole("button", { name: /^3번 미입력/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "3번 답 선택" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("group", { name: "2번 답 선택" })).toBeVisible();
  });

  test("실시간 채점 → 결과표 → 틀린 문제 클릭 시 해설 열림", async ({ page }) => {
    await page.goto(ENGLISH);
    await page.getByLabel("실시간 채점").check();
    await page.locator("#quick-answer").fill("1".repeat(20));
    await expect(page.getByTestId("live-score")).toContainText("점");
    await page.getByRole("button", { name: "채점 결과 보기" }).click();
    const result = page.getByRole("region", { name: "채점 결과" });
    await expect(result).toContainText("미입력");
    await expect(result).toContainText("오답");
    await expect(result.getByRole("columnheader", { name: "정답" })).toBeVisible();
    // 정답이 1이 아닌 첫 문항 (오답 · 해설 링크)
    const link = result.getByRole("link", { name: "오답 · 해설" }).first();
    const n = (await link.getAttribute("href"))?.match(/q-(\d+)/)?.[1];
    await link.click();
    await expect(page.locator(`#q-${n}`)).toHaveAttribute("open", "");
  });

  test("틀린 문제만 복습하기 → 오답 필터", async ({ page }) => {
    await page.goto(ENGLISH);
    await page.locator("#quick-answer").fill("1");
    await page.getByRole("button", { name: "채점 결과 보기" }).click();
    await page.getByRole("button", { name: "틀린 문제만 복습하기" }).click();
    await expect(
      page.getByRole("group", { name: "문항 필터" }).getByRole("button", { name: "틀린 문제만" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("문항별 학습", () => {
  test("해설 또는 해설지 쪽 링크, 많이 틀린 문제(통계 출처)", async ({ page }) => {
    await page.goto(ENGLISH);
    const card = page.locator("#q-1");
    await card.locator("summary").first().click();
    await expect(card).toHaveAttribute("open", "");
    await expect(card.getByRole("list", { name: "1번 선택지" })).toBeVisible();
    const missed = page.getByTestId("most-missed");
    await expect(missed).toContainText(/출처|통계 데이터 없음/);
  });

  test("듣기: 문항 재생 버튼과 ±5초", async ({ page }) => {
    await page.goto(ENGLISH);
    const listening = page.locator("#listening");
    await expect(listening.getByRole("button", { name: "5초 뒤로" })).toBeVisible();
    await expect(listening.getByRole("button", { name: "5초 앞으로" })).toBeVisible();
    await expect(listening.getByRole("button", { name: /재생$/ }).first()).toBeVisible();
  });

  test("단어장 검색 · 모르는 단어", async ({ page }) => {
    await page.goto(`${ENGLISH}#vocabulary`);
    const vocab = page.locator("#vocabulary");
    const rows = vocab.locator("tbody tr");
    const total = await rows.count();
    const firstWord = (await rows.first().getByTestId("vocab-word").textContent()) ?? "";
    await vocab.getByLabel("단어 검색").fill(firstWord);
    await expect(rows.first()).toContainText(firstWord);
    await vocab.getByLabel("단어 검색").fill("");
    await expect(rows).toHaveCount(total);
    await rows.first().getByRole("checkbox").check();
    await vocab.getByLabel(/모르는 단어만/).check();
    await expect(rows).toHaveCount(1);
  });

  test("과목 전환은 새 과목 화면을 보여준다", async ({ page }) => {
    await page.goto(ENGLISH);
    await page
      .getByRole("navigation", { name: /과목/ })
      .getByRole("link", { name: "수학" })
      .click();
    await expect(page).toHaveURL(/\/math$/);
    await expect(page.locator("#quick-answer")).toBeVisible();
  });
});
