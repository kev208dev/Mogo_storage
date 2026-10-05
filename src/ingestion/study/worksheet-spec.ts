import { createHash } from "node:crypto";
import type { WorksheetFileType } from "../../lib/constants";
import { createDictationTokens } from "../../lib/dictation";
import type { TranscriptLine } from "../../lib/data/types";

/**
 * 영어 학습지 내용 (PDF 와 분리된 순수 데이터 — 테스트 가능).
 * 입력은 DB 에 실제로 있는 단어장 · 공개 가능한(공식/허락) 대본 · 웹 정답뿐이다. 내용을 지어내지 않는다.
 */
export interface WorksheetRow {
  cells: string[];
}
export interface WorksheetGroup {
  heading: string | null;
  rows: WorksheetRow[];
}
export interface WorksheetSpec {
  type: WorksheetFileType;
  title: string;
  /** 다운로드 파일 이름 (사람이 읽기 쉬운 이름) */
  fileName: string;
  /** 열 제목과 상대 너비 (합 1) */
  columns: Array<{ label: string; width: number }>;
  groups: WorksheetGroup[];
  sourceNote: string;
  /** 입력이 같으면 같은 값 — 다시 만들지 않는 기준 */
  fingerprint: string;
}

export interface WorksheetInput {
  exam: { year: number; grade: number; month: number };
  vocabulary: Array<{
    questionNumber: number;
    word: string;
    meaning: string;
    partOfSpeech: string | null;
  }>;
  transcripts: Array<{ questionNumber: number; lines: TranscriptLine[] }>;
  questions: Array<{ questionNumber: number; score: number }>;
}

const NOTE =
  "모의고사 창고가 만든 학습 자료입니다. 공식 시험 자료가 아니며, 관리자 검토 후 게시됩니다.";
/** 단어 시험은 문항 수가 너무 적으면 만들지 않는다 */
export const MIN_VOCAB_TEST_WORDS = 5;

function fingerprint(type: string, data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify([type, data]))
    .digest("hex")
    .slice(0, 16);
}

function byQuestion<T extends { questionNumber: number }>(items: T[]) {
  const groups = new Map<number, T[]>();
  for (const item of [...items].sort((a, b) => a.questionNumber - b.questionNumber))
    groups.set(item.questionNumber, [...(groups.get(item.questionNumber) ?? []), item]);
  return [...groups.entries()];
}

