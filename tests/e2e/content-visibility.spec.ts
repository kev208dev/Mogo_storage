import { expect, test } from "@playwright/test";

/**
 * 영역 페이지(고3 수학)에 영역 전체 자료가 없고 선택과목(미적분)에만 자료가 있는 운영 형태.
 * 영역 페이지가 비어 보이지 않고, 세부과목 자료·등급컷으로 바로 이동할 수 있어야 한다.
 */
const PARENT = "/exam/2025/high3/07/math";
const COURSE = `${PARENT}/calculus`;

test.describe("세부과목 자료 노출 (P0)", () => {
  test("영역 페이지에서 세부과목 카드로 실제 자료를 보여준다", async ({ page }) => {
    await page.goto(PARENT);
    const overview = page.getByTestId("course-overview");
    await expect(overview).toBeVisible();
    await expect(overview.getByRole("heading", { level: 2 })).toContainText("수학 세부과목별 자료");

    const calculus = overview.locator('[data-course="calculus"]');
    await expect(calculus).toHaveAttribute("data-availability", "available");
    await expect(calculus).toContainText("문제 PDF 있음");
    await expect(calculus).toContainText("해설 PDF 있음");
    await expect(calculus).toContainText("등급컷 2개 출처");
    await expect(calculus).toContainText("파일 2개");
    await expect(calculus).not.toContainText("자료 준비 중");

    // 자료가 정말 하나도 없는 과목만 "자료 준비 중"
    const geometry = overview.locator('[data-course="geometry"]');
    await expect(geometry).toHaveAttribute("data-availability", "empty");
    await expect(geometry).toContainText("자료 준비 중");

    // 기존 세부과목 선택 UI 는 그대로
    await expect(page.getByRole("navigation", { name: "수학 세부과목 선택" })).toBeVisible();

    // 등급컷: 영역 값은 없고 세부과목별 등급컷 바로가기
    const cuts = page.getByTestId("course-grade-cuts");
    await expect(cuts).toContainText("세부과목별 등급컷 있음");
    await expect(cuts.getByRole("link", { name: /미적분/ })).toHaveAttribute(
      "href",
      `${COURSE}#grade-cuts`,
    );
  });

  test("카드 → 세부과목 페이지 → PDF 링크, 뒤로 가기", async ({ page }) => {
    await page.goto(PARENT);
    await page
      .getByTestId("course-overview")
      .getByRole("link", { name: /미적분/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`${COURSE}$`));
    await expect(page.getByRole("link", { name: /미적분 시험지 다운로드/ })).toHaveAttribute(
      "href",
      /\/api\/files\/.+\/download$/,
    );
    await expect(page.getByRole("link", { name: /미적분 정답·해설 다운로드/ })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${COURSE}$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${PARENT}$`));
    await expect(page.getByTestId("course-overview")).toBeVisible();
  });

  test("영역 페이지 canonical 은 영역 자신 (세부과목 canonical 과 중복되지 않음)", async ({
    page,
  }) => {
    await page.goto(PARENT);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${PARENT}$`),
    );
  });
});

test.describe("등급컷 출처 표시", () => {
  test("세부과목 등급컷: 출처별 값 분리 · 업체 최종은 공식 아님 · 공식 미제공 안내", async ({
    page,
  }) => {
    await page.goto(`${COURSE}#grade-cuts`);
    const section = page.locator("#grade-cuts");
    const jongroHead = section.locator('th[data-source="jongro"]');
    await expect(jongroHead).toContainText("종로 최종");
    await expect(jongroHead).toContainText("업체 최종 · 비공식");
    await expect(jongroHead).toHaveAttribute("data-status", "provider_final");
    await expect(section.locator('th[data-status="official"]')).toHaveCount(0);
    await expect(section.getByTestId("official-grade-cut-note")).toContainText(
      "공식 원점수 등급컷 미제공",
    );

    // 값은 원문 그대로 (소수점 · 범위) — 평균이나 중간값을 만들지 않는다
    const table = section.locator("table");
    await expect(table).toContainText("원점수 84.5 · 표준점수 131 · 백분위 96");
    await expect(table).toContainText("74~77");
    await expect(table.getByRole("row", { name: /2등급/ })).toContainText("출처별 상이");
    await expect(table.getByRole("row", { name: /^1등급/ })).not.toContainText("출처별 상이");

    const provenance = section.getByTestId("grade-cut-provenance");
    await expect(provenance.locator('[data-source="jongro"]')).toContainText("원점수 기준");
    await expect(provenance.locator('[data-source="jongro"]')).toContainText("값 확인");
    await expect(provenance.locator('[data-source="megastudy"]')).toContainText("예상 · 비공식");
  });
});
