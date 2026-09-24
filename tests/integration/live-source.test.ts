import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { recordAudit, runAudit } from "@/ingestion/audit";
import { runBackfill } from "@/ingestion/backfill";
import { loadCourseAliases, saveCourseAlias } from "@/ingestion/pipeline/course-aliases";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { upsertSchedule } from "@/ingestion/schedule/schedules";
import { runReleaseWatch } from "@/ingestion/watch";
import {
  ebsiListingHtml,
  installSources,
  makeContext,
  makeMp3,
  makePdf,
  resetDb,
  setupDb,
  startFakeSource,
  testSource,
  TEST_DB_URL,
  type FakeSource,
} from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

interface IndexRow {
  period: string;
  area: string;
  time: string;
  q?: string;
  a?: string;
  listen?: string;
  script?: string;
}

/** KICE 시험별 자료 표 (합성 — 머리글 텍스트만 공개 형식과 같다) */
function kiceIndexHtml(title: string, rows: IndexRow[]) {
  const cell = (href?: string) => (href ? `<td><a href="${href}">다운로드</a></td>` : "<td>-</td>");
  return `<html><body><h2>${title}</h2><table>
    <tr><th>교시</th><th>시험영역</th><th>정답 공개시간</th><th>문제</th><th>정답</th><th>듣기평가</th><th>음성대본</th></tr>
    ${rows
      .map(
        (r) =>
          `<tr><td>${r.period}</td><td>${r.area}</td><td>${r.time}</td>${cell(r.q)}${cell(r.a)}${cell(r.listen)}${cell(r.script)}</tr>`,
      )
      .join("")}
  </table></body></html>`;
}

