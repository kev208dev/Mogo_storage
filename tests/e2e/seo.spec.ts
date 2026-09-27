import { expect, test, type Page } from "@playwright/test";

/** 페이지의 JSON-LD 를 모두 파싱 (하나라도 JSON 이 아니면 실패) */
async function jsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b) as Record<string, unknown>);
}

async function head(page: Page) {
  return {
    title: await page.title(),
    description: await page.locator('meta[name="description"]').getAttribute("content"),
    canonical: await page.locator('link[rel="canonical"]').getAttribute("href"),
    canonicalCount: await page.locator('link[rel="canonical"]').count(),
    robots: (await page.locator('meta[name="robots"]').count())
      ? await page.locator('meta[name="robots"]').getAttribute("content")
      : null,
    ogSiteName: await page.locator('meta[property="og:site_name"]').getAttribute("content"),
    ogLocale: await page.locator('meta[property="og:locale"]').getAttribute("content"),
  };
}

test.describe("SEO: 시험 상세", () => {
  test("과목 페이지: title · canonical · H1 · CollectionPage/BreadcrumbList JSON-LD", async ({
    page,
  }) => {
    await page.goto("/exam/2025/high2/09/english");
    const h = await head(page);
    expect(h.title).toMatch(/^2025년 고2 9월 모의고사\(9모\) 영어 .+ \| 모의고사 창고$/);
    expect(h.canonicalCount).toBe(1);
    expect(h.canonical).toMatch(/\/exam\/2025\/high2\/09\/english$/);
    expect(h.description).toContain("9모");
    expect(h.ogSiteName).toBe("모의고사 창고");
    expect(h.ogLocale).toBe("ko_KR");
    // H1 하나, 과목이 눈에 보이게
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("2025년 고2 9월 모의고사");
    await expect(page.locator("h1")).toContainText("영어");
    await expect(page.locator("h1 .sr-only")).toHaveCount(0);

    const ld = await jsonLd(page);
    const types = ld.map((d) => d["@type"]);
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("CollectionPage");
    expect(types).not.toContain("FAQPage");
    expect(types).not.toContain("AggregateRating");
    const collection = ld.find((d) => d["@type"] === "CollectionPage")!;
    expect(String(collection.url)).toMatch(/^https?:\/\/.+\/exam\/2025\/high2\/09\/english$/);
    expect(collection.name).toBe(h.title.replace(/ \| 모의고사 창고$/, ""));
  });

  test("등급컷은 실제 시험별 등급컷이 있을 때만 title 에 넣는다", async ({ page }) => {
    // 수학: 공식·예상 등급컷이 있다
    await page.goto("/exam/2025/high2/09/math");
    await expect(page.locator("#grade-cuts table").getByText("공식").first()).toBeVisible();
    expect(await page.title()).toContain("등급컷");
    // 영어: 절대평가 고정 기준표뿐 (시험별 등급컷 아님) → 주장하지 않는다
    await page.goto("/exam/2025/high2/09/english");
    await expect(page.locator("#grade-cuts")).toContainText("절대평가");
    expect(await page.title()).not.toContain("등급컷");
  });

  test("시험 → 학년 · 연도 · 월(9모) · 과목 허브 내부 링크", async ({ page }) => {
    await page.goto("/exam/2025/high2/09/english");
    const nav = page.getByRole("navigation", { name: "관련 시험" });
    await expect(nav.locator('a[href="/grade/high2"]')).toBeVisible();
    await expect(nav.locator('a[href="/year/2025"]')).toBeVisible();
    await expect(nav.locator('a[href="/month/9"]')).toContainText("9모");
    await expect(nav.locator('a[href="/subject/english"]')).toBeVisible();
  });

  test("세부과목: canonical 자기 자신, 월 비표준 표기는 같은 세부과목으로 308", async ({
    page,
    request,
  }) => {
    await page.goto("/exam/2025/high2/09/social/social-culture");
    const h = await head(page);
    expect(h.canonical).toMatch(/\/exam\/2025\/high2\/09\/social\/social-culture$/);
    expect(h.title).toContain("사회문화");
    expect(h.description).toContain("사회·문화(사문)");

    const res = await request.get("/exam/2025/high2/9/social/social-culture", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toMatch(/\/exam\/2025\/high2\/09\/social\/social-culture$/);
  });

  test("기본 과목 · enum 표기 URL 은 canonical 로 영구 이동", async ({ request }) => {
    const korean = await request.get("/exam/2025/high2/09/korean", { maxRedirects: 0 });
    expect(korean.status()).toBe(308);
    expect(korean.headers().location).toMatch(/\/exam\/2025\/high2\/09$/);
    const month = await request.get("/exam/2025/high2/9", { maxRedirects: 0 });
    expect(month.status()).toBe(308);
    expect(month.headers().location).toMatch(/\/exam\/2025\/high2\/09$/);
  });
});

test.describe("SEO: 허브 · sitemap · robots", () => {
  test("월 허브: 9모 · canonical · OpenGraph", async ({ page }) => {
    await page.goto("/month/9");
    const h = await head(page);
    expect(h.title).toContain("9모");
    expect(h.canonical).toMatch(/\/month\/9$/);
    expect(h.ogSiteName).toBe("모의고사 창고");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('main a[href^="/exam/"]').first()).toBeVisible();
    // 이 빌드의 시험은 모두 샘플(운영 noindex) → 허브도 noindex
    expect(h.robots).toMatch(/noindex/);
  });

  test("과목 허브: canonical · 시험 과목 페이지로 링크", async ({ page }) => {
    await page.goto("/subject/english");
    const h = await head(page);
    expect(h.canonical).toMatch(/\/subject\/english$/);
    expect(h.description).toContain("영어");
    await expect(page.locator('main a[href$="/english"]').first()).toBeVisible();
    const types = (await jsonLd(page)).map((d) => d["@type"]);
    expect(types).toContain("BreadcrumbList");
  });

  test("title · description 이 허브마다 다르다", async ({ page }) => {
    const seen = new Map<string, string>();
    for (const path of [
      "/",
      "/grade/high2",
      "/year/2025",
      "/month/9",
      "/subject/english",
      "/exam/2025/high2/09",
      "/exam/2025/high2/09/english",
      "/exam/2025/high2/09/social/social-culture",
    ]) {
      await page.goto(path);
      const { title, description } = await head(page);
      expect(seen.has(title), `${path} title duplicates ${seen.get(title)}`).toBe(false);
      seen.set(title, path);
      expect(description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  test("sitemap: 중복 URL 없음, robots.txt 정책", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);

    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/User-Agent: \*/i);
    expect(robots).toContain("Allow: /");
    for (const path of ["/api/", "/search", "/admin"])
      expect(robots).toContain(`Disallow: ${path}`);
    expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
    expect(robots).toMatch(/Host: /);
    expect(robots).not.toMatch(/Googlebot|Yeti|NaverBot/i);
  });

  test("홈 canonical 은 자기 자신, 404 는 canonical 없이 noindex", async ({ page }) => {
    await page.goto("/");
    const home = await head(page);
    expect(home.canonicalCount).toBe(1);
    expect(home.canonical).toMatch(/^https?:\/\/[^/]+\/?$/);

    const res = await page.goto("/exam/2030/high3/09");
    expect(res?.status()).toBe(404);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
