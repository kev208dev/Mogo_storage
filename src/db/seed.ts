/**
 * 개발용 샘플 데이터를 PostgreSQL에 넣는다.
 *   DATABASE_URL=... npm run db:migrate && npm run db:seed
 *
 * ⚠️ 실제 시험 데이터가 아니다. 모든 레코드는 is_sample=true 로 들어간다.
 */
import { sampleDataset } from "../lib/data/sample-data";
import { getDb } from "./client";
import * as s from "./schema";

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL이 설정되지 않았습니다. .env.example 을 참고하세요.");
    process.exit(1);
  }
  const d = sampleDataset;
  const chunk = <T>(rows: T[], size = 500) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
      rows.slice(i * size, i * size + size),
    );

  await db.transaction(async (tx) => {
    for (const rows of chunk(d.exams)) {
      await tx
        .insert(s.exams)
        .values(
          rows.map((e) => ({
            ...e,
            createdAt: new Date(e.createdAt),
            updatedAt: new Date(e.updatedAt),
          })),
        )
        .onConflictDoNothing();
    }
    for (const rows of chunk(d.examSubjects)) {
      await tx.insert(s.examSubjects).values(rows).onConflictDoNothing();
    }
    await tx
      .insert(s.examFiles)
      .values(
        d.files.map((f) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        })),
      )
      .onConflictDoNothing();
    for (const rows of chunk(d.questions)) {
      await tx.insert(s.questions).values(rows).onConflictDoNothing();
    }
    for (const rows of chunk(d.statistics)) {
      await tx
        .insert(s.questionStatistics)
        .values(
          rows.map((st) => ({ ...st, statisticsUpdatedAt: new Date(st.statisticsUpdatedAt) })),
        )
        .onConflictDoNothing();
    }
    await tx
      .insert(s.vocabulary)
      .values(
        d.vocabulary.map((v) => ({
          id: v.id,
          examId: v.examId,
          questionId: v.questionId,
          questionNumber: v.questionNumber,
          word: v.word,
          meaning: v.meaning,
          partOfSpeech: v.partOfSpeech,
          difficulty: v.difficulty,
          createdAt: new Date(v.createdAt),
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(s.listeningTracks)
      .values(
        d.listeningTracks.map((t) => ({
          id: t.id,
          examId: t.examId,
          fileId: t.fileId,
          questionNumber: t.questionNumber,
          label: t.label,
          startSeconds: t.startSeconds,
          endSeconds: t.endSeconds,
        })),
      )
      .onConflictDoNothing();
    const transcripts = d.listeningTracks.filter((t) => t.transcript);
    await tx
      .insert(s.listeningTranscripts)
      .values(transcripts.map((t) => ({ id: `tr_${t.id}`, trackId: t.id, lines: t.transcript! })))
      .onConflictDoNothing();
    await tx
      .insert(s.gradeCuts)
      .values(d.gradeCuts.map((g) => ({ ...g, updatedAt: new Date(g.updatedAt) })))
      .onConflictDoNothing();
    if (d.examCourses.length) {
      await tx.insert(s.examCourses).values(d.examCourses).onConflictDoNothing();
    }
    await tx
      .insert(s.examSchedules)
      .values(
        d.schedules.map((sc) => ({ ...sc, expectedReleaseStart: null, expectedReleaseEnd: null })),
      )
      .onConflictDoNothing();
  });

  console.log(
    `샘플 데이터 입력 완료: 시험 ${d.exams.length}건, 파일 ${d.files.length}건, 문항 ${d.questions.length}건`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
