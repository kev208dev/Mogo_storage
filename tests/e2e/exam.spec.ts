import { expect, test } from "@playwright/test";

test.describe("핵심 흐름: 검색 → 시험 페이지 → 다운로드", () => {
  test("홈에서 년도/학년/월 선택으로 시험 페이지 이동", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "모의고사 창고" })).toBeVisible();
    await page.getByLabel("년도", { exact: true }).selectOption("2025");
    await page.getByLabel("학년", { exact: true }).selectOption("2");
    await page.getByLabel("월", { exact: true }).selectOption("9");
    await page.getByRole("button", { name: "모의고사 찾기" }).click();
    await expect(page).toHaveURL(/\/exam\/2025\/high2\/09$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("2025년 고2 9월 모의고사");
  });

  test("자유 검색어 '25 고2 9모' 해석", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "모의고사 검색" }).fill("25 고2 9모");
    await page.getByRole("searchbox", { name: "모의고사 검색" }).press("Enter");
    await expect(page).toHaveURL(/\/exam\/2025\/high2\/09$/);
  });

  test("다운로드 버튼이 첫 화면 안에 보이고 파일이 내려받아진다", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english");
    const download = page.getByRole("link", { name: /시험지 다운로드/ });
    await expect(download).toBeInViewport();
    await expect(page.getByRole("link", { name: /정답·해설 다운로드/ })).toBeInViewport();

    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.url()).toContain("/api/mock-storage/");

    // 한글 파일명은 RFC 5987 filename* 로 전달된다. (headless 브라우저는 suggestedFilename 을 못 읽는 경우가 있어 헤더로 검증)
    const href = await download.getAttribute("href");
    const res = await page.request.get(href!, { maxRedirects: 5 });
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(
      /^attachment; .*filename\*=UTF-8''.+\.pdf$/,
    );
  });

  test("과목 탭은 링크 내비게이션이며 현재 과목을 표시한다", async ({ page }) => {
    await page.goto("/exam/2025/high2/09");
    const nav = page.getByRole("navigation", { name: "과목 선택" });
    await expect(nav.getByRole("link", { name: "국어" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "영어" }).click();
    await expect(page).toHaveURL(/\/english$/);
    await expect(nav.getByRole("link", { name: "영어" })).toHaveAttribute("aria-current", "page");
  });

  test("자료가 없으면 '자료 준비 중'을 표시한다", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/history");
    await expect(page.getByText("자료 준비 중")).toBeVisible();
  });

  test("존재하지 않는 시험/과목은 404", async ({ page }) => {
    const res = await page.goto("/exam/2030/high2/09");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
    const res2 = await page.goto("/exam/2025/high2/09/biology");
    expect(res2?.status()).toBe(404);
  });
});

test.describe("부가기능", () => {
  test("정답 보기는 기본 접힘", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english");
    const answers = page.getByRole("list", { name: "문항별 정답" });
    await expect(answers).toBeHidden();
    await page.getByText("정답 보기", { exact: true }).click();
    await expect(answers).toBeVisible();
  });

  test("자동 채점 → 틀린 문제 클릭 시 해설 열림", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english");
    await page.getByLabel("1번 1번 선택", { exact: true }).check({ force: true });
    await page.getByRole("button", { name: "채점하기" }).click();
    const result = page.getByRole("region", { name: "채점 결과" });
    await expect(result).toContainText("점");
    const wrong = result.getByRole("link").first();
    const label = await wrong.getAttribute("aria-label");
    const n = label?.match(/(\d+)번/)?.[1];
    await wrong.click();
    await expect(page.locator(`#q-${n}`)).toHaveAttribute("open", "");
  });

  test("등급컷은 공식/예상을 구분한다", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/math");
    const table = page.locator("#grade-cuts table");
    await expect(table.getByText("공식").first()).toBeVisible();
    await expect(table.getByText("예상").first()).toBeVisible();
    await expect(page.locator("#grade-cuts").getByText("샘플 데이터입니다")).toBeVisible();
  });

  test("단어 시험 진행", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english#vocabulary-quiz");
    await page.getByRole("button", { name: "단어 시험 시작" }).click();
    await expect(page.getByText("1 / 10")).toBeVisible();
  });

  test("오류 신고 접수", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english");
    await page.getByRole("button", { name: /시험지 오류 신고/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("파일이 열리지 않음").click();
    await dialog.getByRole("button", { name: "신고하기" }).click();
    await expect(dialog.getByText("신고가 접수되었습니다")).toBeVisible();
  });
});

test.describe("SEO", () => {
  test("canonical, JSON-LD breadcrumb, description", async ({ page }) => {
    await page.goto("/exam/2025/high2/09");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/exam\/2025\/high2\/09$/,
    );
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toContain("2025년 고2 9월 모의고사");
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? "{}")["@type"]).toBe("BreadcrumbList");
  });

  test("sitemap / robots", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).toContain("/exam/2025/high2/09");
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Sitemap:");
  });
});
