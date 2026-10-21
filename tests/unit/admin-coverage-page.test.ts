import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: vi.fn(),
  coverage: vi.fn(),
  details: vi.fn(),
}));
vi.mock("@/lib/server/admin-session", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/db/client", () => ({ getDb: mocks.db }));
vi.mock("@/lib/server/admin-coverage", () => ({ adminCoverageDetails: mocks.details }));
vi.mock("@/ingestion/feature-coverage", async (original) => ({
  ...(await original<object>()),
  computeFeatureCoverage: mocks.coverage,
}));
import CoveragePage from "@/app/admin/(console)/coverage/page";
import { FEATURES, FEATURE_STATUSES } from "@/ingestion/feature-coverage";
import { ExamFilter } from "@/components/admin/ExamFilter";
import { GRADES } from "@/lib/constants";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("ops@example.com");
  mocks.db.mockReturnValue({});
  mocks.details.mockResolvedValue([]);
  mocks.coverage.mockResolvedValue({
    total: 0,
    rows: [],
    summary: Object.fromEntries(
      FEATURES.map((f) => [f, Object.fromEntries(FEATURE_STATUSES.map((s) => [s, 0]))]),
    ),
  });
});
it("관리자 인증 실패 시 조회 이전에 중단", async () => {
  mocks.auth.mockRejectedValue(new Error("unauthorized"));
  await expect(
    CoveragePage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as Parameters<
      typeof CoveragePage
    >[0]),
  ).rejects.toThrow("unauthorized");
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.coverage).not.toHaveBeenCalled();
});
it("자료 0건을 empty state로 렌더링", async () => {
  const html = renderToStaticMarkup(
    await CoveragePage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ year: "2026", month: "10" }),
    } as Parameters<typeof CoveragePage>[0]),
  );
  expect(html).toContain("선택한 시험의 실자료가 없습니다");
  expect(html).not.toContain('data-status="complete"');
});
it.each(GRADES)("고%s 선택 링크가 두 관리자 화면에서 시험을 유지", (grade) => {
  for (const path of ["/admin/coverage", "/admin/imports"]) {
    const html = renderToStaticMarkup(
      createElement(ExamFilter, { path, filter: { year: 2026, month: 10, grade } }),
    );
    expect(html).toContain(`${path}?year=2026&amp;month=10&amp;grade=${grade}`);
    expect(html).toContain(`value="${grade}" selected=""`);
  }
});
