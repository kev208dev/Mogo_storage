/**
 * 브라우저 검증을 통과한 자료만 관리자 화면(/admin/imports)의 승인 폼으로 게시한다.
 * DB 를 직접 바꾸지 않는다: 로그인 → 해당 행 체크 → "브라우저 확인" 체크 → [선택 승인 · 게시].
 *
 * 사용: ADMIN_EMAIL=... ADMIN_ACCESS_TOKEN=... node --import tsx scripts/official-url-search/approve-admin.mts \
 *        --base=http://localhost:3200 --ids=<artifact id 목록 파일(줄마다 1개)> [--batch=20]
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const base = args.base!;
const ids = readFileSync(args.ids!, "utf8").split(/\s+/).filter(Boolean);
const batch = Number(args.batch || 20);

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();
await page.goto(`${base}/admin/login`);
await page.getByLabel("이메일").fill(process.env.ADMIN_EMAIL!);
await page.getByLabel("접근 토큰").fill(process.env.ADMIN_ACCESS_TOKEN!);
await page.getByRole("button", { name: "로그인" }).click();
await page.waitForURL((u) => !u.pathname.endsWith("/login"));

for (let i = 0; i < ids.length; i += batch) {
  const chunk = ids.slice(i, i + batch);
  await page.goto(`${base}/admin/imports`);
  let selected = 0;
  for (const id of chunk) {
    const box = page.locator(`input[name="ids"][value="${id}"]`);
    if ((await box.count()) === 0) {
      console.log("not pending (skip)", id);
      continue;
    }
    await box.check();
    selected += 1;
  }
  if (!selected) continue;
  await page.locator('input[name="browserChecked"]').check();
  await page.getByRole("button", { name: "선택 승인 · 게시" }).click();
  const status = page.getByRole("status");
  await status.waitFor({ timeout: 60000 });
  console.log(
    `batch ${i / batch + 1}: selected ${selected} →`,
    (await status.innerText()).replace(/\s+/g, " "),
  );
}
await browser.close();
