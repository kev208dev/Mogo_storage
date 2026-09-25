import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL 이 없으면 관리자 흐름은 건너뛴다");

const HEADER =
  "year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label";
// 테스트 전용 경로 — 서버는 이 URL 에 요청하지 않는다
const URL_Q = "https://wdown.ebsi.co.kr/__e2e__/2021-h2-11-kor-q.pdf";

test("공식 URL CSV 입력 → 검토 대기 → 브라우저 확인 체크 → 승인 → 시험 페이지 redirect 다운로드", async ({
  page,
  request,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill("ops@example.com");
  await page.getByLabel("접근 토큰").fill("e2e-token-0123456789abcdefghij");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByRole("link", { name: "공식 URL 입력" }).click();

  const csv = [
    HEADER,
    `2021,2,11,school_mock,2021-11-23,,korean,,question,${URL_Q},국어_문제.pdf,국어 문제`,
    `2021,2,11,school_mock,,,korean,,solution,https://blog.example.com/x.pdf,,비공식`,
  ].join("\n");
  await page.getByLabel("또는 붙여넣기").fill(csv);
  await page.getByRole("button", { name: "입력" }).click();
  await expect(page.getByRole("status")).toContainText("신규 1");
  await expect(page.getByRole("status")).toContainText("공식 기관 도메인");

  const row = page.getByTestId("import-row").filter({ hasText: "2021 고2 11월 국어" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: "공식 URL 열기" })).toHaveAttribute("href", URL_Q);

  // 승인 전에는 공개되지 않는다
  expect((await request.get("/exam/2021/high2/11")).status()).toBe(200);
  await page.goto("/exam/2021/high2/11");
  await expect(page.getByRole("link", { name: /국어 시험지 다운로드/ })).toHaveCount(0);

  await page.goto("/admin/imports");
  await page
    .getByTestId("import-row")
    .filter({ hasText: "2021 고2 11월 국어" })
    .getByRole("checkbox")
    .check();
  await page.getByLabel(/브라우저에서 직접 열어/).check();
  await page.getByRole("button", { name: "선택 승인 · 게시" }).click();
  await expect(page.getByRole("status")).toContainText("게시 1건");

  await page.goto("/exam/2021/high2/11");
  const link = page.getByRole("link", { name: /국어 시험지 다운로드/ });
  await expect(link).toBeVisible();
  await expect(page.getByText("출처: 공식 자료 (운영자 확인)")).toBeVisible();
  const res = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe(URL_Q);
});
