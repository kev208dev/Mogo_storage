import { expect, test } from "@playwright/test";

test.describe("고3 선택과목 · 제2외국어 · 검색 · 영어 듣기", () => {
  test("고3 시험 → 사회 → 사회·문화 → 다운로드", async ({ page, request }) => {
    await page.goto("/exam/2025/high3/07");
    await page
      .getByRole("navigation", { name: "과목 선택" })
      .getByRole("link", { name: "사회" })
      .click();
    await expect(page).toHaveURL(/\/exam\/2025\/high3\/07\/social$/);
    await page
      .getByRole("navigation", { name: /사회탐구 세부과목 선택/ })
      .getByRole("link", { name: /사회·문화/ })
      .click();
    await expect(page).toHaveURL(/\/social\/social-culture$/);
    const link = page.getByRole("link", { name: /사회·문화 시험지 다운로드/ });
    await expect(link).toBeVisible();
    const res = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
  });

  test("고3 시험 → 제2외국어/한문 → 일본어 I → 다운로드 (한문 I 은 자료 준비 중)", async ({
    page,
    request,
  }) => {
    await page.goto("/exam/2025/high3/07");
    const tabs = page.getByRole("navigation", { name: "과목 선택" });
    await tabs.getByRole("link", { name: "제2외국어/한문" }).click();
    await expect(page).toHaveURL(/\/exam\/2025\/high3\/07\/second-language$/);
    const selector = page.getByRole("navigation", { name: /제2외국어\/한문 세부과목 선택/ });
    await expect(selector.getByText("자료 준비 중")).toBeVisible(); // 한문 I
    await selector.getByRole("link", { name: /일본어 I/ }).click();
    await expect(page).toHaveURL(/\/second-language\/japanese-1$/);
    const link = page.getByRole("link", { name: /일본어 I 시험지 다운로드/ });
    await expect(link).toBeVisible();
    const res = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
  });

  test("과목 탭은 시험에 실제로 있는 영역만 (다른 시험에는 제2외국어 탭 없음)", async ({
    page,
  }) => {
    await page.goto("/exam/2025/high2/09");
    const tabs = page.getByRole("navigation", { name: "과목 선택" });
    await expect(tabs.getByRole("link", { name: "국어" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "제2외국어/한문" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "직업탐구" })).toHaveCount(0);
  });

  test("검색 '2025 고3 7월 사회문화' → 세부과목 페이지, '고3 6평' → 가장 최근 6월 시험", async ({
    page,
  }) => {
    await page.goto(`/search?q=${encodeURIComponent("2025 고3 7월 사회문화")}`);
    await expect(page).toHaveURL(/\/exam\/2025\/high3\/07\/social\/social-culture$/);
    await page.goto(`/search?q=${encodeURIComponent("고3 6평")}`);
    await expect(page).toHaveURL(/\/exam\/2026\/high3\/06$/);
  });

  test("Flow F: 영어 → 듣기 → 받아쓰기 채점과 다시 하기", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english#dictation");
    const section = page.locator("#dictation");
    await expect(section).toBeVisible();
    const blanks = section.getByRole("textbox");
    expect(await blanks.count()).toBeGreaterThan(0);
    await blanks.first().fill("zzz");
    await section.getByRole("button", { name: "정답 확인" }).click();
    await expect(section.getByText(/\d+ \/ \d+ 정답/)).toBeVisible();
    await section.getByRole("button", { name: "다시 하기" }).click();
    await expect(blanks.first()).toHaveValue("");
    await expect(page.locator("#listening")).toBeVisible();
  });

  test("시험 페이지 하단 내부 링크 (다운로드보다 아래)", async ({ page }) => {
    await page.goto("/exam/2025/high2/09");
    const nav = page.getByRole("navigation", { name: "관련 시험" });
    await expect(nav.getByRole("link", { name: /이전 시험/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /다른 해|2024년|2023년/ }).first()).toBeVisible();
    const navBox = await nav.boundingBox();
    const download = page.getByRole("link", { name: /시험지 다운로드/ }).first();
    const dlBox = await download.boundingBox();
    expect(navBox!.y).toBeGreaterThan(dlBox!.y);
  });

  test("GET /api/health 는 민감정보 없이 상태만", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ app: "ok", database: "not_configured" });
  });
});
