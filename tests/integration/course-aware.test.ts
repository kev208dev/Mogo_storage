import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "@/db/client";
import * as s from "@/db/schema";
import { mapArtifactCourse, approveArtifact } from "@/ingestion/admin-actions";
import { runBackfill } from "@/ingestion/backfill";
import { computeCoverage, formatCoverage } from "@/ingestion/coverage";
import { runJobs } from "@/ingestion/jobs/worker";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import {
  ebsiListingHtml,
  installSources,
  makeContext,
  makePdf,
  resetDb,
  setupDb,
  startFakeSource,
  testSource,
  TEST_DB_URL,
  type FakeSource,
  type ListingExam,
} from "./helpers";

describe.skipIf(!TEST_DB_URL)("course-aware ingestion (탐구 선택과목)", () => {
  let db: Database;
  let ebsi: FakeSource;
  let pdf: Uint8Array;

  const listing = (exams: ListingExam[], grade: 1 | 2 | 3 = 3, year = 2025) => {
    const u = new URL(ebsiListingUrl(ebsi.baseUrl, grade, year));
    ebsi.set(u.pathname + u.search, {
      contentType: "text/html",
      body: ebsiListingHtml(ebsi.baseUrl, exams),
    });
  };
  const files = (...paths: string[]) =>
    paths.forEach((p) => ebsi.set(p, { contentType: "application/pdf", body: pdf }));

  const SEPT: ListingExam = {
    id: "E-3-09",
    title: "2026학년도 9월 고3 모의평가",
    subjects: [
      {
        name: "사회탐구",
        links: [
          { label: "생활과 윤리 문제", path: "/f/ethics_q.pdf" },
          { label: "생활과윤리 해설", path: "/f/ethics_a.pdf" },
          { label: "사회·문화 문제지", path: "/f/soccul_q.pdf" },
          { label: "경제 문제", path: "/f/econ_q.pdf" },
        ],
      },
      { name: "과학탐구", links: [{ label: "물리학Ⅰ 문제", path: "/f/phy1_q.pdf" }] },
    ],
  };

  beforeAll(async () => {
    db = await setupDb();
    ebsi = await startFakeSource();
    pdf = await makePdf(["TEST FIXTURE — NOT A REAL EXAM", "x".repeat(60)]);
  });
  afterAll(async () => {
    await ebsi?.close();
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    ebsi.routes.clear();
    for (const g of [1, 2, 3] as const) listing([], g);
  });

  const courseOf = async (fileCourseId: string | null) =>
    fileCourseId
      ? (await db.select().from(s.courses).where(eq(s.courses.id, fileCourseId)))[0]!.code
      : null;

  it("stores several 탐구 courses of one subject as separate artifacts and files", async () => {
    listing([SEPT]);
    files(
      "/f/ethics_q.pdf",
      "/f/ethics_a.pdf",
      "/f/soccul_q.pdf",
      "/f/econ_q.pdf",
      "/f/phy1_q.pdf",
    );
    await installSources(db, [testSource("ebsi", "ebsi", ebsi.baseUrl)]);
    const { ctx, revalidated } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3] });

    const published = await db.select().from(s.examFiles);
    const keys = await Promise.all(
      published.map(async (f) => `${f.subject}:${await courseOf(f.courseId)}:${f.type}`),
    );
    expect(keys.sort()).toEqual([
      "science:physics-1:question",
      "social:economics:question",
      "social:life-and-ethics:question",
      "social:life-and-ethics:solution",
      "social:social-culture:question",
    ]);
    const lineup = await db.select().from(s.examCourses);
    expect(lineup.map((l) => l.courseId).sort()).toEqual([
      "economics",
      "life-and-ethics",
      "physics-1",
      "social-culture",
    ]);
    expect(revalidated).toContain("/exam/2025/high3/09/social/social-culture");

    // 사이트: 사회·문화 페이지는 사회·문화 자료만
    const { DrizzleExamRepository } = await import("@/lib/data/drizzle-repository");
    const repo = new DrizzleExamRepository(db);
    const detail = await repo.getSubjectDetail(
      { year: 2025, grade: 3, month: 9 },
      "social",
      "social-culture",
    );
    expect(detail?.course?.name).toBe("사회·문화");
    expect(detail?.files.map((f) => f.type)).toEqual(["question"]);
    expect(detail?.courseFileCounts).toMatchObject({
      "life-and-ethics": 2,
      "social-culture": 1,
      economics: 1,
    });
    expect(
      await repo.getSubjectDetail({ year: 2025, grade: 3, month: 9 }, "social", "physics-1"),
    ).toBeNull();
    const subjectPage = await repo.getSubjectDetail({ year: 2025, grade: 3, month: 9 }, "social");
    expect(subjectPage?.files).toEqual([]); // 영역 페이지에는 과목 구분 없는 자료만
    expect(subjectPage?.courses.map((c) => c.code)).toEqual([
      "life-and-ethics",
      "economics",
      "social-culture",
    ]);
  });

  it("dedupes by canonical course + type, never by file title", async () => {
    listing([
      {
        ...SEPT,
        subjects: [
          {
            name: "사회탐구",
            links: [
              { label: "사회문화 문제", path: "/f/soccul_q.pdf" },
              { label: "사회·문화 문제지", path: "/f/soccul_q.pdf" },
            ],
          },
        ],
      },
    ]);
    files("/f/soccul_q.pdf");
    await installSources(db, [testSource("ebsi", "ebsi", ebsi.baseUrl)]);
    const { ctx } = makeContext(db);
    for (let i = 0; i < 3; i += 1)
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3], force: true });
    const artifacts = await db.select().from(s.sourceArtifacts);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ slotKey: "social-culture", courseId: "social-culture" });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);
  });

  it("source priority is computed per course: KICE 사회·문화 wins, EBSi-only 생활과 윤리 still publishes", async () => {
    const kice = await startFakeSource();
    try {
      listing([SEPT]);
      files(
        "/f/ethics_q.pdf",
        "/f/ethics_a.pdf",
        "/f/soccul_q.pdf",
        "/f/econ_q.pdf",
        "/f/phy1_q.pdf",
      );
      kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=1", {
        contentType: "text/html",
        body: `<table class="board_list"><tbody><tr><td class="subject"><a href="/boardCnts/view.do?boardSeq=9">2026학년도 대학수학능력시험 9월 모의평가 문제 및 정답</a></td><td class="date">2025-09-03</td></tr></tbody></table>`,
      });
      kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=2", {
        contentType: "text/html",
        body: `<p class="no_data"></p>`,
      });
      kice.set("/boardCnts/view.do?boardSeq=9", {
        contentType: "text/html",
        body: `<ul class="file_list"><li><a href="/down/9/sc.pdf">사회탐구영역_사회·문화_문제지.pdf</a></li></ul>`,
      });
      kice.set("/down/9/sc.pdf", { contentType: "application/pdf", body: pdf });
      await installSources(db, [
        testSource("ebsi", "ebsi", ebsi.baseUrl),
        testSource("kice", "kice", kice.baseUrl),
      ]);
      const { ctx } = makeContext(db);
      await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3] });

      const byCourse = Object.fromEntries(
        (await db.select().from(s.examFiles).where(eq(s.examFiles.type, "question"))).map((f) => [
          f.courseId,
          f.sourceLabel,
        ]),
      );
      expect(byCourse["social-culture"]).toBe("한국교육과정평가원");
      expect(byCourse["life-and-ethics"]).toBe("EBSi");
      expect(await db.select().from(s.exams)).toHaveLength(1);
    } finally {
      await kice.close();
    }
  });

  it("an ambiguous course label goes to manual review; the admin mapping publishes it and is reused next time", async () => {
    listing([
      {
        ...SEPT,
        subjects: [{ name: "사회탐구", links: [{ label: "윤리 문제", path: "/f/ethics_q.pdf" }] }],
      },
    ]);
    files("/f/ethics_q.pdf");
    await installSources(db, [testSource("ebsi", "ebsi", ebsi.baseUrl)]);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3] });

    let [artifact] = await db.select().from(s.sourceArtifacts);
    expect(artifact).toMatchObject({
      status: "manual_review",
      slotKey: "unresolved:윤리",
      courseId: null,
      courseLabel: "윤리 문제",
    });
    expect(artifact!.statusReason).toContain("ambiguous course");
    expect(artifact!.contentFingerprint).toMatch(/^probe:/); // 검증(metadata)은 끝났다
    expect(await db.select().from(s.examFiles)).toHaveLength(0); // 자동 게시 안 함
    await expect(approveArtifact(ctx, artifact!.id)).rejects.toThrow(/세부과목/);

    await mapArtifactCourse(ctx, {
      artifactId: artifact!.id,
      courseCode: "life-and-ethics",
      admin: "ops@example.com",
    });
    await runJobs(ctx);
    const [file] = await db.select().from(s.examFiles);
    expect(file).toMatchObject({ courseId: "life-and-ethics", type: "question" });
    const [alias] = await db.select().from(s.courseAliases);
    expect(alias).toMatchObject({
      alias: "윤리문제",
      courseId: "life-and-ethics",
      sourceId: "ebsi",
      createdBy: "ops@example.com",
    });

    // 다음 시험에서 같은 표기 → alias 로 자동 확정, 검토 없이 게시
    listing([
      SEPT,
      {
        id: "E-3-06",
        title: "2026학년도 6월 고3 모의평가",
        subjects: [
          { name: "사회탐구", links: [{ label: "윤리 문제", path: "/f/june_ethics.pdf" }] },
        ],
      },
    ]);
    files("/f/june_ethics.pdf");
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3], force: true });
    [artifact] = await db
      .select()
      .from(s.sourceArtifacts)
      .where(eq(s.sourceArtifacts.sourceUrl, `${ebsi.baseUrl}/f/june_ethics.pdf`));
    expect(artifact).toMatchObject({ status: "ready", slotKey: "life-and-ethics" });
    expect(await db.select().from(s.examFiles)).toHaveLength(2);
  });

  it("archives with several courses are kept for review and never auto-published", async () => {
    listing([
      {
        ...SEPT,
        subjects: [
          {
            name: "사회탐구",
            links: [{ label: "사회탐구 전체 문제 (압축)", path: "/f/social_all.zip" }],
          },
        ],
      },
    ]);
    ebsi.set("/f/social_all.zip", {
      contentType: "application/zip",
      body: new Uint8Array([0x50, 0x4b, 3, 4]),
    });
    await installSources(db, [testSource("ebsi", "ebsi", ebsi.baseUrl)]);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3] });
    const [artifact] = await db.select().from(s.sourceArtifacts);
    expect(artifact).toMatchObject({
      containerType: "archive",
      containsMultipleCourses: true,
      status: "manual_review",
    });
    expect(ebsi.hits).not.toContain("/f/social_all.zip"); // 압축 해제·검증 시도하지 않음
    expect(await db.select().from(s.examFiles)).toHaveLength(0);
  });

  it("exam_files / questions / grade_cuts uniqueness is safe with NULL course", async () => {
    const [exam] = await db
      .insert(s.exams)
      .values({
        year: 2025,
        grade: 3,
        month: 9,
        examType: "kice_mock",
        organizer: "x",
        slug: "2025-high3-09",
      })
      .returning();
    const file = (courseId: string | null, key: string) => ({
      examId: exam!.id,
      subject: "social" as const,
      courseId,
      type: "question" as const,
      storageKey: key,
      mimeType: "application/pdf",
      originalFileName: "x.pdf",
    });
    await db.insert(s.examFiles).values(file(null, "a"));
    await expect(db.insert(s.examFiles).values(file(null, "b"))).rejects.toThrow(); // NULL course 도 중복 불가
    await db.insert(s.examFiles).values(file("social-culture", "c"));
    await db.insert(s.examFiles).values(file("life-and-ethics", "d")); // 다른 course 는 허용
    await expect(db.insert(s.examFiles).values(file("social-culture", "e"))).rejects.toThrow();

    const q = (courseId: string | null) => ({
      examId: exam!.id,
      subject: "social" as const,
      courseId,
      questionNumber: 1,
      answer: "3",
      score: 2,
    });
    await db.insert(s.questions).values([q(null), q("social-culture"), q("life-and-ethics")]);
    await expect(db.insert(s.questions).values(q("social-culture"))).rejects.toThrow();
    await expect(db.insert(s.questions).values(q(null))).rejects.toThrow();

    const g = (courseId: string | null) => ({
      examId: exam!.id,
      subject: "social" as const,
      courseId,
      source: "official" as const,
      isOfficial: true,
      cuts: [{ grade: 1, rawScore: 47 }],
    });
    await db.insert(s.gradeCuts).values([g("social-culture"), g("life-and-ethics")]);
    await expect(db.insert(s.gradeCuts).values(g("social-culture"))).rejects.toThrow();

    const { DrizzleExamRepository } = await import("@/lib/data/drizzle-repository");
    await db.insert(s.examSubjects).values({ examId: exam!.id, subject: "social" });
    const detail = await new DrizzleExamRepository(db).getSubjectDetail(
      { year: 2025, grade: 3, month: 9 },
      "social",
      "social-culture",
    );
    expect(detail?.questions.map((x) => x.courseId)).toEqual(["social-culture"]);
    expect(detail?.gradeCuts.map((x) => x.courseId)).toEqual(["social-culture"]);
  });

  it("coverage reports each course and unresolved items", async () => {
    listing([
      {
        ...SEPT,
        subjects: [
          ...SEPT.subjects,
          { name: "사회탐구", links: [{ label: "지리 문제", path: "/f/geo.pdf" }] },
        ],
      },
    ]);
    files(
      "/f/ethics_q.pdf",
      "/f/ethics_a.pdf",
      "/f/soccul_q.pdf",
      "/f/econ_q.pdf",
      "/f/phy1_q.pdf",
      "/f/geo.pdf",
    );
    await installSources(db, [testSource("ebsi", "ebsi", ebsi.baseUrl)]);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [3] });
    const report = await computeCoverage(db);
    const social = report.exams[0]!.subjects.find((x) => x.subject === "social")!;
    expect(social.courses.map((c) => [c.name, c.slots.map((sl) => sl.state)])).toEqual([
      ["생활과 윤리", ["published", "published"]],
      ["경제", ["published", "missing"]],
      ["사회·문화", ["published", "missing"]],
    ]);
    expect(social.unresolved).toMatchObject([{ label: "지리 문제", type: "question" }]);
    const text = formatCoverage(report);
    expect(text).toContain("사회탐구");
    expect(text).toMatch(/생활과 윤리\s+시험지 ✓\s+정답·해설 ✓/);
    expect(text).toMatch(/사회·문화\s+시험지 ✓\s+정답·해설 ✗/);
    expect(text).toContain('과목 미확정 "지리 문제"');
  });
});

