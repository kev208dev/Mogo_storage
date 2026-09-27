import { expect, test } from "@playwright/test";

test.describe("세부과목 (선택과목) 흐름", () => {
  test("Flow A: 시험 페이지 → 사회 → 사회·문화 → 시험지 다운로드", async ({ page }) => {
    await page.goto("/exam/2025/high2/09");
    await page
      .getByRole("navigation", { name: "과목 선택" })
      .getByRole("link", { name: "사회" })
      .click();
    await expect(page).toHaveURL(/\/exam\/2025\/high2\/09\/social$/);

    const selector = page.getByRole("navigation", { name: "사회탐구 세부과목 선택" });
    await selector.getByRole("link", { name: /사회·문화/ }).click();
    await expect(page).toHaveURL(/\/social\/social-culture$/);
    await expect(selector.getByRole("link", { name: /사회·문화/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { level: 2, name: "사회·문화" })).toBeVisible();

    const download = page.getByRole("link", { name: /사회·문화 시험지 다운로드/ });
    await expect(download).toBeInViewport();
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.url()).toContain(
      "/api/mock-storage/exams/2025/high2/09/social/social-culture/question.pdf",
    );
  });

  test("Flow B: 시험 페이지 → 과학 → 물리학 I → 자료 준비 중", async ({ page }) => {
    await page.goto("/exam/2025/high2/09");
    await page
      .getByRole("navigation", { name: "과목 선택" })
      .getByRole("link", { name: "과학" })
      .click();
    const selector = page.getByRole("navigation", { name: "과학탐구 세부과목 선택" });
    await expect(selector.getByRole("link", { name: /물리학 I/ })).toContainText("자료 준비 중");
    await selector.getByRole("link", { name: /물리학 I/ }).click();
    await expect(page).toHaveURL(/\/science\/physics-1$/);
    await expect(
      page.getByRole("button", { name: /물리학 I 시험지 다운로드 \(자료 준비 중\)/ }),
    ).toBeDisabled();
    await expect(page.getByRole("link", { name: /물리학 I 시험지 다운로드/ })).toHaveCount(0);
  });

  test("세부과목 페이지 SEO: title, canonical, breadcrumb JSON-LD", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/social/social-culture");
    await expect(page).toHaveTitle(
      "2025년 고2 9월 모의고사(9모) 사회문화 문제·정답·해설·등급컷 | 모의고사 창고",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/exam\/2025\/high2\/09\/social\/social-culture$/,
    );
    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
    );
    expect(ld.itemListElement.map((i: { name: string }) => i.name)).toEqual([
      "홈",
      "고2",
      "2025년",
      "9월 모의고사",
      "사회탐구",
      "사회·문화",
    ]);
  });

  test("잘못된 세부과목 URL은 404", async ({ request }) => {
    for (const path of [
      "/exam/2025/high2/09/social/physics-1",
      "/exam/2025/high2/09/social/unknown-course",
      "/exam/2025/high2/09/science/world-geography",
    ]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});
