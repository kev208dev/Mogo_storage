import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("Flow I: fake 공식 source → 수집 → 검증 → 게시 → 시험 페이지 다운로드", async ({
  page,
  request,
}) => {
  await page.goto("/exam/2022/high3/09");
  const link = page.getByRole("link", { name: /국어 시험지 다운로드/ });
  await expect(link).toBeVisible();
  await expect(page.getByText("출처: EBSi")).toBeVisible();
  const res = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("/f/kor.pdf");
});

test("Flow J: source 구조 변경 → 자동 게시 중단 → 관리자 경고", async ({ page }) => {
  await login(page);
  const kice = page.getByRole("listitem").filter({ hasText: "한국교육과정평가원" });
  await expect(kice.getByText("구조 변경", { exact: true })).toBeVisible();
  await expect(kice.getByText(/SOURCE_STRUCTURE_CHANGED/)).toBeVisible();
  await expect(kice.getByText(/자동 수집: 비활성/)).toBeVisible();
});

test("관리자 대시보드: scheduler heartbeat 상태 (cron 설정 없음 → 꺼짐)", async ({ page }) => {
  await login(page);
  const table = page.getByTestId("scheduler-status");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "grade-cuts" })).toContainText("꺼짐");
  await expect(table.getByRole("row").filter({ hasText: "watchdog" })).toBeVisible();
});

test("관리자 대시보드: source × 기능 자동화 범위 (robots 금지는 정책상 금지로 표시)", async ({
  page,
}) => {
  await login(page);
  const table = page.getByTestId("source-policy");
  await expect(table).toBeVisible();
  const kice = table.getByRole("row").filter({ hasText: "한국교육과정평가원" }).first();
  await expect(kice).toContainText("정책상 금지");
  await expect(table.getByRole("row").filter({ hasText: "등급컷 megastudy" })).toContainText(
    "자동",
  );
});

test("Flow H: 오류 신고 → 관리자 → 해결", async ({ page, request }) => {
  const res = await request.post("/api/reports", {
    data: JSON.stringify({
      examId: await examIdOf(page, "/exam/2022/high3/09"),
      category: "wrong_solution",
      message: "E2E 신고",
    }),
    headers: { "content-type": "application/json", "x-forwarded-for": "10.1.2.3" },
  });
  expect(res.status()).toBe(201);
  await login(page);
  await page.goto("/admin/reports");
  const row = page.getByRole("listitem").filter({ hasText: "E2E 신고" });
  await row.getByLabel("상태").selectOption("resolved");
  await row.getByRole("button", { name: "변경" }).click();
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("listitem").filter({ hasText: "E2E 신고" }).getByLabel("상태"),
  ).toHaveValue("resolved");
});

/** 공개 시험 페이지의 신고 dialog 가 쓰는 examId 를 얻는다 */
async function examIdOf(page: Page, path: string): Promise<string> {
  await page.goto(path);
  const id = await page.locator("[data-exam-id]").first().getAttribute("data-exam-id");
  if (!id) throw new Error("exam id not found on page");
  return id;
}

test("관리자 기능 coverage: 시험별 파일 · 정답 · 등급컷 상태와 합계", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "기능 coverage" }).click();
  await expect(page).toHaveURL(/\/admin\/coverage$/);
  const view = page.getByTestId("feature-coverage");
  await expect(view.getByRole("heading", { name: "기능 coverage" })).toBeVisible();
  // e2e DB 의 실제(비샘플) 시험 2022 고3 9월: fake source 로 국어 파일이 게시돼 있다
  const row = view.getByRole("row").filter({ hasText: "2022 고3 9월" });
  await expect(row).toBeVisible();
  await expect(row.locator("td[data-status]").first()).not.toHaveAttribute("data-status", "");
  await expect(view.locator("tr[data-feature=files]")).toBeVisible();
});