export function worksheetSpecs(input: WorksheetInput): WorksheetSpec[] {
  const { exam } = input;
  const label = `${exam.year}년 고${exam.grade} ${exam.month}월 영어`;
  const file = (name: string) =>
    `${exam.year}-고${exam.grade}-${String(exam.month).padStart(2, "0")}월-영어-${name}.pdf`;
  const specs: WorksheetSpec[] = [];
  const vocab = [...input.vocabulary].sort(
    (a, b) => a.questionNumber - b.questionNumber || a.word.localeCompare(b.word),
  );

  if (vocab.length > 0) {
    specs.push({
      type: "vocabulary_pdf",
      title: `${label} 지문별 단어장`,
      fileName: file("단어장"),
      columns: [
        { label: "단어", width: 0.35 },
        { label: "뜻", width: 0.65 },
      ],
      groups: byQuestion(vocab).map(([n, words]) => ({
        heading: `${n}번`,
        rows: words.map((w) => ({
          cells: [w.word, `${w.partOfSpeech ? `${w.partOfSpeech} ` : ""}${w.meaning}`],
        })),
      })),
      sourceNote: `${NOTE} 단어·뜻은 공식 해설 자료에서 추출했습니다.`,
      fingerprint: fingerprint("vocabulary_pdf", vocab),
    });
  }

  if (vocab.length >= MIN_VOCAB_TEST_WORDS) {
    // 문제지와 정답지는 같은 순서 (문항 순 · 알파벳 순). 무작위 섞기는 화면의 단어 시험에서 한다
    const numbered = vocab.map((w, i) => ({ ...w, no: i + 1 }));
    specs.push({
      type: "vocabulary_test",
      title: `${label} 단어 시험`,
      fileName: file("단어시험"),
      columns: [
        { label: "번호", width: 0.1 },
        { label: "단어", width: 0.35 },
        { label: "뜻 쓰기", width: 0.55 },
      ],
      groups: [
        { heading: null, rows: numbered.map((w) => ({ cells: [String(w.no), w.word, ""] })) },
      ],
      sourceNote: NOTE,
      fingerprint: fingerprint("vocabulary_test", vocab),
    });
    specs.push({
      type: "vocabulary_test_answers",
      title: `${label} 단어 시험 정답`,
      fileName: file("단어시험-정답"),
      columns: [
        { label: "번호", width: 0.1 },
        { label: "단어", width: 0.35 },
        { label: "뜻", width: 0.55 },
      ],
      groups: [
        {
          heading: null,
          rows: numbered.map((w) => ({ cells: [String(w.no), w.word, w.meaning] })),
        },
      ],
      sourceNote: NOTE,
      fingerprint: fingerprint("vocabulary_test_answers", vocab),
    });
  }

  const transcripts = input.transcripts
    .filter((t) => t.lines.length > 0)
    .sort((a, b) => a.questionNumber - b.questionNumber);
  if (transcripts.length > 0) {
    const line = (l: TranscriptLine, text: string) => `${l.speaker ? `${l.speaker}: ` : ""}${text}`;
    specs.push({
      type: "dictation_sheet",
      title: `${label} 받아쓰기 학습지`,
      fileName: file("받아쓰기"),
      columns: [{ label: "대본 (빈칸을 채우세요)", width: 1 }],
      groups: transcripts.map((t) => ({
        heading: `${t.questionNumber}번`,
        rows: t.lines.map((l) => ({
          cells: [
            line(
              l,
              createDictationTokens(l.text, "medium")
                .map((tok) =>
                  tok.answer
                    ? `${"_".repeat(Math.max(4, tok.answer.length))}${tok.trailing}`
                    : tok.text,
                )
                .join(" "),
            ),
          ],
        })),
      })),
      sourceNote: `${NOTE} 대본은 공식 듣기 대본 자료에서 가져왔습니다.`,
      fingerprint: fingerprint("dictation_sheet", transcripts),
    });
    specs.push({
      type: "dictation_answers",
      title: `${label} 받아쓰기 정답`,
      fileName: file("받아쓰기-정답"),
      columns: [{ label: "대본", width: 1 }],
      groups: transcripts.map((t) => ({
        heading: `${t.questionNumber}번`,
        rows: t.lines.map((l) => ({ cells: [line(l, l.text)] })),
      })),
      sourceNote: `${NOTE} 대본은 공식 듣기 대본 자료에서 가져왔습니다.`,
      fingerprint: fingerprint("dictation_answers", transcripts),
    });
  }

  const questions = [...input.questions].sort((a, b) => a.questionNumber - b.questionNumber);
  if (questions.length > 0) {
    // 정답은 싣지 않는다 (채점은 화면의 자동 채점에서) — 학생이 직접 표시하는 점검표
    specs.push({
      type: "question_checklist",
      title: `${label} 문항별 점검표`,
      fileName: file("문항점검표"),
      columns: [
        { label: "문항", width: 0.12 },
        { label: "배점", width: 0.12 },
        { label: "맞음/틀림", width: 0.2 },
        { label: "다시 볼 내용", width: 0.56 },
      ],
      groups: [
        {
          heading: null,
          rows: questions.map((q) => ({
            cells: [`${q.questionNumber}번`, `${q.score}점`, "", ""],
          })),
        },
      ],
      sourceNote: NOTE,
      fingerprint: fingerprint("question_checklist", questions),
    });
  }
  return specs;
}
