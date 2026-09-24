/**
 * 실제 공식 페이지(HTML 목록/상세만)를 fixture 로 저장한다. 시험 PDF/음원은 받지 않는다.
 *   npm run ingest:fixtures -- --source=ebsi [--year=2025] [--grade=2]
 * 저장 위치: tests/fixtures/<source>/live-*.html → parser 를 실제 구조에 맞출 때 사용
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Grade } from "../../lib/constants";
import { decodeHtml } from "../net/fetcher";
import { BUILTIN_SOURCES } from "../sources/config";
import { ebsiListingUrl } from "../sources/ebsi/structure";
import { EDUCATION_OFFICE_DEFINITION } from "../sources/education-office/structure";
import { KICE_DEFINITION } from "../sources/kice/structure";
import { createFetcherFor } from "../sources/registry";
import { intArg, parseArgs } from "./args";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = BUILTIN_SOURCES.find((s) => s.id === args.source);
  if (!source) throw new Error(`--source=${BUILTIN_SOURCES.map((s) => s.id).join("|")}`);
  const fetcher = createFetcherFor(source);
  const year = intArg(args.year) ?? new Date().getFullYear();
  const grade = (intArg(args.grade) ?? 3) as Grade;
  const urls =
    source.kind === "ebsi"
      ? [ebsiListingUrl(source.baseUrl, grade, year)]
      : source.kind === "kice"
        ? [KICE_DEFINITION.listUrl(source.baseUrl, 1)]
        : [EDUCATION_OFFICE_DEFINITION.listUrl(source.baseUrl, 1)];
  const dir = path.resolve(
    "tests/fixtures",
    source.id === "education_office" ? "education-office" : source.id,
  );
  await mkdir(dir, { recursive: true });
  for (const url of urls) {
    const res = await fetcher.fetch(url, { accept: "text/html", maxBytes: 5 * 1024 * 1024 });
    const file = path.join(dir, `live-${source.id}-${year}-g${grade}.html`);
    await writeFile(
      file,
      `<!-- LIVE CAPTURE ${new Date().toISOString()} ${url} -->\n${decodeHtml(res)}`,
    );
    console.log(`saved ${file}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
