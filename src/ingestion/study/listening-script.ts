import type { TranscriptLine } from "../../lib/data/types";

/**
 * 공식 영어 듣기 대본 PDF 텍스트 → 문항별 대본.
 *
 * 규칙만 쓴다 (사이트 고유 selector · 추측 없음):
 *  - 문항 시작: 줄 머리의 "1번" · "1." · "[1]" · "1)" 및 공유 지문의 "16~17" 범위 표기
 *    (1~20번만, 번호가 증가하는 순서일 때만 인정)
 *  - 화자: 줄 머리의 "M:" "W:" "남:" "여:" "Man:" "Woman:" 등
 *  - 화자 표기가 없는 줄은 앞 문장에 이어 붙인다
 *  - 머리말/쪽 번호 등 영문이 없는 줄은 버린다
 * 시간 정보(구간)는 만들지 않는다. 대본 PDF 에는 재생 위치가 없으므로 구간은 미검증으로 둔다.
 */
export const LISTENING_SCRIPT_PARSER_VERSION = "listening-script-v2";

export interface ParsedScriptQuestion {
  questionNumber: number;
  lines: TranscriptLine[];
}

export interface ParsedListeningScript {
  questions: ParsedScriptQuestion[];
  warnings: Array<{ code: string; detail: string }>;
}

const RANGE_RE = /^\s*(?:\[(\d{1,2})\s*[~∼–—-]\s*(\d{1,2})\]|(\d{1,2})\s*[~∼–—-]\s*(\d{1,2})\s*번?[.:)]?)\s*(.*)$/;
const QUESTION_RE = /^\s*(?:\[(\d{1,2})\]|(\d{1,2})\s*번[.:)]?|(\d{1,2})\s*[.)])\s*(.*)$/;
const SPEAKER_RE = /^\s*(M|W|B|G|Man|Woman|Boy|Girl|남|여|남자|여자)\s*[:：]\s*(.+)$/i;
const MAX_LISTENING_QUESTION = 20;

const hasEnglish = (s: string) => /[A-Za-z]{2,}/.test(s);

export function parseListeningScript(text: string): ParsedListeningScript {
  const warnings: ParsedListeningScript["warnings"] = [];
  const questions: ParsedScriptQuestion[] = [];
  let current: ParsedScriptQuestion[] = [];
  let lastQuestionNumber = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const range = RANGE_RE.exec(line);
    if (range) {
      const start = Number(range[1] ?? range[3]);
      const end = Number(range[2] ?? range[4]);
      const expected = lastQuestionNumber + 1;
      // "16~17"처럼 하나의 지문을 공유하는 연속 문항만 허용한다.
      if (
        start === expected &&
        end >= start &&
        end <= MAX_LISTENING_QUESTION &&
        end - start <= 2
      ) {
        current = [];
        for (let n = start; n <= end; n += 1) {
          const question = { questionNumber: n, lines: [] as TranscriptLine[] };
          questions.push(question);
          current.push(question);
        }
        lastQuestionNumber = end;
        const rest = range[5]?.trim() ?? "";
        if (rest && hasEnglish(rest)) for (const question of current) appendLine(question, rest);
        continue;
      }
    }

    const q = QUESTION_RE.exec(line);
    if (q) {
      const n = Number(q[1] ?? q[2] ?? q[3]);
      const expected = lastQuestionNumber + 1;
      // 번호가 순서대로 이어질 때만 새 문항으로 본다 (본문 속 "1." 등 오인 방지)
      if (n >= 1 && n <= MAX_LISTENING_QUESTION && n === expected) {
        const question = { questionNumber: n, lines: [] as TranscriptLine[] };
        current = [question];
        questions.push(question);
        lastQuestionNumber = n;
        const rest = q[4]?.trim() ?? "";
        if (rest && hasEnglish(rest)) appendLine(question, rest);
        continue;
      }
    }
    if (current.length === 0) continue;
    if (!hasEnglish(line)) continue;
    for (const question of current) appendLine(question, line);
  }

  for (const q of questions)
    if (q.lines.length === 0)
      warnings.push({
        code: "EMPTY_QUESTION",
        detail: `${q.questionNumber}번 대본이 비어 있습니다`,
      });
  if (questions.length === 0)
    warnings.push({ code: "NO_QUESTIONS", detail: "문항을 찾지 못했습니다" });
  return { questions: questions.filter((q) => q.lines.length > 0), warnings };
}

function appendLine(q: ParsedScriptQuestion, text: string) {
  const speaker = SPEAKER_RE.exec(text);
  if (speaker) {
    q.lines.push({ speaker: normalizeSpeaker(speaker[1]!), text: speaker[2]!.trim() });
    return;
  }
  const last = q.lines.at(-1);
  if (last) last.text = `${last.text} ${text}`.trim();
  else q.lines.push({ speaker: null, text });
}

function normalizeSpeaker(s: string): string {
  const k = s.toLowerCase();
  if (k === "m" || k === "man" || k === "남" || k === "남자") return "M";
  if (k === "w" || k === "woman" || k === "여" || k === "여자") return "W";
  if (k === "b" || k === "boy") return "B";
  if (k === "g" || k === "girl") return "G";
  return s;
}

/**
 * 게시 기준: 1번부터 연속된 문항이 최소 개수 이상이어야 한다. 아니면 manual_review (공개하지 않음).
 */
export function validateListeningScript(
  parsed: ParsedListeningScript,
  minQuestions = 10,
): { ok: true } | { ok: false; reason: string } {
  const numbers = parsed.questions.map((q) => q.questionNumber);
  if (numbers.length < minQuestions)
    return { ok: false, reason: `문항 ${numbers.length}개만 인식 (최소 ${minQuestions}개)` };
  if (numbers[0] !== 1 || numbers.some((n, i) => n !== i + 1))
    return { ok: false, reason: "문항 번호가 1번부터 연속되지 않습니다" };
  return { ok: true };
}
