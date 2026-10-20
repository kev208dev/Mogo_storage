import { describe, expect, it, vi } from "vitest";
import { adminExamFilter, matchesExam } from "@/lib/admin-exam-filter";
import { cutLabel, slotStatus } from "@/lib/admin-coverage-model";
import { GRADES } from "@/lib/constants";
import { importOfficialUrls } from "@/ingestion/manual-import/import";
import { IMPORT_COLUMNS } from "@/ingestion/manual-import/schema";
import type { Database } from "@/db/client";
const slot = { subject: "korean", courseId: null };
describe("10모 관리자 상태", () => {
  it.each(GRADES)("고%s 필터가 다른 학년·월·연도를 제외", (grade) => {
    const filter = adminExamFilter({ year: "2026", month: "10", grade: String(grade) });
    expect(matchesExam({ year: 2026, month: 10, grade }, filter)).toBe(true);
    expect(matchesExam({ year: 2025, month: 10, grade }, filter)).toBe(false);
    expect(matchesExam({ year: 2026, month: 9, grade }, filter)).toBe(false);
    for (const other of GRADES.filter((g) => g !== grade))
      expect(matchesExam({ year: 2026, month: 10, grade: other }, filter)).toBe(false);
  });
  it("0건을 완료·원문 미공개로 오인하지 않음", () => {
    expect(slotStatus(slot, "question", [], [])).toEqual({
      status: "missing",
      detail: "자료 미확보 · 원문 공개 여부 미확인",
    });
  });
  it("시험지만 게시되면 해설은 여전히 누락", () => {
    const files = [{ ...slot, type: "question" }];
    expect(slotStatus(slot, "question", files, []).status).toBe("complete");
    expect(slotStatus(slot, "solution", files, []).status).toBe("missing");
  });
  it("공식 URL 후보는 승인 전 완료 아님", () => {
    expect(
      slotStatus(
        slot,
        "question",
        [],
        [
          {
            ...slot,
            type: "question",
            status: "manual_review",
            statusReason: "브라우저 확인 필요",
          },
        ],
      ).status,
    ).toBe("manual_review");
  });
  it("정책 차단은 오류와 구분", () => {
    expect(
      slotStatus(
        slot,
        "question",
        [],
        [
          {
            ...slot,
            type: "question",
            status: "failed",
            statusReason: "robots 제한",
            policyBlocked: true,
          },
        ],
      ).status,
    ).toBe("blocked_policy");
  });
  it("업체 예상치를 공식으로 표시하지 않음", () => {
    expect(cutLabel({ isOfficial: false, providerStatus: "provider_estimate" })).toContain(
      "공식 확정 아님",
    );
    expect(cutLabel({ isOfficial: true, providerStatus: "provider_estimate" })).toContain(
      "공식 확정 아님",
    );
    expect(cutLabel({ isOfficial: true, providerStatus: "official_final" })).toBe("공식 등급컷");
  });
  it("사전 검사에서 중복·충돌·잘못된 행 검증, DB 쓰기와 네트워크 없음", async () => {
    const access = vi.fn(() => {
      throw new Error("DB 접근 금지");
    });
    const db = new Proxy({}, { get: access }) as Database;
    const fetch = vi.spyOn(globalThis, "fetch");
    const row =
      "2026,1,10,school_mock,2026-10-20,,korean,,question,https://www.ebsi.co.kr/__test__/q.pdf,,국어";
    try {
      const result = await importOfficialUrls(db, {
        admin: "test",
        dryRun: true,
        csv: [
          IMPORT_COLUMNS.join(","),
          row,
          row,
          row.replace("q.pdf", "other.pdf"),
          "invalid",
        ].join("\n"),
      });
      expect(result.rows.map((r) => r.status)).toEqual([
        "unchanged",
        "unchanged",
        "invalid",
        "invalid",
      ]);
      expect(result.rows[2].errors?.join()).toContain("같은 슬롯");
      expect(access).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
