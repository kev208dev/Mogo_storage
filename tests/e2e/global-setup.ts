/**
 * Flow C 준비 (E2E_DATABASE_URL 이 있을 때만): 빈 DB → migration → fake 공식 source 로 실제 파이프라인 실행.
 * source 가 "윤리" 로만 표기한 자료가 검증 후 manual_review 로 남은 상태를 만든다.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { runBackfill } from "@/ingestion/backfill";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { KICE_DEFINITION } from "@/ingestion/sources/kice/structure";
import { createDb } from "@/db/client";
import {
  ebsiListingHtml,
  installSources,
  makeContext,
  makePdf,
  setupDbAt,
  startFakeSource,
  testSource,
} from "../integration/helpers";

/**
 * 관리자 e2e 가 만드는 시험 경로. 샘플 build 에는 없는 경로라 .next 에 남은 파일은 이전 실행의 ISR 결과뿐이다.
 * 같은 .next 로 다시 실행하면 새 DB 인데도 이전 실행에서 게시된 페이지가 먼저 나가므로 지운다.
 */
const ADMIN_E2E_EXAM_PATHS = ["exam/2021/high2/11", "exam/2022/high3/09"];

function clearStaleIsrOutput() {
  const root = path.resolve(".next/server/app");
  for (const p of ADMIN_E2E_EXAM_PATHS) {
    rmSync(path.join(root, p), { recursive: true, force: true });
    for (const ext of [".html", ".rsc", ".meta", ".segments"])
      rmSync(path.join(root, p + ext), { recursive: true, force: true });
  }
}

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return;
  clearStaleIsrOutput();
  const reset = createDb(url, 1);
  await reset.execute(sql`drop schema if exists public cascade`);
  await reset.execute(sql`drop schema if exists drizzle cascade`);
  await reset.execute(sql`create schema public`);
  await reset.$client.end({ timeout: 5 });

  const db = await setupDbAt(url);
  const fake = await startFakeSource();
  try {
    for (const g of [1, 2, 3] as const) {
      const u = new URL(ebsiListingUrl(fake.baseUrl, g, 2022));
      fake.set(u.pathname + u.search, {
        contentType: "text/html",
        body: ebsiListingHtml(
          fake.baseUrl,
          g === 3
            ? [
                {
                  id: "E2E-2022-3-09",
                  title: "2023학년도 9월 고3 모의평가",
                  subjects: [
                    { name: "사회탐구", links: [{ label: "윤리 문제", path: "/f/ethics.pdf" }] },
                    // Flow I: 확정 가능한 자료는 자동으로 검증·게시된다
                    { name: "국어", links: [{ label: "문제", path: "/f/kor.pdf" }] },
                  ],
                },
              ]
            : [],
        ),
      });
    }
    const pdf = await makePdf(["E2E FIXTURE — NOT A REAL EXAM", "x".repeat(60)]);
    fake.set("/f/ethics.pdf", { contentType: "application/pdf", body: pdf });
    fake.set("/f/kor.pdf", { contentType: "application/pdf", body: pdf });
    // Flow J: 다른 source(평가원 게시판)의 목록 구조가 바뀐 상황
    const kiceList = new URL(KICE_DEFINITION.listUrl(fake.baseUrl, 1));
    fake.set(kiceList.pathname + kiceList.search, {
      contentType: "text/html",
      body: "<html><body><div class='renewal'>새 디자인</div></body></html>",
    });
    await installSources(db, [
      testSource("ebsi", "ebsi", fake.baseUrl),
      testSource("kice", "kice", fake.baseUrl),
    ]);
    const { ctx, setNow } = makeContext(db);
    // canary 게이트: 2022년 자료를 "최근 1년" 범위로 수집하도록 시계를 맞춘다
    setNow(new Date("2022-12-01T12:00:00+09:00"));
    await runBackfill(ctx, { fromYear: 2022, toYear: 2022, grades: [3], sourceIds: ["ebsi"] });
    await runBackfill(ctx, { fromYear: 2022, toYear: 2022, grades: [3], sourceIds: ["kice"] });
  } finally {
    await fake.close();
    await db.$client.end({ timeout: 5 });
  }
}
