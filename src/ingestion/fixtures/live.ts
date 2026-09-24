import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { currentParserVersion } from "../sources/verification";
import {
  pageTypeOf,
  summarize,
  validateFixture,
  type ContractResult,
  type FixtureMeta,
} from "./contract";

export const LIVE_FIXTURE_DIR = "tests/fixtures/live";

/** source id → fixture 디렉터리 이름 */
export const FIXTURE_DIRS: Record<FixtureMeta["source"], string> = {
  ebsi: "ebsi",
  kice: "kice",
  education_office: "education-office",
};

export interface LiveFixture {
  name: string;
  htmlPath: string;
  meta: FixtureMeta;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function listLiveFixtures(root = LIVE_FIXTURE_DIR): LiveFixture[] {
  const out: LiveFixture[] = [];
  for (const dir of Object.values(FIXTURE_DIRS)) {
    const full = path.join(root, dir);
    if (!existsSync(full)) continue;
    for (const file of readdirSync(full)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const meta = JSON.parse(readFileSync(path.join(full, file), "utf8")) as FixtureMeta;
      out.push({
        name: `${dir}/${file.replace(/\.json$/, "")}`,
        htmlPath: path.join(full, file.replace(/\.json$/, ".html")),
        meta,
      });
    }
  }
  return out;
}

export interface FixtureValidation extends ContractResult {
  name: string;
  source: FixtureMeta["source"];
  pageType: string;
  sha256Matches: boolean;
  /** 사람이 expected 요약을 실제 페이지와 대조했는지 */
  expectedReviewed: boolean;
}

export interface SourceValidationSummary {
  source: FixtureMeta["source"];
  fixtures: number;
  passed: boolean;
  /** expected 요약을 사람이 확인하지 않은 fixture (있으면 승인 증거로 쓰지 않는다) */
  unreviewed: string[];
  /** 이 source 의 fixture 묶음 hash (승인 기록용) */
  fixtureHash: string | null;
  parserVersion: string | null;
}

/** 저장된 실제 fixture 를 모든 parser 에 통과시킨다 (네트워크 없음) */
export function validateLiveFixtures(root = LIVE_FIXTURE_DIR, onlySource?: string) {
  const results: FixtureValidation[] = [];
  for (const fx of listLiveFixtures(root)) {
    if (onlySource && fx.meta.source !== onlySource) continue;
    const html = existsSync(fx.htmlPath) ? readFileSync(fx.htmlPath, "utf8") : null;
    if (html === null) {
      results.push({
        name: fx.name,
        source: fx.meta.source,
        pageType: pageTypeOf(fx.meta),
        sha256Matches: false,
        expectedReviewed: Boolean(fx.meta.expectedReviewed),
        ok: false,
        records: [],
        exams: 0,
        artifacts: 0,
        ambiguousCourses: 0,
        summary: summarize([]),
        drift: [],
        errors: ["html file missing"],
      });
      continue;
    }
    const matches = sha256(html) === fx.meta.sha256;
    const result = validateFixture(html, fx.meta);
    if (!matches) result.errors.unshift("sha256 mismatch: fixture was edited after capture");
    results.push({
      ...result,
      ok: result.ok && matches,
      name: fx.name,
      source: fx.meta.source,
      pageType: pageTypeOf(fx.meta),
      sha256Matches: matches,
      expectedReviewed: Boolean(fx.meta.expectedReviewed),
    });
  }
  const bySource = new Map<FixtureMeta["source"], FixtureValidation[]>();
  for (const r of results) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  const summaries: SourceValidationSummary[] = [...bySource.entries()].map(([source, list]) => {
    const unreviewed = list.filter((r) => !r.expectedReviewed).map((r) => r.name);
    // parse 성공만으로는 부족하다: 사람이 기대 요약을 확인한 fixture 여야 검증 증거가 된다
    const passed = list.every((r) => r.ok) && unreviewed.length === 0;
    const fixtures = listLiveFixtures(root).filter((f) => f.meta.source === source);
    return {
      source,
      fixtures: list.length,
      passed,
      unreviewed,
      fixtureHash: passed
        ? sha256(
            fixtures
              .map((f) => `${f.name}:${f.meta.sha256}`)
              .sort()
              .join("\n"),
          ).slice(0, 32)
        : null,
      parserVersion: currentParserVersion(source),
    };
  });
  return { results, summaries };
}