describe.skipIf(!TEST_DB_URL)("migration 0002 on an existing (pre-course) database", () => {
  it("keeps legacy social/science data with course_id = NULL and adds the catalog", async () => {
    const admin = createDb(TEST_DB_URL!, 1);
    const name = `mogo_mig_${Date.now()}`;
    await admin.execute(sql.raw(`create database ${name}`));
    const url = TEST_DB_URL!.replace(/\/[^/]+$/, `/${name}`);
    const db = createDb(url, 2);
    try {
      // 0000 + 0001 만 적용한 "이전 버전" DB
      const oldDir = mkdtempSync(path.join(os.tmpdir(), "drizzle-old-"));
      cpSync("drizzle", oldDir, { recursive: true });
      const journalPath = path.join(oldDir, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 1);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(db, { migrationsFolder: oldDir });

      await db.execute(
        sql`insert into exams (id, year, grade, month, exam_type, organizer, slug) values ('e1', 2024, 3, 9, 'kice_mock', 'x', '2024-high3-09')`,
      );
      await db.execute(
        sql`insert into exam_subjects (id, exam_id, subject, question_count, total_score) values ('s1', 'e1', 'social', 20, 50), ('s2', 'e1', 'science', 20, 50)`,
      );
      await db.execute(
        sql`insert into exam_files (id, exam_id, subject, type, storage_key, mime_type, file_size, original_file_name) values ('f1', 'e1', 'social', 'question', 'k1', 'application/pdf', 1, 'a.pdf'), ('f2', 'e1', 'science', 'question', 'k2', 'application/pdf', 1, 'b.pdf')`,
      );
      await db.execute(
        sql`insert into questions (id, exam_id, subject, question_number, answer, score) values ('q1', 'e1', 'social', 1, '3', 2)`,
      );
      await db.execute(
        sql`insert into grade_cuts (id, exam_id, subject, source, cuts) values ('g1', 'e1', 'social', 'official', '[]')`,
      );

      await migrate(db, { migrationsFolder: "drizzle" });

      const files = await db.select().from(s.examFiles);
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.courseId === null)).toBe(true); // 임의 mapping 금지
      expect((await db.select().from(s.questions))[0]!.courseId).toBeNull();
      expect((await db.select().from(s.gradeCuts))[0]!.courseId).toBeNull();
      expect(await db.select().from(s.courses)).toHaveLength(24);
      expect(await db.select().from(s.examCourses)).toHaveLength(0);
      // 기존 NULL course 자료의 uniqueness 는 그대로
      await expect(
        db.execute(
          sql`insert into exam_files (id, exam_id, subject, type, storage_key, mime_type, original_file_name) values ('f3', 'e1', 'social', 'question', 'k3', 'application/pdf', 'c.pdf')`,
        ),
      ).rejects.toThrow();
    } finally {
      await db.$client.end({ timeout: 5 });
      await admin.execute(sql.raw(`drop database if exists ${name}`));
      await admin.$client.end({ timeout: 5 });
    }
  });
});
