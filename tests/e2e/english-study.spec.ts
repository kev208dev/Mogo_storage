import { expect, test, type Page } from "@playwright/test";

const ENGLISH = "/exam/2025/high2/09/english";
/** 음원은 있지만 문항 구간이 검증되지 않은 시험 (샘플) */
const UNVERIFIED = "/exam/2025/high3/07/english";

/** client component 가 hydrate(저장소 읽기 포함)된 뒤에 조작한다 */
async function open(page: Page, path: string, readyTestId?: string) {
  await page.goto(path);
  if (readyTestId) await ready(page, readyTestId);
}

async function ready(page: Page, testId: string) {
  await expect(page.getByTestId(testId).first()).toHaveAttribute("data-ready", "");
}

test.describe("영어 학습 자료 현황", () => {
  test("10개 항목을 있음/확인 중/없음으로 보여준다", async ({ page }) => {
    await open(page, ENGLISH);
    const overview = page.getByTestId("english-availability");
    await expect(overview.locator("li")).toHaveCount(10);
    await expect(overview.locator('[data-item="vocabulary"]')).toHaveAttribute(
      "data-state",
      "available",
    );
    await expect(overview.locator('[data-item="dictation"]')).toHaveAttribute(
      "data-state",
      "available",
    );
    // 독해 노트가 없는 샘플: 없음
    await expect(overview.locator('[data-item="grammar"]')).toHaveAttribute("data-state", "none");
    await expect(overview.locator('[data-item="grammar"]')).toContainText("없음");
  });

  test("우리가 만든 학습지는 '모의고사 창고 제작'으로 공식 자료와 구분한다", async ({ page }) => {
    await open(page, `${ENGLISH}#worksheets`);
    const worksheets = page.locator("#worksheets");
    await expect(worksheets).toContainText("공식 시험 자료 아님");
    await expect(worksheets).toContainText("단어 시험 문제");
    await expect(worksheets).toContainText("모의고사 창고 제작");
    // 공식 문제지 카드에는 제작 표시가 없다
    const files = page.locator('section[aria-labelledby="files-heading"]');
    await expect(files.locator("li").first()).not.toContainText("모의고사 창고 제작");
  });
});

test.describe("단어장 · 단어 시험", () => {
  test("난이도 필터 · 외운 단어(이 기기에 저장) · 인쇄 버튼", async ({ page }) => {
    await open(page, `${ENGLISH}#vocabulary`, "vocabulary-list");
    const vocab = page.locator("#vocabulary");
    const rows = vocab.getByTestId("vocab-word");
    const total = await rows.count();
    await vocab
      .getByRole("group", { name: "난이도로 단어 필터" })
      .getByRole("button", {
        name: "고난도",
      })
      .click();
    await expect.poll(() => rows.count()).toBeLessThan(total);
    await vocab.getByRole("button", { name: "모든 난이도" }).click();
    await expect(rows).toHaveCount(total);

    const first = await rows.first().textContent();
    await vocab.getByRole("button", { name: `${first} 외운 단어로 표시` }).click();
    await expect(vocab.getByRole("button", { name: `${first} 외운 단어로 표시` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await vocab.getByLabel(/외운 단어 숨기기/).check();
    await expect(rows).toHaveCount(total - 1);
    await page.reload();
    await ready(page, "vocabulary-list");
    await expect(
      page.locator("#vocabulary").getByRole("button", { name: `${first} 외운 단어로 표시` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#vocabulary").getByRole("button", { name: "인쇄" })).toBeVisible();
  });

  test("단어 시험: 틀린 단어는 다음에 '지난번 틀린 단어 다시'로 이어서", async ({ page }) => {
    await open(page, `${ENGLISH}#vocabulary-quiz`, "vocabulary-quiz");
    const quiz = page.locator("#vocabulary-quiz");
    await quiz.getByText("주관식").click();
    await quiz.getByRole("button", { name: "단어 시험 시작" }).click();
    for (let i = 0; i < 10; i += 1) {
      await quiz.getByLabel("답 입력").fill("틀린답");
      await quiz.getByRole("button", { name: "확인" }).click();
      await quiz.getByRole("button", { name: /다음|결과 보기/ }).click();
    }
    await expect(quiz.getByRole("region", { name: "단어 시험 결과" })).toContainText("0 / 10");
    await page.reload();
    await ready(page, "vocabulary-quiz");
    await expect(
      page.locator("#vocabulary-quiz").getByRole("button", { name: "지난번 틀린 단어 다시 (10)" }),
    ).toBeVisible();
  });
});

test.describe("듣기 · 받아쓰기", () => {
  test("검증된 구간: 이전/다음 문항, ±10초, 구간 반복, 현재 문항 표시", async ({ page }) => {
    await open(page, `${ENGLISH}#listening`, "listening-segment-player");
    const player = page.getByTestId("listening-segment-player");
    await expect(player.getByRole("button", { name: "10초 뒤로" })).toBeVisible();
    await expect(player.getByRole("button", { name: "10초 앞으로" })).toBeVisible();
    const repeat = player.getByRole("button", { name: "현재 문항 구간 반복" });
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    await player.getByRole("button", { name: "다음 문항" }).click();
    await expect(player.getByTestId("listening-current")).toContainText("1번");
    await player.getByRole("button", { name: "다음 문항" }).click();
    await expect(player.getByTestId("listening-current")).toContainText("2번");
    await expect(player.locator('li[aria-current="true"]')).toHaveAttribute("data-question", "2");
    await player.getByRole("button", { name: "2번 대본 보기", exact: true }).click();
    await expect(player.getByTestId("transcript-source")).toContainText("샘플 대본");
  });

  test("구간 미검증: 전체 음원만 재생하고 문항 구간 재생 버튼을 만들지 않는다", async ({
    page,
  }) => {
    await open(page, `${UNVERIFIED}#listening`, "listening-full-player");
    const listening = page.locator("#listening");
    await expect(listening.getByTestId("listening-full-player")).toBeVisible();
    await expect(page.getByTestId("listening-segment-player")).toHaveCount(0);
    await expect(listening.getByRole("button", { name: /^\d+번 재생$/ })).toHaveCount(0);
    await expect(listening).toContainText("문항별 구간은 공식 자료로 검증된 경우에만");
    // 대본 열람은 가능
    await expect(listening.getByTestId("transcript-list").locator("li")).toHaveCount(3);
    await expect(
      page.getByTestId("english-availability").locator('[data-item="listening_audio"]'),
    ).toContainText("전체 재생 (문항 구간 미검증)");
    // 받아쓰기는 대본으로 가능 (전체 음원 재생 안내)
    const dictation = page.locator("#dictation");
    await expect(
      dictation.getByRole("button", { name: "듣기 음원 재생 (전체 음원)" }),
    ).toBeVisible();
  });

  test("받아쓰기: 답은 확인 전에는 보이지 않고, 문항별 진행이 이 기기에 저장된다", async ({
    page,
  }) => {
    await open(page, `${ENGLISH}#dictation`, "dictation");
    const section = page.locator("#dictation");
    await expect(section.getByTestId("dictation-progress")).toContainText("0문항 완료");
    await expect(section.locator(".text-danger-strong")).toHaveCount(0);
    await section.getByRole("textbox").first().fill("zzz");
    await section.getByRole("button", { name: "정답 확인" }).click();
    await expect(section.getByTestId("dictation-progress")).toContainText("1문항 완료");
    await page.reload();
    await ready(page, "dictation");
    await expect(page.locator("#dictation").getByTestId("dictation-progress")).toContainText(
      "1문항 완료",
    );
  });
});
