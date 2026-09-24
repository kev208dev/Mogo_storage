/**
 * R2 실제 연결 점검 (운영 자료를 건드리지 않는다).
 *   STORAGE_DRIVER=r2 R2_*=... npm run storage:selftest
 * _internal/test/<시각>.pdf 에 작은 테스트 PDF 를 올리고 → 다시 읽어 SHA-256 비교 → signed 다운로드 URL 로 받아
 * Content-Disposition 확인 → 삭제한다. credential 이 없으면 아무것도 하지 않고 종료 코드 2.
 */
import { createHash } from "node:crypto";
import { R2StorageProvider } from "../src/lib/storage/r2-storage";

async function main() {
  const config = {
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || undefined,
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    console.error(
      "R2 credential 이 없습니다 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).",
    );
    process.exit(2);
  }
  const r2 = new R2StorageProvider(config);
  const key = `_internal/test/selftest-${Date.now()}.pdf`;
  const body = new TextEncoder().encode(
    `%PDF-1.4\n% 모의고사 창고 storage self-test (not an exam)\n${"x".repeat(600)}\n%%EOF\n`,
  );
  const sha = createHash("sha256").update(body).digest("hex");
  const step = (name: string) => console.log(`… ${name}`);
  try {
    step(`upload ${key}`);
    await r2.putObject({ key, body, contentType: "application/pdf", sha256: sha });
    step("read back");
    const read = await r2.getObject(key);
    if (createHash("sha256").update(read).digest("hex") !== sha) throw new Error("sha256 mismatch");
    step("signed download URL");
    const url = await r2.getDownloadUrl({
      storageKey: key,
      mimeType: "application/pdf",
      originalFileName: "2025-고2-9월-영어-단어장(test).pdf",
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`signed download HTTP ${res.status}`);
    const disposition = res.headers.get("content-disposition") ?? "";
    if (!disposition.includes("filename*=UTF-8''"))
      throw new Error(`content-disposition: ${disposition}`);
    console.log("✓ R2 upload / read / signed download OK");
  } finally {
    step("delete test object");
    await r2.deleteObject(key).catch((e) => console.error(`delete failed: ${e.message}`));
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