run("live-source validation features (integration)", () => {
  let db: Database;
  let fake: FakeSource;
  let pdf: Uint8Array;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeSource();
    pdf = await makePdf(["TEST FIXTURE — NOT A REAL EXAM", "x".repeat(60)]);
  });
  afterAll(async () => {
    await fake?.close();
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    await db.delete(s.courseAliases);
    fake.routes.clear();
    fake.hits.length = 0;
  });

  describe("release watch: KICE 공식 공개 시각 + 자료 단위 polling", () => {
    const TITLE = "2026학년도 대학수학능력시험";
    const INDEX = "/exam/2026/index.html";
    const setIndex = (rows: IndexRow[]) =>
      fake.set(INDEX, {
        contentType: "text/html; charset=utf-8",
        body: kiceIndexHtml(TITLE, rows),
      });
    const hitsOf = (p: string) => fake.hits.filter((h) => h === p).length;
    const kst = (hhmm: string) => new Date(`2025-11-13T${hhmm}:00+09:00`);

    async function setup() {
      await installSources(db, [testSource("kice", "kice", fake.baseUrl)]);
      await upsertSchedule(db, {
        year: 2025,
        grade: 3,
        month: 11,
        examType: "csat",
        examDate: "2025-11-13",
        sourcePages: [
          { sourceId: "kice", url: `${fake.baseUrl}${INDEX}`, pageType: "exam_release_index" },
        ],
      });
      for (const f of ["kor_q", "kor_a", "eng_q", "eng_script"])
        fake.set(`/files/${f}.pdf`, { contentType: "application/pdf", body: pdf });
      fake.set("/files/eng.mp3", { contentType: "audio/mpeg", body: makeMp3() });
      return makeContext(db);
    }

    it("공식 시각 수집 → 2분 전 저빈도 → 공개 후 확인 → 확보한 자료는 다시 요청하지 않음", async () => {
      const { ctx, setNow } = await setup();
      setIndex([
        { period: "1", area: "국어", time: "10:56" },
        { period: "3", area: "영어", time: "17:04" },
      ]);

      // 08:00 공개 시각 표만 확인 (자료 링크 없음)
      setNow(kst("08:00"));
      let tick = await runReleaseWatch(ctx);
      expect(tick.schedules[0]).toMatchObject({ phase: "fetch_release_times", polled: ["kice"] });
      expect(tick.schedules[0]!.officialTimesApplied).toBeGreaterThan(0);
      const [exam] = await db.select().from(s.exams);
      const korean = await db
        .select()
        .from(s.artifactWatchStates)
        .where(
          and(
            eq(s.artifactWatchStates.examId, exam!.id),
            eq(s.artifactWatchStates.subject, "korean"),
          ),
        );
      expect(korean.map((k) => [k.expectedSource, k.expectedAt?.toISOString()])).toEqual([
        ["official", "2025-11-13T01:56:00.000Z"],
        ["official", "2025-11-13T01:56:00.000Z"],
      ]);

      // 09:00 공개 시각을 이미 알고, 아직 2분 전도 아님 → 요청 없음
      setNow(kst("09:00"));
      expect((await runReleaseWatch(ctx)).schedules[0]).toMatchObject({
        phase: "idle",
        polled: [],
      });

      // 10:54:30 공개 2분 전 → 저빈도 확인
      setNow(new Date("2025-11-13T10:54:30+09:00"));
      expect((await runReleaseWatch(ctx)).schedules[0]).toMatchObject({
        phase: "pre_release",
        polled: ["kice"],
      });

      // 10:57 공개됨 — 하지만 source 최소 간격(300초) 전이면 요청하지 않는다
      setIndex([
        { period: "1", area: "국어", time: "10:56", q: "/files/kor_q.pdf", a: "/files/kor_a.pdf" },
        { period: "3", area: "영어", time: "17:04" },
      ]);
      setNow(kst("10:57"));
      expect((await runReleaseWatch(ctx)).schedules[0]!.polled).toEqual([]);

      // 11:00 확인 → 국어 즉시 게시
      setNow(kst("11:00"));
      tick = await runReleaseWatch(ctx);
      expect(tick.schedules[0]).toMatchObject({ phase: "released", polled: ["kice"] });
      let files = await db.select().from(s.examFiles);
      expect(files.map((f) => `${f.subject}:${f.type}`).sort()).toEqual([
        "korean:question",
        "korean:solution",
      ]);
      expect(hitsOf("/files/kor_q.pdf")).toBe(1);

      // 17:05 영어 문제·대본 공개, 음원은 아직 → 국어 PDF 는 다시 요청하지 않는다
      setIndex([
        { period: "1", area: "국어", time: "10:56", q: "/files/kor_q.pdf", a: "/files/kor_a.pdf" },
        {
          period: "3",
          area: "영어",
          time: "17:04",
          q: "/files/eng_q.pdf",
          script: "/files/eng_script.pdf",
        },
      ]);
      setNow(kst("17:05"));
      await runReleaseWatch(ctx);
      files = await db.select().from(s.examFiles);
      expect(files.map((f) => `${f.subject}:${f.type}`).sort()).toEqual([
        "english:listening_script",
        "english:question",
        "korean:question",
        "korean:solution",
      ]);
      expect(hitsOf("/files/kor_q.pdf")).toBe(1);
      expect(hitsOf("/files/eng_q.pdf")).toBe(1);

      const states = await db
        .select()
        .from(s.artifactWatchStates)
        .where(eq(s.artifactWatchStates.subject, "english"));
      const byType = Object.fromEntries(states.map((st) => [st.type, st.status]));
      expect(byType).toMatchObject({
        question: "found",
        listening_audio: "waiting",
      });
      // 자료 발견 시 metadata(probe)로만 검증 — source_redirect 는 파일 전체를 저장하지 않는다
      const [engQ] = await db
        .select()
        .from(s.sourceArtifacts)
        .where(
          and(eq(s.sourceArtifacts.subject, "english"), eq(s.sourceArtifacts.type, "question")),
        );
      expect(engQ).toMatchObject({ verificationMode: "probe", sha256: null, storageKey: null });
    });
  });

  describe("backfill: health 구분 · 기능 게이트 · metadata-only · canary · audit", () => {
    const listing = (grade: 1 | 2 | 3, year: number, body: string, status = 200) => {
      const u = new URL(ebsiListingUrl(fake.baseUrl, grade, year));
      fake.set(u.pathname + u.search, { status, contentType: "text/html; charset=utf-8", body });
    };
    const EXAM = {
      id: "E-2025-2-09",
      title: "2025년 9월 고2 전국연합학력평가",
      subjects: [
        {
          name: "국어",
          links: [
            { label: "문제", path: "/files/kor_q.pdf" },
            { label: "해설", path: "/files/kor_a.pdf" },
          ],
        },
        { name: "사회탐구", links: [{ label: "윤리 문제", path: "/files/eth_q.pdf" }] },
      ],
    };
    const seed = () => {
      for (const y of [2020, 2021, 2022, 2023, 2024, 2025])
        for (const g of [1, 2, 3] as const) listing(g, y, ebsiListingHtml(fake.baseUrl, []));
      listing(2, 2025, ebsiListingHtml(fake.baseUrl, [EXAM]));
      for (const f of ["kor_q", "kor_a", "eth_q"])
        fake.set(`/files/${f}.pdf`, { contentType: "application/pdf", body: pdf });
    };
    const pdfHits = () => fake.hits.filter((h) => h.startsWith("/files/")).length;

    it("네트워크 장애(503)는 network_error, 구조 변경은 structure_changed — 같은 broken 으로 묶지 않는다", async () => {
      seed();
      listing(2, 2025, "busy", 503);
      await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
      const { ctx } = makeContext(db);
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2], runJobs: false });
      let [src] = await db.select().from(s.examSources);
      expect(src!.healthStatus).toBe("network_error");

      listing(2, 2025, `<main><section>개편된 페이지</section></main>`);
      await runBackfill(ctx, {
        fromYear: 2025,
        toYear: 2025,
        grades: [2],
        runJobs: false,
        force: true,
      });
      [src] = await db.select().from(s.examSources);
      expect(src!.healthStatus).toBe("structure_changed");
      // 구조 변경 상태에서는 운영 조건(검증 필요)에서 어떤 기능도 실행되지 않는다
      const prod = makeContext(db, { allowUnverifiedSources: false }).ctx;
      expect(
        (await runBackfill(prod, { fromYear: 2025, toYear: 2025, grades: [2] })).results,
      ).toEqual([]);
    });

    it("discovery 기능만 켠 source 는 시험 metadata 만 수집하고 자료 페이지/파일은 요청하지 않는다", async () => {
      seed();
      await installSources(db, [
        testSource("ebsi", "ebsi", fake.baseUrl, {
          capabilities: { discovery: true, artifacts: false, release_watch: false },
        }),
      ]);
      const { ctx } = makeContext(db);
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
      expect(await db.select().from(s.exams)).toHaveLength(1);
      expect(await db.select().from(s.sourceExams)).toHaveLength(1);
      expect(await db.select().from(s.sourceArtifacts)).toHaveLength(0);
      expect(pdfHits()).toBe(0);
    });

    it("--metadata-only: 공식 URL 까지만 (검증·다운로드·게시 없음), 재실행해도 중복 없음, 이후 전체 수집은 별도 checkpoint", async () => {
      seed();
      await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
      const { ctx } = makeContext(db);
      const opts = { fromYear: 2025, toYear: 2025, grades: [2 as const], metadataOnly: true };
      const first = await runBackfill(ctx, opts);
      expect(first.results[0]).toMatchObject({ scope: "backfill-metadata:2025:high2" });
      const artifacts = await db.select().from(s.sourceArtifacts);
      expect(artifacts).toHaveLength(3);
      expect(
        artifacts.every((a) => a.status === "discovered" || a.status === "manual_review"),
      ).toBe(true);
      expect(artifacts.map((a) => a.sourceLabel).sort()).toEqual([
        "국어 문제",
        "국어 해설",
        "사회탐구 윤리 문제",
      ]);
      expect(await db.select().from(s.jobs)).toHaveLength(0);
      expect(await db.select().from(s.examFiles)).toHaveLength(0);
      expect(pdfHits()).toBe(0);

      // 같은 명령 재실행 (force) → 시험/매핑/자료 중복 없음
      await runBackfill(ctx, { ...opts, force: true });
      expect(await db.select().from(s.exams)).toHaveLength(1);
      expect(await db.select().from(s.sourceExams)).toHaveLength(1);
      expect(await db.select().from(s.sourceArtifacts)).toHaveLength(3);

      // 전체 수집: metadata checkpoint 에 막히지 않고 검증·게시까지
      const full = await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
      expect(full.results[0]).toMatchObject({ scope: "backfill:2025:high2", status: "completed" });
      const files = await db.select().from(s.examFiles);
      expect(files.map((f) => f.type).sort()).toEqual(["question", "solution"]); // "윤리" 는 검토 대기
    });

    it("canary: 최근 1년 → audit 통과 → 최근 3년 → audit 통과 → 전체", async () => {
      seed();
      await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
      const { ctx } = makeContext(db); // 2025-09
      const wide = await runBackfill(ctx, { fromYear: 2020, toYear: 2025, grades: [2] });
      expect(wide.results).toEqual([
        expect.objectContaining({
          status: "blocked_canary",
          message: expect.stringMatching(/2022/),
        }),
      ]);
      const three = await runBackfill(ctx, { fromYear: 2022, toYear: 2025, grades: [2] });
      expect(three.results[0]!.status).toBe("blocked_canary");

      await runBackfill(ctx, { fromYear: 2024, toYear: 2025, grades: [2] }); // canary 1년
      const audit1 = await runAudit(db, {
        sourceId: "ebsi",
        fromYear: 2024,
        toYear: 2025,
        now: ctx.now(),
      });
      expect(audit1.passed).toBe(true);
      await recordAudit(db, audit1);
      const three2 = await runBackfill(ctx, { fromYear: 2022, toYear: 2025, grades: [2] });
      expect(three2.results.every((r) => r.status !== "blocked_canary")).toBe(true);
      expect(
        (await runBackfill(ctx, { fromYear: 2020, toYear: 2025, grades: [2] })).results[0]!.status,
      ).toBe("blocked_canary");
      await recordAudit(
        db,
        await runAudit(db, { sourceId: "ebsi", fromYear: 2022, toYear: 2025, now: ctx.now() }),
      );
      const all = await runBackfill(ctx, { fromYear: 2020, toYear: 2025, grades: [2] });
      expect(all.results.some((r) => r.status === "blocked_canary")).toBe(false);
    });

    it("audit: 누락·미확정·예상 밖 도메인을 구분해 보고 (시험 자체는 지우지 않는다)", async () => {
      seed();
      await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
      const { ctx } = makeContext(db);
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
      let report = await runAudit(db, { fromYear: 2025, toYear: 2025, now: ctx.now() });
      expect(report.passed).toBe(true);
      expect(report.counts).toMatchObject({ exams: 1, artifacts: 3, unresolved: 1 });
      const codes = report.warnings.map((w) => w.code);
      expect(codes).toContain("unresolved_course");
      expect(codes).toContain("missing_solution"); // 사회 해설 없음
      expect(codes).toContain("non_https_url"); // 로컬 fake source

      // 허용 도메인 밖 URL → blocking
      await db
        .update(s.sourceArtifacts)
        .set({ sourceUrl: "https://evil.example.com/k.pdf" })
        .where(eq(s.sourceArtifacts.type, "solution"));
      report = await runAudit(db, { fromYear: 2025, toYear: 2025, now: ctx.now() });
      expect(report.passed).toBe(false);
      expect(report.blocking.map((b) => b.code)).toContain("unexpected_domain");
      expect(await db.select().from(s.exams)).toHaveLength(1);
    });
  });

  describe("시험 체제 한정 alias / 새 영역 course", () => {
    it("syncCourseCatalog 가 직업탐구·제2외국어 course 를 넣고, 체제 한정 alias 가 저장·조회된다", async () => {
      await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
      const langs = await db
        .select()
        .from(s.courses)
        .where(eq(s.courses.subject, "second_language"));
      expect(langs).toHaveLength(9);
      expect(langs.find((c) => c.code === "japanese-1")?.regimes).toEqual([
        { regime: "csat_2022", grades: [3] },
      ]);

      await saveCourseAlias(db, {
        label: "물리Ⅰ",
        courseCode: "physics-1",
        sourceId: "ebsi",
        regimeCode: "legacy",
        createdBy: "admin",
      });
      // 같은 표기를 전체 체제용으로 따로 저장해도 충돌하지 않는다 (partial unique index)
      await saveCourseAlias(db, {
        label: "물리Ⅰ",
        courseCode: "physics-1",
        sourceId: "ebsi",
        createdBy: "admin",
      });
      // idempotent
      await saveCourseAlias(db, {
        label: "물리Ⅰ",
        courseCode: "physics-2",
        sourceId: "ebsi",
        regimeCode: "legacy",
        createdBy: "admin2",
      });
      const aliases = await loadCourseAliases(db);
      expect(aliases.map((a) => [a.alias, a.code, a.regime]).sort()).toEqual([
        ["물리1", "physics-1", null],
        ["물리1", "physics-2", "legacy"],
      ]);
    });
  });
});
