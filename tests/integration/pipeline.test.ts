import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runBackfill, queueRechecks, retryArtifact } from "@/ingestion/backfill";
import { claimJobs, enqueueJob, failJob } from "@/ingestion/jobs/queue";
import { runJobs } from "@/ingestion/jobs/worker";
import { runDiscovery } from "@/ingestion/pipeline/discovery";
import { withAdvisoryLock } from "@/ingestion/pipeline/locks";
import { upsertSchedule } from "@/ingestion/schedule/schedules";
import { runReleaseWatch } from "@/ingestion/watch";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
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
  type ListingExam,
} from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

run("automatic ingestion pipeline (fake official source → DB → site)", () => {
  let db: Database;
  let fake: FakeSource;
  let pdfQ: Uint8Array;
  let pdfSolutionEnglish: Uint8Array;

  const listingPath = (grade: 1 | 2 | 3, year: number) => {
    const u = new URL(ebsiListingUrl(fake.baseUrl, grade, year));
    return u.pathname + u.search;
  };
  const setListing = (grade: 1 | 2 | 3, year: number, exams: ListingExam[]) =>
    fake.set(listingPath(grade, year), {
      contentType: "text/html; charset=utf-8",
      body: ebsiListingHtml(fake.baseUrl, exams),
    });
  const pdf = (path: string, body = pdfQ) =>
    fake.set(path, { contentType: "application/pdf", body });

  const SEPT: ListingExam = {
    id: "E-2025-2-09",
    title: "2025년 9월 고2 전국연합학력평가",
    date: "2025.09.03",
    subjects: [
      {
        name: "국어",
        links: [
          { label: "문제", path: "/files/kor_q.pdf" },
          { label: "해설", path: "/files/kor_a.pdf" },
        ],
      },
      {
        name: "영어",
        links: [
          { label: "문제", path: "/files/eng_q.pdf" },
          { label: "정답 및 해설", path: "/files/eng_a.pdf" },
          { label: "듣기", path: "/files/eng.mp3" },
        ],
      },
    ],
  };

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeSource();
    pdfQ = await makePdf(["TEST FIXTURE — NOT A REAL EXAM", "x".repeat(60)]);
    pdfSolutionEnglish = await makePdf([
      "TEST FIXTURE — NOT A REAL EXAM",
      "18. 정답 ③",
      "[어휘]",
      "renovation 보수, 개조",
      "facility 시설",
      "19. 정답 ②",
      "[어휘]",
      "interaction 상호작용",
      "20. 정답 ①",
      "significant 중요한",
    ]);
  });

  afterAll(async () => {
    await fake?.close();
    await db?.$client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetDb(db);
    fake.routes.clear();
    for (const year of [2024, 2025]) for (const g of [1, 2, 3] as const) setListing(g, year, []);
    process.env.VOCABULARY_PIPELINE_ENABLED = "true";
  });

  async function seedSeptember() {
    setListing(2, 2025, [SEPT]);
    for (const f of ["/files/kor_q.pdf", "/files/kor_a.pdf", "/files/eng_q.pdf"]) pdf(f);
    pdf("/files/eng_a.pdf", pdfSolutionEnglish);
    fake.set("/files/eng.mp3", { contentType: "audio/mpeg", body: makeMp3() });
  }

  it("discover → verify → publish → exam page data → download redirect", async () => {
    await seedSeptember();
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx, revalidated, logs } = makeContext(db);

    const { results, jobs } = await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    expect(results[0]).toMatchObject({ source: "ebsi", status: "completed" });
    expect(jobs?.failed).toBe(0);

    const [exam] = await db.select().from(s.exams);
    expect(exam).toMatchObject({
      year: 2025,
      grade: 2,
      month: 9,
      examType: "school_mock",
      isSample: false,
      examDate: "2025-09-03",
    });

    const files = await db.select().from(s.examFiles).where(eq(s.examFiles.examId, exam!.id));
    const byKey = Object.fromEntries(files.map((f) => [`${f.subject}:${f.type}`, f]));
    expect(Object.keys(byKey).sort()).toEqual([
      "english:listening_audio",
      "english:question",
      "english:solution",
      "english:vocabulary_pdf",
      "korean:question",
      "korean:solution",
    ]);
    expect(byKey["korean:question"]).toMatchObject({
      deliveryType: "redirect",
      externalUrl: `${fake.baseUrl}/files/kor_q.pdf`,
      storageKey: null,
      artifactOrigin: "official",
      sourceLabel: "EBSi",
    });
    // 우리가 만든 단어장 PDF 는 generated 로 분리된다
    expect(byKey["english:vocabulary_pdf"]).toMatchObject({
      deliveryType: "storage",
      artifactOrigin: "generated",
    });

    // provenance
    const artifacts = await db.select().from(s.sourceArtifacts);
    for (const a of artifacts) {
      expect(a.status).toBe("ready");
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.verifiedAt).not.toBeNull();
      expect(a.firstDiscoveredAt).not.toBeNull();
    }
    expect(revalidated).toContain("/exam/2025/high2/09");
    const events = logs.map((l) => l.event);
    for (const e of [
      "ingestion.started",
      "exam.discovered",
      "artifact.discovered",
      "artifact.verified",
      "artifact.published",
      "ingestion.completed",
    ]) {
      expect(events).toContain(e);
    }

    // 사이트: 저장소 → 시험 페이지 데이터 → 다운로드 버튼 → 공식 URL 로 redirect
    process.env.DATABASE_URL = TEST_DB_URL;
    const { DrizzleExamRepository } = await import("@/lib/data/drizzle-repository");
    const detail = await new DrizzleExamRepository(db).getSubjectDetail(
      { year: 2025, grade: 2, month: 9 },
      "english",
    );
    expect(detail?.files.map((f) => f.type).sort()).toEqual([
      "listening_audio",
      "question",
      "solution",
      "vocabulary_pdf",
    ]);
    expect(detail?.vocabulary.map((v) => `${v.questionNumber}:${v.word}`)).toEqual([
      "18:facility",
      "18:renovation",
      "19:interaction",
    ]);

    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ExamFiles } = await import("@/components/exam/ExamFiles");
    const html = renderToStaticMarkup(
      createElement(ExamFiles, {
        files: detail!.files,
        examId: exam!.id,
        subject: "english",
        title: "2025년 고2 9월 모의고사 영어",
      }),
    );
    const question = detail!.files.find((f) => f.type === "question")!;
    expect(html).toContain(`/api/files/${question.id}/download`);
    expect(html).not.toContain(fake.baseUrl); // 공식 URL 을 화면에 하드코딩하지 않는다
    expect(html).toContain("출처: EBSi");

    const { redirectToFile } = await import("@/lib/server/file-redirect");
    const res = await redirectToFile(question.id, "download");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${fake.baseUrl}/files/eng_q.pdf`);
  });

  it("is idempotent: running the same job 10 times creates no duplicates", async () => {
    await seedSeptember();
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx } = makeContext(db);
    const counts = async () => {
      const [row] = await db.execute<Record<string, number>>(sql`select
        (select count(*)::int from exams) exams, (select count(*)::int from exam_subjects) subjects,
        (select count(*)::int from source_exams) mappings, (select count(*)::int from source_artifacts) artifacts,
        (select count(*)::int from exam_files) files, (select count(*)::int from jobs) jobs,
        (select count(*)::int from vocabulary) vocab`);
      return row;
    };
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const first = await counts();
    for (let i = 0; i < 10; i += 1) {
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2], force: true });
    }
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({ exams: 1, mappings: 1, artifacts: 5, files: 6 });
  });

  it("backfill checkpoint skips completed scopes and resumes failed ones", async () => {
    await seedSeptember();
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx } = makeContext(db);
    fake.routes.delete(listingPath(3, 2025)); // 고3 목록 404 → 실패
    const first = await runBackfill(ctx, {
      fromYear: 2025,
      toYear: 2025,
      grades: [2, 3],
      runJobs: false,
    });
    expect(first.results.map((r) => r.status)).toEqual(["completed", "failed"]);

    setListing(3, 2025, []);
    fake.hits.length = 0;
    const second = await runBackfill(ctx, {
      fromYear: 2025,
      toYear: 2025,
      grades: [2, 3],
      runJobs: false,
    });
    expect(second.results.map((r) => r.status)).toEqual(["skipped_checkpoint", "completed"]);
    expect(fake.hits.some((h) => h.includes("D200"))).toBe(false); // 완료된 범위는 다시 요청하지 않음
  });

  it("publishes each artifact independently as soon as it is ready", async () => {
    await installSources(db, [
      testSource("ebsi", "ebsi", fake.baseUrl, { minPollIntervalSeconds: 300 }),
    ]);
    await upsertSchedule(db, {
      year: 2025,
      grade: 2,
      month: 9,
      examType: "school_mock",
      examDate: "2025-09-03",
    });
    const { ctx, setNow } = makeContext(db);

    // 14:03 문제지만 공개
    setListing(2, 2025, [
      {
        ...SEPT,
        subjects: [{ name: "영어", links: [{ label: "문제", path: "/files/eng_q.pdf" }] }],
      },
    ]);
    pdf("/files/eng_q.pdf");
    setNow(new Date("2025-09-03T14:03:00+09:00"));
    const tick1 = await runReleaseWatch(ctx);
    expect(tick1.schedules[0]).toMatchObject({ state: "watching", polled: ["ebsi"] });
    let types = (await db.select().from(s.examFiles)).map((f) => f.type);
    expect(types).toEqual(["question"]);
    const [sched] = await db.select().from(s.examSchedules);
    expect(sched!.status).toBe("published");

    // 14:05 해설 공개 — 하지만 source 최소 간격(300초) 전이므로 요청하지 않는다
    setListing(2, 2025, [
      {
        ...SEPT,
        subjects: [
          {
            name: "영어",
            links: [
              { label: "문제", path: "/files/eng_q.pdf" },
              { label: "해설", path: "/files/eng_a.pdf" },
            ],
          },
        ],
      },
    ]);
    pdf("/files/eng_a.pdf");
    setNow(new Date("2025-09-03T14:05:00+09:00"));
    expect((await runReleaseWatch(ctx)).schedules[0]!.polled).toEqual([]);

    // 14:09 다시 확인 → 해설 즉시 게시
    setNow(new Date("2025-09-03T14:09:00+09:00"));
    expect((await runReleaseWatch(ctx)).schedules[0]!.polled).toEqual(["ebsi"]);
    types = (await db.select().from(s.examFiles)).map((f) => f.type).sort();
    expect(types).toContain("solution");
  });

  it("does not poll outside the release window", async () => {
    fake.hits.length = 0;
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    await upsertSchedule(db, {
      year: 2025,
      grade: 2,
      month: 9,
      examType: "school_mock",
      examDate: "2025-09-03",
    });
    const { ctx, setNow } = makeContext(db);
    setNow(new Date("2025-09-03T09:00:00+09:00")); // 시험 당일이지만 공개 시간대 이전
    const early = await runReleaseWatch(ctx);
    expect(early.schedules[0]).toMatchObject({ state: "outside_window", polled: [] });
    expect(fake.hits).toHaveLength(0);
    setNow(new Date("2025-09-02T20:00:00+09:00")); // 시험 전날: 감시 대상 아님
    expect(await runReleaseWatch(ctx)).toMatchObject({ schedules: [] });
    setNow(new Date("2025-09-05T09:00:00+09:00")); // 감시 종료 후
    expect((await runReleaseWatch(ctx)).schedules[0]).toMatchObject({
      state: "window_closed",
      polled: [],
    });
    expect(fake.hits).toHaveLength(0);
  });

  it("detects content changes at the same URL and republishes", async () => {
    await seedSeptember();
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx, setNow, logs } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const [before] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(and(eq(s.sourceArtifacts.subject, "korean"), eq(s.sourceArtifacts.type, "question")));

    pdf("/files/kor_q.pdf", await makePdf(["TEST FIXTURE — corrected version", "y".repeat(60)]));
    setNow(new Date("2025-09-20T10:00:00+09:00"));
    expect(await queueRechecks(ctx)).toBeGreaterThan(0);
    await runJobs(ctx);
    const [after] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.id, before!.id));
    expect(after!.sha256).not.toBe(before!.sha256);
    expect(after!.status).toBe("ready");
    expect(logs.some((l) => l.event === "artifact.changed")).toBe(true);
  });

  it("rejects HTML error pages served as PDF and keeps the slot unpublished", async () => {
    setListing(2, 2025, [
      {
        ...SEPT,
        subjects: [{ name: "국어", links: [{ label: "문제", path: "/files/kor_q.pdf" }] }],
      },
    ]);
    fake.set("/files/kor_q.pdf", {
      contentType: "application/pdf",
      body: "<!DOCTYPE html><html><body>로그인이 필요합니다</body></html>".padEnd(2000),
    });
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const [a] = await db.select().from(s.sourceArtifacts);
    expect(a).toMatchObject({ status: "failed" });
    expect(a!.statusReason).toContain("HTML_RESPONSE");
    expect(await db.select().from(s.examFiles)).toHaveLength(0);
    const [err] = await db
      .select()
      .from(s.ingestionErrors)
      .where(eq(s.ingestionErrors.code, "HTML_RESPONSE"));
    expect(err).toBeDefined();
  });

  it("merges the same exam from two sources and publishes by priority (KICE > EBSi for 모의평가)", async () => {
    const kice = await startFakeSource();
    try {
      // EBSi 목록
      setListing(3, 2025, [
        {
          id: "E-3-09",
          title: "2026학년도 9월 고3 모의평가",
          subjects: [{ name: "국어", links: [{ label: "문제", path: "/files/k3.pdf" }] }],
        },
      ]);
      pdf("/files/k3.pdf");
      // KICE 게시판 (다른 이름으로 같은 시험)
      kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=1", {
        contentType: "text/html",
        body: `<table class="board_list"><tbody><tr><td class="subject"><a href="/boardCnts/view.do?boardSeq=77">2025년 9월 모의평가 문제 및 정답</a></td><td class="date">2025-09-03</td></tr></tbody></table>`,
      });
      kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=2", {
        contentType: "text/html",
        body: `<p class="no_data"></p>`,
      });
      kice.set("/boardCnts/view.do?boardSeq=77", {
        contentType: "text/html",
        body: `<ul class="file_list"><li><a href="/down/77/kor.pdf">국어영역_문제지.pdf</a></li></ul>`,
      });
      kice.set("/down/77/kor.pdf", { contentType: "application/pdf", body: pdfQ });

      await installSources(db, [
        testSource("ebsi", "ebsi", fake.baseUrl),
        testSource("kice", "kice", kice.baseUrl),
      ]);
      const { ctx } = makeContext(db);
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3], sourceIds: ["ebsi"] });
      let [file] = await db.select().from(s.examFiles);
      expect(file!.sourceLabel).toBe("EBSi"); // 처음에는 EBSi 만 있음

      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3], sourceIds: ["kice"] });
      const examRows = await db.select().from(s.exams);
      expect(examRows).toHaveLength(1); // 중복 Exam 없음
      expect(examRows[0]).toMatchObject({ year: 2025, academicYear: 2026, examType: "kice_mock" });
      expect(await db.select().from(s.sourceExams)).toHaveLength(2);
      [file] = await db.select().from(s.examFiles);
      expect(file!.sourceLabel).toBe("한국교육과정평가원"); // 우선순위 높은 원본 source 로 교체
      expect(file!.externalUrl).toBe(`${kice.baseUrl}/down/77/kor.pdf`);
    } finally {
      await kice.close();
    }
  });

  it("mirror_allowed stores the file in our storage; manual_review waits for approval", async () => {
    setListing(2, 2025, [
      {
        ...SEPT,
        subjects: [{ name: "국어", links: [{ label: "문제", path: "/files/kor_q.pdf" }] }],
      },
    ]);
    pdf("/files/kor_q.pdf");
    await installSources(db, [
      testSource("ebsi", "ebsi", fake.baseUrl, { deliveryPolicy: "mirror_allowed" }),
    ]);
    const { ctx, storageDir } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const [file] = await db.select().from(s.examFiles);
    expect(file).toMatchObject({ deliveryType: "storage", externalUrl: null });
    expect(file!.storageKey).toMatch(
      /^official\/2025-high2-09\/korean\/question-[0-9a-f]{16}\.pdf$/,
    );
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(`${storageDir}/${file!.storageKey}`).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );

    await resetDb(db);
    await installSources(db, [
      testSource("ebsi", "ebsi", fake.baseUrl, { deliveryPolicy: "manual_review" }),
    ]);
    const second = makeContext(db);
    await runBackfill(second.ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    const [artifact] = await db.select().from(s.sourceArtifacts);
    expect(artifact!.status).toBe("manual_review");
    expect(await db.select().from(s.examFiles)).toHaveLength(0);

    const { approveArtifact } = await import("@/ingestion/admin-actions");
    await approveArtifact(second.ctx, artifact!.id);
    await runJobs(second.ctx);
    expect(await db.select().from(s.examFiles)).toHaveLength(1);
  });

  it("a structure change marks the source broken with a clear error", async () => {
    fake.set(listingPath(2, 2025), {
      contentType: "text/html",
      body: `<div class="exam-archive"><article>개편</article></div>`,
    });
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx } = makeContext(db);
    const { results } = await runBackfill(ctx, {
      fromYear: 2025,
      toYear: 2025,
      grades: [2],
      runJobs: false,
    });
    expect(results[0]!.status).toBe("failed");
    const [source] = await db.select().from(s.examSources);
    expect(source!.healthStatus).toBe("broken");
    expect(source!.healthMessage).toContain("SOURCE_STRUCTURE_CHANGED");
    expect(source!.failureCount).toBe(1);
  });

  it("job retry uses exponential backoff and stops after maxAttempts; manual retry re-queues", async () => {
    setListing(2, 2025, [
      {
        ...SEPT,
        subjects: [{ name: "국어", links: [{ label: "문제", path: "/files/kor_q.pdf" }] }],
      },
    ]);
    fake.set("/files/kor_q.pdf", { status: 503, contentType: "text/plain", body: "busy" });
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx, setNow } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    let [job] = await db.select().from(s.jobs);
    expect(job).toMatchObject({ status: "retrying", attempts: 1 });
    const firstDelay = job!.runAt.getTime() - ctx.now().getTime();
    expect(firstDelay).toBe(30_000);

    for (let i = 0; i < 10; i += 1) {
      setNow(new Date(ctx.now().getTime() + 2 * 60 * 60 * 1000));
      await runJobs(ctx);
    }
    [job] = await db.select().from(s.jobs);
    expect(job).toMatchObject({ status: "failed", attempts: 5 });

    // 원본이 복구된 뒤 관리자 수동 재시도
    pdf("/files/kor_q.pdf");
    const [artifact] = await db.select().from(s.sourceArtifacts);
    await retryArtifact(ctx, artifact!.id);
    await runJobs(ctx);
    expect(await db.select().from(s.examFiles)).toHaveLength(1);
  });

  it("locking: concurrent claims never return the same job; concurrent discovery runs once", async () => {
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    for (let i = 0; i < 20; i += 1) {
      await enqueueJob(db, { type: "publish_artifact", payload: { i }, dedupeKey: `t:${i}` });
    }
    const [a, b, c] = await Promise.all([
      claimJobs(db, { limit: 10, workerId: "a" }),
      claimJobs(db, { limit: 10, workerId: "b" }),
      claimJobs(db, { limit: 10, workerId: "c" }),
    ]);
    const ids = [...a, ...b, ...c].map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);

    // 같은 source discovery 가 동시에 두 번 → 하나는 lock 으로 건너뜀
    const release = withAdvisoryLock(
      db,
      "ingest:discover:ebsi",
      () => new Promise((r) => setTimeout(r, 300)),
    );
    await new Promise((r) => setTimeout(r, 50));
    const { ctx } = makeContext(db);
    const blocked = await runDiscovery(ctx, {
      source: testSource("ebsi", "ebsi", fake.baseUrl),
      mode: "scheduled",
      options: { fromYear: 2025, toYear: 2025 },
    });
    expect(blocked.status).toBe("locked");
    await release;

    // failJob 은 maxAttempts 를 넘기지 않는다
    const [job] = await db.select().from(s.jobs).limit(1);
    expect(
      await failJob(
        db,
        { id: job!.id, attempts: 5, maxAttempts: 5 },
        { message: "x", retryable: true },
      ),
    ).toBe("failed");
  });
});
