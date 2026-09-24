/**
 * parser-versions.json 갱신: parser 관련 파일의 hash 를 다시 계산하고, 바뀐 source 는 버전을 올린다.
 *   npm run ingest:parser-version
 * 버전이 올라간 source 는 실제 페이지 fixture 로 다시 검증·승인해야 자동 수집이 재개된다.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PARSER_VERSION_FILES } from "../src/ingestion/sources/parser-version-files";

const FILE = "src/ingestion/sources/parser-versions.json";

export function computeParserHash(files: string[]): string {
  const h = createHash("sha256");
  for (const f of files)
    h.update(f).update("\0").update(readFileSync(f, "utf8").replace(/\r\n/g, "\n")).update("\0");
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1]?.endsWith("parser-version.ts")) {
  let current: Record<string, { version: string; hash: string }> = {};
  try {
    current = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    /* 처음 생성 */
  }
  const next: typeof current = {};
  for (const [source, files] of Object.entries(PARSER_VERSION_FILES)) {
    const hash = computeParserHash(files);
    const prev = current[source];
    if (prev && prev.hash === hash) {
      next[source] = prev;
      continue;
    }
    const n = prev ? Number(/-(\d+)$/.exec(prev.version)?.[1] ?? 0) + 1 : 1;
    next[source] = { version: `${source}-v${n}`, hash };
    console.log(`${source}: ${prev?.version ?? "(new)"} → ${next[source]!.version}`);
  }
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`updated ${FILE}`);
}
