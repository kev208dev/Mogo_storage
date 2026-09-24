import { currentParserVersion } from "@/ingestion/sources/verification";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, validateFixture, type FixtureMeta } from "@/ingestion/fixtures/contract";
import { sha256, validateLiveFixtures } from "@/ingestion/fixtures/live";
import { KICE_DEFINITION } from "@/ingestion/sources/kice/structure";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { EDUCATION_OFFICE_DEFINITION } from "@/ingestion/sources/education-office/structure";

const fixture = (...p: string[]) =>
  readFileSync(path.join(__dirname, "..", "fixtures", ...p), "utf8");
const meta = (
  m: Partial<FixtureMeta> & Pick<FixtureMeta, "source" | "kind" | "url">,
): FixtureMeta => ({
  capturedAt: "2026-09-24T00:00:00Z",
  sha256: "",
  ...m,
});

/** 모든 source parser 가 같은 계약(contract)을 지키는지: synthetic fixture 기준 */
describe("parser contract (all sources)", () => {
  const cases: Array<[string, string, FixtureMeta]> = [
    [
      "ebsi listing",
      fixture("ebsi", "listing-high2-2025.html"),
      meta({
        source: "ebsi",
        kind: "listing",
        url: ebsiListingUrl("https://www.ebsi.co.kr", 2, 2025),
        context: { grade: 2, year: 2025 },
        expect: { minExams: 2, minArtifacts: 10 },
      }),
    ],
    [
      "kice list",
      fixture("kice", "list-page1.html"),
      meta({
        source: "kice",
        kind: "board-list",
        url: KICE_DEFINITION.listUrl("https://www.suneung.re.kr", 1),
        expect: { minExams: 4 },
      }),
    ],
    [
      "kice detail",
      fixture("kice", "view-5102.html"),
      meta({
        source: "kice",
        kind: "board-detail",
        url: "https://www.suneung.re.kr/boardCnts/view.do?boardSeq=5102",
        context: { examTitle: "2026학년도 대학수학능력시험 9월 모의평가" },
        expect: { minArtifacts: 9 },
      }),
    ],
    [
      "education list",
      fixture("education-office", "list-page1.html"),
      meta({
        source: "education_office",
        kind: "board-list",
        url: EDUCATION_OFFICE_DEFINITION.listUrl("https://www.sen.go.kr", 1),
      }),
    ],
    [
      "ebsi empty",
      fixture("ebsi", "listing-empty.html"),
      meta({
        source: "ebsi",
        kind: "listing",
        url: ebsiListingUrl("https://www.ebsi.co.kr", 2, 2025),
        context: { grade: 2, year: 2025 },
        expect: { empty: true },
      }),
    ],
  ];

  it.each(cases)("%s satisfies the contract", (_name, html, m) => {
    const r = validateFixture(html, m);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("records carry year/grade/month/examType/subject/course/artifactType/artifactUrl", () => {
    const r = validateFixture(cases[0]![1], cases[0]![2]);
    const social = r.records.filter((x) => x.subject === "social");
    expect(social.map((x) => x.course).sort()).toEqual(["korean-geography", "life-and-ethics"]);
    for (const rec of r.records) {
      expect(Object.keys(rec).sort()).toEqual([
        "artifactType",
        "artifactUrl",
        "course",
        "courseStatus",
        "examType",
        "grade",
        "month",
        "subject",
        "year",
      ]);
    }
  });

  it("a structure change is a contract failure, not an empty success", () => {
    const r = validateFixture(fixture("ebsi", "listing-structure-changed.html"), cases[0]![2]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("page structure changed");
  });

  it("a missing required field fails", () => {
    const records = validateFixture(cases[0]![1], cases[0]![2]).records;
    const broken = records.map((r, i) => (i === 0 ? { ...r, artifactUrl: null } : r));
    const r = checkContract(broken, cases[0]![2]);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("record #1: url missing");
    const noSubject = checkContract(
      records.map((r, i) => (i === 1 ? { ...r, subject: null } : r)),
      cases[0]![2],
    );
    expect(noSubject.errors).toContain("record #2: subject missing/invalid");
  });

  it("urls outside the source allowlist fail", () => {
    const records = validateFixture(cases[0]![1], cases[0]![2]).records.map((r) => ({
      ...r,
      artifactUrl: "https://evil.example.com/a.pdf",
    }));
    expect(checkContract(records, cases[0]![2]).errors[0]).toContain("allowlist");
  });

  it("an unexpectedly empty page fails when exams are expected", () => {
    const r = validateFixture(fixture("ebsi", "listing-empty.html"), {
      ...cases[0]![2],
      expect: { minExams: 1 },
    });
    expect(r.ok).toBe(false);
  });
});

describe("live fixture validation (tests/fixtures/live layout)", () => {
  function makeLiveDir() {
    const root = mkdtempSync(path.join(os.tmpdir(), "live-"));
    mkdirSync(path.join(root, "ebsi"));
    const html = fixture("ebsi", "listing-high2-2025.html");
    const m = {
      ...meta({
        source: "ebsi",
        kind: "listing",
        url: ebsiListingUrl("https://www.ebsi.co.kr", 2, 2025),
        context: { grade: 2, year: 2025 },
      }),
      sha256: sha256(html),
    };
    writeFileSync(path.join(root, "ebsi", "listing-g2-2025.html"), html);
    writeFileSync(path.join(root, "ebsi", "listing-g2-2025.json"), JSON.stringify(m));
    return root;
  }

  it("passes and produces a fixture set hash + parser version for approval", () => {
    const { results, summaries } = validateLiveFixtures(makeLiveDir());
    expect(results[0]!.ok).toBe(true);
    expect(summaries[0]).toMatchObject({
      source: "ebsi",
      passed: true,
      parserVersion: currentParserVersion("ebsi"),
    });
    expect(summaries[0]!.fixtureHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("detects a fixture edited after capture (sha256 mismatch)", () => {
    const root = makeLiveDir();
    const file = path.join(root, "ebsi", "listing-g2-2025.html");
    writeFileSync(file, readFileSync(file, "utf8").replace("국어", "국 어"));
    const { results, summaries } = validateLiveFixtures(root);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.errors[0]).toContain("sha256 mismatch");
    expect(summaries[0]!.passed).toBe(false);
    expect(summaries[0]!.fixtureHash).toBeNull();
  });
});
