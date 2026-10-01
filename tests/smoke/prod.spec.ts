import { expect, test, type APIRequestContext } from "@playwright/test";
import { OFFICIAL_URL_HOSTS } from "../../src/ingestion/manual-import/schema";
import { isHostAllowed } from "../../src/ingestion/net/url-policy";

/**
 * Production smoke test — 읽기 전용.
 * 검사 대상은 하드코딩하지 않고 sitemap 에서 고른다 (데이터가 늘어도 그대로 동작).
 * 다운로드는 302 Location 만 확인하고 공식 서버로 따라가지 않는다.
 */

const BASE = new URL(process.env.SMOKE_BASE_URL!);
/** 추가로 허용할 다운로드 호스트 (예: R2 public host) — 쉼표 구분 */
const EXTRA_HOSTS = (process.env.SMOKE_ALLOWED_DOWNLOAD_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

type ExamUrl = { url: string; year: number; grade: number; month: number; rest: string[] };
let sitemapCache: ExamUrl[] | null = null;

async function sitemapExams(request: APIRequestContext): Promise<ExamUrl[]> {
  if (sitemapCache) return sitemapCache;
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  sitemapCache = locs.flatMap((loc) => {
    const u = new URL(loc);
    const m = u.pathname.match(/^\/exam\/(\d{4})\/high([123])\/(\d{2})((?:\/[a-z0-9-]+)*)$/);
    if (!m) return [];
    return [
      {
        url: u.pathname,
        year: Number(m[1]),
        grade: Number(m[2]),
        month: Number(m[3]),
        rest: m[4]!.split("/").filter(Boolean),
      },
    ];
  });
  return sitemapCache;
}

const examPages = (all: ExamUrl[]) => all.filter((e) => e.rest.length === 0);
const byNewest = (a: ExamUrl, b: ExamUrl) => b.year - a.year || b.month - a.month;

async function getHtml(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect(res.status(), `${path} status`).toBe(200);
  return res.text();
}

function canonicalOf(html: string): string | null {
  return html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
}

function expectIndexablePage(html: string, path: string) {
  expect(canonicalOf(html), `${path} canonical`).toBe(new URL(path, BASE).toString());
  expect(html, `${path} must not be noindex`).not.toMatch(/<meta name="robots" content="noindex/);
}

test.describe("기본 페이지 · 운영 endpoint", () => {
  test("홈", async ({ request }) => {
    const html = await getHtml(request, "/");
    expect(html).toContain("<title>");
    expect(canonicalOf(html)).toMatch(new RegExp(`^${BASE.origin}/?$`));
  });

  test("/api/health 는 app·database 만 공개하고 모두 ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["app", "database"]);
    expect(body).toEqual({ app: "ok", database: "ok" });
  });

  test("robots.txt · sitemap.xml", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain(`Sitemap: ${BASE.origin}/sitemap.xml`);
    const exams = await sitemapExams(request);
    expect(exams.length).toBeGreaterThan(1000);
    const xml = await (await request.get("/sitemap.xml")).text();
    const hosts = new Set([...xml.matchAll(/<loc>https?:\/\/([^/<]+)/g)].map((m) => m[1]));
    expect([...hosts]).toEqual([BASE.host]);
    expect(xml).not.toContain("/api/");
    expect(xml).not.toContain("/admin");
  });

  test("검색: 넓은 검색어는 noindex 결과 목록, 정확한 시험명은 시험 페이지로 이동", async ({
    request,
  }) => {
    const list = await request.get(`/search?q=2025`, { maxRedirects: 0 });
    expect(list.status()).toBe(200);
    const html = await list.text();
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    expect(html).toMatch(/href="\/exam\/2025\/high[123]\/\d{2}/);

    const exact = await request.get(`/search?q=${encodeURIComponent("2025 6월 고3")}`, {
      maxRedirects: 0,
    });
    expect([302, 303, 307]).toContain(exact.status());
    expect(new URL(exact.headers()["location"]!, BASE).pathname).toBe("/exam/2025/high3/06");
  });
});

test.describe("시험 페이지 (sitemap 에서 선택)", () => {
  test("최신 시험 · legacy 시험 · 고1/고2/고3", async ({ request }) => {
    const exams = examPages(await sitemapExams(request)).sort(byNewest);
    const targets = new Map<string, ExamUrl>();
    targets.set("latest", exams[0]!);
    targets.set("legacy", [...exams].sort((a, b) => a.year - b.year || a.month - b.month)[0]!);
    for (const g of [1, 2, 3]) {
      const e = exams.find((x) => x.grade === g);
      expect(e, `고${g} 시험이 sitemap 에 있어야 합니다`).toBeTruthy();
      targets.set(`high${g}`, e!);
    }
    expect(targets.get("legacy")!.year).toBeLessThanOrEqual(2010);
    for (const [label, e] of targets) {
      const html = await getHtml(request, e.url);
      expectIndexablePage(html, e.url);
      expect(html, `${label} breadcrumb JSON-LD`).toContain("BreadcrumbList");
    }
  });

  test("국어는 시험 기본 페이지로 canonical redirect, 수학·영어 과목 페이지", async ({
    request,
  }) => {
    const all = await sitemapExams(request);
    const withMath = all.filter((e) => e.rest.length === 1 && e.rest[0] === "math").sort(byNewest);
    const target = withMath[0]!;
    const examUrl = `/exam/${target.year}/high${target.grade}/${String(target.month).padStart(2, "0")}`;
    const korean = await request.get(`${examUrl}/korean`, { maxRedirects: 0 });
    expect([301, 308]).toContain(korean.status());
    expect(new URL(korean.headers()["location"]!, BASE).pathname).toBe(examUrl);
    for (const subject of ["math", "english"]) {
      const path = `${examUrl}/${subject}`;
      if (!all.some((e) => e.url === path)) continue;
      expectIndexablePage(await getHtml(request, path), path);
    }
  });

  test("사회탐구 · 과학탐구 세부과목 페이지", async ({ request }) => {
    const all = await sitemapExams(request);
    for (const area of ["social", "science"]) {
      const course = all.filter((e) => e.rest.length === 2 && e.rest[0] === area).sort(byNewest)[0];
      expect(course, `${area} 세부과목 페이지가 sitemap 에 있어야 합니다`).toBeTruthy();
      expectIndexablePage(await getHtml(request, course!.url), course!.url);
    }
  });

  test("enum 과목 경로(second_language)는 URL segment 로 308", async ({ request }) => {
    const all = await sitemapExams(request);
    const l2 = all
      .filter((e) => e.rest.length === 1 && e.rest[0] === "second-language")
      .sort(byNewest)[0];
    expect(l2).toBeTruthy();
    const res = await request.get(l2!.url.replace("second-language", "second_language"), {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers()["location"]!, BASE).pathname).toBe(l2!.url);
  });

  test("존재하지 않는 시험·과목은 404", async ({ request }) => {
    for (const path of [
      "/exam/2099/high3/03",
      "/exam/2025/high3/13",
      "/exam/2025/high4/06",
      "/exam/2025/high3/06/not-a-subject",
    ]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
    }
  });
});

test.describe("다운로드", () => {
  test("실제 자료의 download endpoint 는 공식 URL 로 302 (따라가지 않음)", async ({ request }) => {
    const pages = examPages(await sitemapExams(request))
      .sort(byNewest)
      .slice(0, 5);
    let checked = 0;
    for (const e of pages) {
      const html = await getHtml(request, e.url);
      const ids = [
        ...new Set([...html.matchAll(/\/api\/files\/([a-z0-9-]+)\/download/g)].map((m) => m[1])),
      ];
      for (const id of ids.slice(0, 2)) {
        const res = await request.get(`/api/files/${id}/download`, { maxRedirects: 0 });
        expect([302, 307]).toContain(res.status());
        const location = new URL(res.headers()["location"]!);
        expect(location.protocol).toBe("https:");
        expect(
          isHostAllowed(location.hostname, [...OFFICIAL_URL_HOSTS, ...EXTRA_HOSTS]),
          `download host ${location.hostname} 가 허용 목록에 있어야 합니다`,
        ).toBe(true);
        checked += 1;
      }
      if (checked >= 4) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("없는 파일 id 는 404", async ({ request }) => {
    const res = await request.get("/api/files/00000000-0000-0000-0000-000000000000/download", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(404);
  });
});

/** 영역 페이지의 세부과목 카드: [code, availability, html 조각] */
function courseCards(html: string): Array<{ code: string; availability: string; body: string }> {
  return [
    ...html.matchAll(/<li data-course="([a-z0-9-]+)" data-availability="(\w+)">([\s\S]*?)<\/li>/g),
  ].map((m) => ({ code: m[1]!, availability: m[2]!, body: m[3]! }));
}

/** 등급컷 표 머리글의 (출처, 상태) 쌍 */
function gradeCutColumns(html: string): Array<{ source: string; status: string }> {
  return [...html.matchAll(/data-source="(\w+)" data-status="(\w+)"/g)].map((m) => ({
    source: m[1]!,
    status: m[2]!,
  }));
}

test.describe("세부과목 자료 노출 · 등급컷 출처", () => {
  /** sitemap 에서 세부과목 페이지가 있는 최신 영역 페이지 (고3 국어·수학·탐구 등) */
  async function parentsWithCourses(request: APIRequestContext, limit: number) {
    const all = await sitemapExams(request);
    const parents = new Map<string, ExamUrl>();
    for (const e of all.filter((x) => x.rest.length === 2).sort(byNewest)) {
      const parentUrl = e.url.slice(0, e.url.lastIndexOf("/"));
      if (!parents.has(parentUrl)) parents.set(parentUrl, { ...e, url: parentUrl });
      if (parents.size >= limit) break;
    }
    return [...parents.values()];
  }

  test("영역 페이지는 세부과목 자료를 카드로 보여주고 비어 보이지 않는다", async ({ request }) => {
    const parents = await parentsWithCourses(request, 6);
    expect(parents.length).toBeGreaterThan(0);
    let withFiles = 0;
    for (const p of parents) {
      // 국어처럼 기본 과목은 시험 기본 페이지로 308 — canonical 위치에서 확인한다
      const res = await request.get(p.url, { maxRedirects: 0 });
      const path = [301, 308].includes(res.status())
        ? new URL(res.headers()["location"]!, BASE).pathname
        : p.url;
      const html = await getHtml(request, path);
      expect(html, `${path} course overview`).toContain('data-testid="course-overview"');
      const cards = courseCards(html);
      expect(cards.length, `${path} course cards`).toBeGreaterThan(0);
      for (const c of cards) {
        // "자료 준비 중" 은 정말 아무것도 없는 카드에만
        if (c.availability === "empty")
          expect(c.body, `${path} ${c.code}`).toContain("자료 준비 중");
        else expect(c.body, `${path} ${c.code}`).not.toContain("자료 준비 중");
      }
      if (cards.some((c) => c.availability === "available")) withFiles += 1;
    }
    expect(withFiles, "자료가 있는 세부과목 카드가 하나 이상").toBeGreaterThan(0);
  });

  test("세부과목 페이지: 자료가 있으면 다운로드 링크가 있고 endpoint 가 302", async ({
    request,
  }) => {
    const all = await sitemapExams(request);
    const coursePages = all
      .filter((e) => e.rest.length === 2)
      .sort(byNewest)
      .slice(0, 12);
    let checked = 0;
    for (const e of coursePages) {
      const html = await getHtml(request, e.url);
      expectIndexablePage(html, e.url);
      const id = html.match(/\/api\/files\/([a-zA-Z0-9_-]+)\/download/)?.[1];
      if (!id) continue;
      const res = await request.get(`/api/files/${id}/download`, { maxRedirects: 0 });
      expect([302, 307], `${e.url} download`).toContain(res.status());
      const location = new URL(res.headers()["location"]!);
      expect(location.protocol).toBe("https:");
      expect(isHostAllowed(location.hostname, [...OFFICIAL_URL_HOSTS, ...EXTRA_HOSTS])).toBe(true);
      checked += 1;
      if (checked >= 3) break;
    }
    expect(checked, "세부과목 페이지 다운로드").toBeGreaterThan(0);
  });

  test("등급컷이 있는 세부과목은 출처·상태를 보여주고, 업체 '최종'에 공식 배지를 붙이지 않는다", async ({
    request,
  }) => {
    const parents = await parentsWithCourses(request, 8);
    let withCuts = 0;
    for (const p of parents) {
      const res = await request.get(p.url, { maxRedirects: 0 });
      const path = [301, 308].includes(res.status())
        ? new URL(res.headers()["location"]!, BASE).pathname
        : p.url;
      const parentHtml = await getHtml(request, path);
      const cut = courseCards(parentHtml).find((c) => /등급컷 \d+개 출처/.test(c.body));
      if (!cut) continue;
      const coursePath = `${p.url}/${cut.code}`;
      const html = await getHtml(request, coursePath);
      expect(html, `${coursePath} provenance`).toContain('data-testid="grade-cut-provenance"');
      const columns = gradeCutColumns(html);
      expect(columns.length, `${coursePath} provider columns`).toBeGreaterThan(0);
      for (const c of columns)
        if (c.source !== "official")
          expect(c.status, `${coursePath} ${c.source}`).not.toBe("official");
      withCuts += 1;
      if (withCuts >= 2) break;
    }
    // 등급컷 수집 전(시험 직후가 아닌 기간)에는 없을 수 있다 — 있을 때만 검사
    test
      .info()
      .annotations.push({ type: "grade-cut courses checked", description: String(withCuts) });
  });
});

test.describe("접근 제어", () => {
  test("admin 은 비인증 접근을 로그인으로 보내거나 404", async ({ request }) => {
    for (const path of ["/admin", "/admin/imports", "/admin/review", "/admin/runs"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      if (res.status() === 404) continue;
      expect([302, 303, 307], path).toContain(res.status());
      expect(new URL(res.headers()["location"]!, BASE).pathname, path).toBe("/admin/login");
    }
    const login = await request.get("/admin/login", { maxRedirects: 0 });
    if (login.status() === 200)
      expect(await login.text()).toMatch(/<meta name="robots" content="noindex/);
  });

  test("cron endpoint 는 비인증·잘못된 토큰을 거부", async ({ request }) => {
    for (const task of ["grade-cuts", "scheduled", "release-watch", "jobs", "watchdog"]) {
      const variants: Record<string, string>[] = [
        {},
        { authorization: "Bearer not-the-real-secret-0123456789" },
      ];
      for (const headers of variants) {
        const res = await request.get(`/api/cron/${task}`, { headers, maxRedirects: 0 });
        expect([401, 404], `${task}`).toContain(res.status());
      }
    }
    const post = await request.post("/api/cron/grade-cuts", { maxRedirects: 0 });
    expect([401, 404]).toContain(post.status());
  });

  test("내부 revalidate endpoint 도 비인증 거부", async ({ request }) => {
    const res = await request.post("/api/internal/revalidate", {
      data: { paths: ["/"] },
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});

test("홈 화면이 브라우저에서 렌더링된다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  expect(errors).toEqual([]);
});
