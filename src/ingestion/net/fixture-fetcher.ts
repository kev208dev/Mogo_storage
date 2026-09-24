import { readFile } from "node:fs/promises";
import path from "node:path";
import { SourceFetchError } from "../errors";
import type { FetchResult, Fetcher } from "./fetcher";

/**
 * 네트워크 없이 로컬 fixture 파일로 응답하는 fetcher.
 * `npm run ingest:backfill -- --dry-run` 과 parser 테스트에서 사용한다.
 * routes: URL(쿼리 포함, 정확히 일치) → fixture 파일 경로
 */
export class FixtureFetcher implements Fetcher {
  readonly requested: string[] = [];

  constructor(
    private readonly routes: Record<string, string>,
    private readonly baseDir: string,
  ) {}

  async fetch(url: string): Promise<FetchResult> {
    this.requested.push(url);
    const file = this.routes[url];
    if (!file) throw new SourceFetchError(`fixture not found for ${url}`, false, 404);
    const bytes = new Uint8Array(await readFile(path.join(this.baseDir, file)));
    const contentType = file.endsWith(".pdf")
      ? "application/pdf"
      : file.endsWith(".mp3")
        ? "audio/mpeg"
        : "text/html; charset=utf-8";
    return { url, status: 200, contentType, headers: new Headers(), bytes };
  }
}
