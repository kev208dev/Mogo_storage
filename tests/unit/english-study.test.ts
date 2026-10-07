import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseListeningScript,
  validateListeningScript,
} from "../../src/ingestion/study/listening-script";
import { MIN_VOCAB_TEST_WORDS, worksheetSpecs } from "../../src/ingestion/study/worksheet-spec";
import type { ListeningTrack } from "../../src/lib/data/types";
import {
  activeLineIndex,
  clampSeek,
  listeningMode,
  neighborSegment,
  transcriptTracks,
  verifiedSegments,
} from "../../src/lib/listening";
import {
  canTransition,
  englishAvailability,
  isPublishableTranscript,
  toReadingNote,
  type EnglishAvailabilityInput,
} from "../../src/lib/study";

const fixture = readFileSync(
  path.join(__dirname, "../fixtures/english/listening-script-synthetic.txt"),
  "utf8",
);

describe("listening script parser (official 대본 PDF text)", () => {
  const parsed = parseListeningScript(fixture);

  it("splits by consecutive question numbers and speakers, joins wrapped lines", () => {
    expect(parsed.questions.map((q) => q.questionNumber)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(parsed.questions[0]!.lines).toEqual([
      { speaker: "M", text: "Hello, this is test line one for question 1." },
      {
        speaker: "W",
        text: "Thanks. This is a reply that wraps onto a second line for question 1.",
      },
    ]);
    // 쪽 번호("- 2 -")는 버리고 한글 화자 표기는 정규화
    expect(parsed.questions[5]!.lines.at(-1)).toEqual({
      speaker: "M",
      text: "The bus leaves at 7 a.m.",
    });
  });

  it("never invents timings", () => {
    for (const q of parsed.questions)
      for (const l of q.lines) expect(l.startSeconds ?? null).toBeNull();
  });

  it("ignores the Korean instruction line after the dialogue section", () => {
    // "13. 다음을 듣고…" 는 영문이 없어 대본 문항이 되지 않는다
    expect(parsed.questions.some((q) => q.questionNumber === 13)).toBe(false);
  });

  it("publishes only when numbering is complete; otherwise manual review", () => {
    expect(validateListeningScript(parsed, 10)).toEqual({ ok: true });
    expect(
      validateListeningScript(parseListeningScript("1번\nM: Hi there.\n3번\nW: Skip.")),
    ).toMatchObject({
      ok: false,
    });
    expect(validateListeningScript(parseListeningScript("no numbers here"))).toMatchObject({
      ok: false,
    });
  });

  it("does not treat a stray number inside text as a new question", () => {
    const p = parseListeningScript("1번\nM: Call me at\n5. o'clock please.\n2번\nW: Okay.");
    expect(p.questions.map((q) => q.questionNumber)).toEqual([1, 2]);
  });

  it("duplicates a shared 16~17 passage onto both question transcripts", () => {
    const firstFifteen = Array.from(
      { length: 15 },
      (_, i) => `${i + 1}번\nM: Question ${i + 1} audio.`,
    ).join("\n");
    const p = parseListeningScript(
      `${firstFifteen}\n[16~17]\nM: This shared passage answers both final listening questions.`,
    );
    expect(p.questions.map((q) => q.questionNumber)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
    expect(p.questions[15]!.lines).toEqual(p.questions[16]!.lines);
    expect(p.questions[16]!.lines[0]!.text).toContain("shared passage");
    expect(validateListeningScript(p)).toEqual({ ok: true });
  });
});

/** 1~n 번 단일 문항 (직접 쓴 최소 문장) */
const singles = (n: number) =>
  Array.from({ length: n }, (_, i) => `[${i + 1}]\nM: Single question ${i + 1} line.`).join("\n");

describe("shared listening ranges (A–E)", () => {
  it("A. single [15] marker links only question 15", () => {
    const p = parseListeningScript(`${singles(14)}\n[15]\nW: Only fifteen here.`);
    expect(p.questions.at(-1)).toEqual({
      questionNumber: 15,
      lines: [{ speaker: "W", text: "Only fifteen here." }],
    });
    expect(p.questions.filter((q) => q.lines.some((l) => l.text.includes("fifteen")))).toHaveLength(
      1,
    );
  });

  it("B/C. [16~17] links one passage to both; the next marker starts a separate passage", () => {
    const p = parseListeningScript(
      `${singles(15)}\n[16~17]\nW: Shared passage first line.\nM: Shared passage second line.\n[18]\nW: Next passage only.`,
    );
    const by = (n: number) => p.questions.find((q) => q.questionNumber === n)!;
    const shared = [
      { speaker: "W", text: "Shared passage first line." },
      { speaker: "M", text: "Shared passage second line." },
    ];
    expect(by(16).lines).toEqual(shared);
    expect(by(17).lines).toEqual(shared);
    // 문항마다 독립된 배열 (한쪽 수정이 다른 쪽에 번지지 않는다)
    expect(by(16).lines).not.toBe(by(17).lines);
    expect(by(18).lines).toEqual([{ speaker: "W", text: "Next passage only." }]);
    expect(by(17).lines.some((l) => l.text.includes("Next"))).toBe(false);
    expect(by(18).lines.some((l) => l.text.includes("Shared"))).toBe(false);
    // timing 은 만들지 않는다
    for (const l of [...by(16).lines, ...by(17).lines]) expect(l.startSeconds ?? null).toBeNull();
  });

  it("also accepts the unbracketed '16~17번' and dash forms", () => {
    for (const marker of ["16~17번", "16-17", "[16-17]", "[16 ~ 17]"]) {
      const p = parseListeningScript(`${singles(15)}\n${marker}\nM: Shared text.`);
      expect(p.questions.map((q) => q.questionNumber).slice(-2), marker).toEqual([16, 17]);
    }
  });

  it.each([
    ["reversed", "[17~16]"],
    ["outside listening range", "[16~21]"],
    ["too long", "[16~19]"],
    ["not continuing the sequence", "[18~19]"],
  ])("D. %s range is rejected and its passage is not mixed into question 15", (_, marker) => {
    const p = parseListeningScript(`${singles(15)}\n${marker}\nW: Passage of a rejected marker.`);
    expect(p.questions.map((q) => q.questionNumber)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(p.questions[14]!.lines).toEqual([{ speaker: "M", text: "Single question 15 line." }]);
    expect(p.warnings.map((w) => w.code)).toContain("INVALID_RANGE");
    expect(validateListeningScript(p).ok).toBe(false);
  });

  it("D. a range-looking phrase inside dialogue stays ordinary text", () => {
    const p = parseListeningScript("1번\nM: We need\n3-4 more chairs please.\n2번\nW: Sure.");
    expect(p.questions[0]!.lines).toEqual([
      { speaker: "M", text: "We need 3-4 more chairs please." },
    ]);
  });

  it("E. requires the full 17 questions by default (shorter scripts go to manual review)", () => {
    expect(validateListeningScript(parseListeningScript(singles(17)))).toEqual({ ok: true });
    expect(validateListeningScript(parseListeningScript(singles(16))).ok).toBe(false);
  });
});

describe("official script layout (v3)", () => {
  // 직접 쓴 합성 대본 — 공식 대본 PDF 텍스트의 배치(지시문 · 쪽 번호 · 저작권 문구 · 16～17 공유 지문)만 흉내
  const layout = readFileSync(
    path.join(__dirname, "../fixtures/english/listening-script-official-layout.txt"),
    "utf8",
  );
  const p = parseListeningScript(layout);
  const by = (n: number) => p.questions.find((q) => q.questionNumber === n)!;

  it("recognises all 17 questions including a fullwidth ～ shared range", () => {
    expect(p.questions.map((q) => q.questionNumber)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
    expect(validateListeningScript(p)).toEqual({ ok: true });
    expect(p.warnings).toEqual([]);
  });

  it("does not treat '16번부터 17번까지는 …' as a question marker", () => {
    // 15번 대본 뒤에 안내문이 끼어들거나 16번이 안내문에서 시작하지 않는다
    expect(
      by(15)
        .lines.map((l) => l.text)
        .join(" "),
    ).not.toMatch(/[가-힣]/);
    expect(by(16).lines[0]!.text).toBe(
      "Shared test talk about invented gardens that wraps onto a second line. Now, let us begin.",
    );
    expect(by(17).lines).toEqual(by(16).lines);
  });

  it("keeps Korean instructions (even with English names) and footers out of transcripts", () => {
    for (const q of p.questions)
      for (const l of q.lines) expect(l.text, `${q.questionNumber}`).not.toMatch(/[가-힣]/);
    expect(by(8).lines[0]!.text).toBe(
      "Test speaker line for question 8 begins here and continues on the next line.",
    );
    expect(by(7).lines.at(-1)).toEqual({ speaker: "W", text: "See you later." });
    expect(by(15).lines).toHaveLength(1);
  });

  it("keeps Korean speaker labels working", () => {
    const k = parseListeningScript("1번\n남: Hello there.\n여: Hi.");
    expect(k.questions[0]!.lines).toEqual([
      { speaker: "M", text: "Hello there." },
      { speaker: "W", text: "Hi." },
    ]);
  });
});

const track = (over: Partial<ListeningTrack>): ListeningTrack => ({
  id: `t${over.questionNumber ?? "all"}`,
  examId: "e",
  fileId: "f",
  questionNumber: 1,
  label: "1번",
  startSeconds: 0,
  endSeconds: 10,
  timingVerified: true,
  transcript: null,
  transcriptOrigin: null,
  transcriptSourceUrl: null,
  ...over,
});

describe("listening fallback and verified segmentation", () => {
  const verified = [
    track({ questionNumber: 2, startSeconds: 10, endSeconds: 20 }),
    track({ questionNumber: 1, startSeconds: 0, endSeconds: 10 }),
  ];
  const unverified = [
    track({ questionNumber: 1, startSeconds: 0, endSeconds: 0, timingVerified: false }),
    track({
      questionNumber: 2,
      startSeconds: 5,
      endSeconds: 9,
      timingVerified: false,
      transcript: [{ speaker: "M", text: "Hi." }],
      transcriptOrigin: "official",
    }),
  ];

  it("uses segments only when timing is verified", () => {
    expect(listeningMode(verified)).toBe("segments");
    expect(verifiedSegments(verified).map((t) => t.questionNumber)).toEqual([1, 2]);
    expect(listeningMode(unverified)).toBe("full_only");
    expect(verifiedSegments(unverified)).toEqual([]);
    expect(listeningMode([])).toBe("full_only");
  });

  it("transcripts and dictation work without verified timings", () => {
    expect(transcriptTracks(unverified).map((t) => t.questionNumber)).toEqual([2]);
  });

  it("prev/next stop at the ends and seeking stays inside the segment", () => {
    const segs = verifiedSegments(verified);
    expect(neighborSegment(segs, null, 1)?.questionNumber).toBe(1);
    expect(neighborSegment(segs, "t1", 1)?.questionNumber).toBe(2);
    expect(neighborSegment(segs, "t2", 1)).toBeNull();
    expect(neighborSegment(segs, "t1", -1)).toBeNull();
    expect(clampSeek(segs[1]!, 3)).toBe(10);
    expect(clampSeek(segs[1]!, 99)).toBe(19.75);
  });

  it("highlights a transcript line only when its timing was provided", () => {
    const lines = [
      { speaker: null, text: "a", startSeconds: 0, endSeconds: 2 },
      { speaker: null, text: "b", startSeconds: 2, endSeconds: 4 },
    ];
    expect(activeLineIndex(lines, 2.5)).toBe(1);
    expect(activeLineIndex([{ speaker: null, text: "x" }], 1)).toBeNull();
  });
});

describe("provenance & review states", () => {
  it("only official/authorized (and dev samples) transcripts are shown", () => {
    expect(isPublishableTranscript("official")).toBe(true);
    expect(isPublishableTranscript("authorized")).toBe(true);
    expect(isPublishableTranscript("unverified")).toBe(false);
  });

  it("generated material cannot skip approval before publishing", () => {
    expect(canTransition("generated", "published")).toBe(false);
    expect(canTransition("generated", "approved")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("published", "rejected")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("reading note content is validated field by field", () => {
    expect(toReadingNote(null, "generated", {})).toBeNull();
    expect(
      toReadingNote(31, "ai_assisted", {
        questionType: "빈칸 추론",
        grammarPoints: ["관계대명사 what", 3, ""],
        wrongChoices: [{ choice: 2, reason: "본문과 반대" }, { choice: "x" }],
      }),
    ).toMatchObject({
      questionNumber: 31,
      questionType: "빈칸 추론",
      grammarPoints: ["관계대명사 what"],
      wrongChoices: [{ choice: 2, reason: "본문과 반대" }],
      origin: "ai_assisted",
    });
  });
});

describe("English availability overview", () => {
  const base: EnglishAvailabilityInput = {
    fileTypes: [],
    processingTypes: [],
    vocabularyCount: 0,
    transcriptCount: 0,
    verifiedSegmentCount: 0,
    questionCount: 0,
    explainedQuestionCount: 0,
    readingNotes: [],
    pendingMaterialKinds: [],
    publishedWorksheetTypes: [],
  };
  const state = (input: EnglishAvailabilityInput) =>
    Object.fromEntries(englishAvailability(input).map((i) => [i.key, i.state]));

  it("lists all ten items and marks everything none for an empty exam", () => {
    const items = englishAvailability(base);
    expect(items.map((i) => i.label)).toEqual([
      "문제 PDF",
      "정답·해설 PDF",
      "듣기 음원",
      "듣기 대본",
      "단어장",
      "받아쓰기",
      "문항별 해설",
      "문법·구문",
      "문제 유형",
      "학습지",
    ]);
    expect(new Set(items.map((i) => i.state))).toEqual(new Set(["none"]));
  });

  it("distinguishes available / processing (검증·검토 중) / none", () => {
    const s = state({
      ...base,
      fileTypes: ["question", "listening_audio"],
      processingTypes: ["solution"],
      pendingMaterialKinds: ["vocabulary_test"],
    });
    expect(s).toMatchObject({
      question: "available",
      solution: "processing",
      listening_audio: "available",
      dictation: "none",
      worksheets: "processing",
    });
    const audio = englishAvailability({ ...base, fileTypes: ["listening_audio"] }).find(
      (i) => i.key === "listening_audio",
    );
    expect(audio?.detail).toBe("전체 재생 (문항 구간 미검증)");
  });
});

describe("generated worksheets", () => {
  const exam = { year: 2026, grade: 3, month: 9 };
  const words = Array.from({ length: MIN_VOCAB_TEST_WORDS }, (_, i) => ({
    questionNumber: 18 + (i % 2),
    word: `word${i}`,
    meaning: `뜻${i}`,
    partOfSpeech: i === 0 ? "n." : null,
  }));

  it("builds only what the real inputs support, with friendly file names", () => {
    expect(worksheetSpecs({ exam, vocabulary: [], transcripts: [], questions: [] })).toEqual([]);
    const specs = worksheetSpecs({
      exam,
      vocabulary: words,
      transcripts: [
        { questionNumber: 1, lines: [{ speaker: "M", text: "Please close the window." }] },
      ],
      questions: [{ questionNumber: 1, score: 2 }],
    });
    expect(specs.map((s) => s.type)).toEqual([
      "vocabulary_pdf",
      "vocabulary_test",
      "vocabulary_test_answers",
      "dictation_sheet",
      "dictation_answers",
      "question_checklist",
    ]);
    expect(specs.map((s) => s.fileName)).toContain("2026-고3-09월-영어-단어시험-정답.pdf");
    for (const s of specs) expect(s.sourceNote).toContain("모의고사 창고가 만든 학습 자료");
  });

  it("test sheet hides meanings; answers sheet has them; dictation hides words", () => {
    const specs = worksheetSpecs({
      exam,
      vocabulary: words,
      transcripts: [
        { questionNumber: 1, lines: [{ speaker: "M", text: "Please close the window." }] },
      ],
      questions: [],
    });
    const test = specs.find((s) => s.type === "vocabulary_test")!;
    const answers = specs.find((s) => s.type === "vocabulary_test_answers")!;
    expect(test.groups[0]!.rows.every((r) => r.cells[2] === "")).toBe(true);
    expect(answers.groups[0]!.rows[0]!.cells[2]).toMatch(/^뜻/);
    const sheet = specs.find((s) => s.type === "dictation_sheet")!;
    expect(sheet.groups[0]!.rows[0]!.cells[0]).toContain("____");
    expect(sheet.groups[0]!.rows[0]!.cells[0]).not.toContain("window");
  });

  it("fingerprint changes only when inputs change", () => {
    const a = worksheetSpecs({ exam, vocabulary: words, transcripts: [], questions: [] });
    const b = worksheetSpecs({
      exam,
      vocabulary: [...words].reverse(),
      transcripts: [],
      questions: [],
    });
    expect(a.map((s) => s.fingerprint)).toEqual(b.map((s) => s.fingerprint));
    const c = worksheetSpecs({
      exam,
      vocabulary: [
        ...words,
        { questionNumber: 20, word: "extra", meaning: "추가", partOfSpeech: null },
      ],
      transcripts: [],
      questions: [],
    });
    expect(c[0]!.fingerprint).not.toBe(a[0]!.fingerprint);
  });
});

describe("reading note input guard (no full passages)", () => {
  it("rejects long passage-like text and out-of-range questions", async () => {
    const { readingNoteInputSchema } = await import("../../src/ingestion/study/reading-notes");
    const ok = {
      year: 2026,
      grade: 3,
      month: 9,
      questionNumber: 31,
      origin: "generated",
      keyPoints: ["짧은 메모"],
    };
    expect(readingNoteInputSchema.safeParse(ok).success).toBe(true);
    expect(
      readingNoteInputSchema.safeParse({ ...ok, keyPoints: ["word ".repeat(80)] }).success,
    ).toBe(false);
    expect(readingNoteInputSchema.safeParse({ ...ok, questionNumber: 3 }).success).toBe(false);
    expect(readingNoteInputSchema.safeParse({ ...ok, origin: "official" }).success).toBe(false);
  });
});
