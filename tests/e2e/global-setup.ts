/**
 * Flow C 준비 (E2E_DATABASE_URL 이 있을 때만): 빈 DB → migration → fake 공식 source 로 실제 파이프라인 실행.
 * source 가 "윤리" 로만 표기한 자료가 검증 후 manual_review 로 남은 상태를 만든다.
 */
import { sql } from "drizzle-orm";
import { runBackfill } from "@/ingestion/backfill";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
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

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return;
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
                  ],
                },
              ]
            : [],
        ),
      });
    }
    fake.set("/f/ethics.pdf", {
      contentType: "application/pdf",
      body: await makePdf(["E2E FIXTURE — NOT A REAL EXAM", "x".repeat(60)]),
    });
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    const { ctx } = makeContext(db);
    await runBackfill(ctx, { fromYear: 2022, toYear: 2022, grades: [3] });
  } finally {
    await fake.close();
    await db.$client.end({ timeout: 5 });
  }
}
