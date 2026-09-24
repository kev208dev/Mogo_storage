import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type Database } from "@/db/client";
import type { IngestionContext } from "@/ingestion/context";
import { createMemoryLogger } from "@/ingestion/logger";
import { LogOpsNotifier } from "@/ingestion/notifier";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import type { SourceConfig } from "@/ingestion/types";
import { koreanFontPath } from "@/ingestion/vocabulary/pdf-generator";
import { mkdir, writeFile } from "node:fs/promises";
import { MockStorageProvider } from "@/lib/storage/mock-storage";
import { assertSafeStorageKey, type PutObjectInput } from "@/lib/storage/types";

/** 테스트용 스토리지: 임시 디렉터리에 저장 (URL 생성은 mock 과 동일) */
class TempDirStorage extends MockStorageProvider {
  constructor(private readonly dir: string) {
    super();
  }
  override async putObject(input: PutObjectInput) {
    assertSafeStorageKey(input.key);
    const target = path.join(this.dir, input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }
}

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;

export async function setupDb(): Promise<Database> {
  const db = createDb(TEST_DB_URL!, 8);
  await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  return db;
}

export async function resetDb(db: Database) {
  await db.execute(sql`
    truncate table jobs, vocabulary_candidates, vocabulary, ingestion_errors, ingestion_runs,
      ingestion_checkpoints, exam_schedules, exam_files, source_artifacts, source_exams,
      source_priorities, exam_sources, question_statistics, listening_transcripts,
      listening_tracks, grade_cuts, reports, questions, exam_subjects, exams restart identity cascade`);
}

// ── fake official source ────────────────────────────────────
export interface Route {
  status?: number;
  contentType: string;
  body: Uint8Array | string;
}

export async function startFakeSource() {
  const routes = new Map<string, Route>();
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const key = req.url ?? "/";
    hits.push(key);
    if (key === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /private/\n");
      return;
    }
    const route = routes.get(key);
    if (!route) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>Not found</body></html>");
      return;
    }
    const body = typeof route.body === "string" ? Buffer.from(route.body) : Buffer.from(route.body);
    res.writeHead(route.status ?? 200, {
      "content-type": route.contentType,
      "content-length": body.length,
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    routes,
    hits,
    set(pathWithQuery: string, route: Route) {
      routes.set(pathWithQuery, route);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeSource = Awaited<ReturnType<typeof startFakeSource>>;

export interface ListingExam {
  id: string;
  title: string;
  date?: string;
  subjects: Array<{ name: string; links: Array<{ label: string; path: string }> }>;
}

/** EBSi structure.ts 가정과 같은 모양의 목록 HTML */
export function ebsiListingHtml(baseUrl: string, exams: ListingExam[]): string {
  if (exams.length === 0) return `<html><body><p class="no_data">없음</p></body></html>`;
  return `<html><body><ul class="board_list">${exams
    .map(
      (
        e,
      ) => `<li class="exam" data-exam-id="${e.id}"><p class="tit">${e.title}</p><span class="date">${e.date ?? ""}</span>
      <div class="board_qusesion">${e.subjects
        .map(
          (s) =>
            `<div class="subj"><strong class="subject">${s.name}</strong>${s.links
              .map(
                (l) =>
                  `<a href="#" onclick="goDownLoadP('${baseUrl}${l.path}','1','Q')">${l.label}</a>`,
              )
              .join("")}</div>`,
        )
        .join("")}</div></li>`,
    )
    .join("")}</ul></body></html>`;
}

let fontBytes: Uint8Array | null = null;

/** 테스트용 PDF (실제 시험지 아님). 한국어 줄을 넣을 수 있도록 한글 폰트 embed */
export async function makePdf(lines: string[]): Promise<Uint8Array> {
  fontBytes ??= new Uint8Array(readFileSync(koreanFontPath()));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 16, size: 10, font }));
  return doc.save();
}

export function makeMp3(size = 8192): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x49, 0x44, 0x33, 0x03, 0x00]);
  return bytes;
}

// ── context ─────────────────────────────────────────────────
export function makeContext(db: Database, overrides: Partial<IngestionContext> = {}) {
  const { logger, lines } = createMemoryLogger();
  const revalidated: string[] = [];
  let now = new Date("2025-09-03T14:00:00+09:00");
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "mogo-storage-"));
  const ctx: IngestionContext = {
    db,
    logger,
    notifier: new LogOpsNotifier(logger),
    storage: new TempDirStorage(storageDir),
    revalidator: {
      async revalidatePaths(paths) {
        revalidated.push(...paths);
      },
    },
    now: () => now,
    adapterOptions: { allowPrivateNetwork: true },
    workerId: "test-worker",
    // 로컬 fake source 는 live 검증 대상이 아니므로 테스트 context 에서만 허용 (게이트 자체는 별도 테스트)
    allowUnverifiedSources: true,
    ...overrides,
  };
  return {
    ctx,
    logs: lines,
    revalidated,
    storageDir,
    setNow(d: Date) {
      now = d;
    },
  };
}

export function testSource(
  id: string,
  kind: SourceConfig["kind"],
  baseUrl: string,
  over: Partial<SourceConfig> = {},
): SourceConfig {
  return {
    id,
    kind,
    name: id === "ebsi" ? "EBSi" : id === "kice" ? "한국교육과정평가원" : id,
    baseUrl,
    allowedHosts: ["127.0.0.1"],
    deliveryPolicy: "source_redirect",
    enabled: true,
    liveVerified: false,
    minPollIntervalSeconds: 300,
    requestTimeoutMs: 5000,
    maxConcurrentRequests: 2,
    minRequestGapMs: 0,
    maxRetries: 0,
    ...over,
  };
}

export async function installSources(db: Database, sources: SourceConfig[]) {
  await syncBuiltinSources(db, sources);
}
