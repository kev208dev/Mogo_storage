/**
 * ⚠️ 개발용 샘플 데이터 ⚠️
 *
 * 이 파일의 모든 데이터는 UI/기능 확인을 위해 만든 가짜 데이터다.
 * - 정답, 해설, 정답률, 등급컷, 단어장, 듣기 대본은 실제 시험과 무관하다.
 * - 실제 시험지/해설지 PDF 또는 음원은 포함하지 않는다. (mock storage가 placeholder 파일을 만든다)
 * - 모든 레코드는 isSample=true 또는 "샘플" 출처 표기를 가진다.
 *
 * DATABASE_URL 이 없을 때 in-memory 저장소로 사용되고, `npm run db:seed` 로 DB에도 넣을 수 있다.
 */
import {
  GRADES,
  SUBJECTS,
  type ExamType,
  type FileType,
  type Grade,
  type GradeCutSource,
  type Subject,
} from "../constants";
import { examSlug, monthSegment } from "../exam-path";
import type {
  Exam,
  ExamFile,
  ExamSchedule,
  ExamSubject,
  GradeCut,
  ListeningTrack,
  Question,
  QuestionStatistic,
  TranscriptLine,
  VocabularyItem,
} from "./types";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
export const SAMPLE_STATISTICS_SOURCE = "샘플 통계 (개발용)";

/** 대표 샘플 시험: 모든 부가기능 데이터가 들어있다. */
export const FEATURED_EXAM = { year: 2025, grade: 2 as Grade, month: 9 };

// ── deterministic PRNG ──────────────────────────────────────
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── exams ───────────────────────────────────────────────────
const MONTHS_BY_GRADE: Record<Grade, number[]> = {
  1: [3, 6, 9, 10, 11],
  2: [3, 6, 9, 10, 11],
  3: [3, 4, 6, 7, 9, 10],
};

function examTypeOf(grade: Grade, month: number): ExamType {
  return grade === 3 && (month === 6 || month === 9) ? "kice_mock" : "school_mock";
}

function organizerOf(type: ExamType): string {
  return type === "kice_mock" ? "한국교육과정평가원" : "시·도 교육청";
}

function examId(year: number, grade: Grade, month: number): string {
  return `exam_${year}_h${grade}_${monthSegment(month)}`;
}

function buildExams(): Exam[] {
  const exams: Exam[] = [];
  // 오늘(2026-09) 기준으로 이미 시행된 시험만 샘플로 만든다.
  const lastMonthOf = (year: number) => (year === 2026 ? 9 : 12);
  for (const year of [2023, 2024, 2025, 2026]) {
    for (const grade of GRADES) {
      for (const month of MONTHS_BY_GRADE[grade]) {
        if (month > lastMonthOf(year)) continue;
        const examType = examTypeOf(grade, month);
        exams.push({
          id: examId(year, grade, month),
          year,
          grade,
          month,
          examType,
          organizer: organizerOf(examType),
          examDate: null,
          slug: examSlug({ year, grade, month }),
          academicYear: examType === "kice_mock" || examType === "csat" ? year + 1 : null,
          isSample: true,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        });
      }
    }
  }
  return exams;
}

// ── subjects ────────────────────────────────────────────────
const SUBJECT_SHAPE: Record<Subject, { questionCount: number; totalScore: number }> = {
  korean: { questionCount: 45, totalScore: 100 },
  math: { questionCount: 30, totalScore: 100 },
  english: { questionCount: 45, totalScore: 100 },
  history: { questionCount: 20, totalScore: 50 },
  social: { questionCount: 20, totalScore: 50 },
  science: { questionCount: 20, totalScore: 50 },
};

function buildExamSubjects(exams: Exam[]): ExamSubject[] {
  return exams.flatMap((exam) =>
    SUBJECTS.map((subject) => ({ examId: exam.id, subject, ...SUBJECT_SHAPE[subject] })),
  );
}

// ── files (featured exam only) ──────────────────────────────
const MIME: Record<FileType, string> = {
  question: "application/pdf",
  solution: "application/pdf",
  listening_audio: "audio/mpeg",
  listening_script: "application/pdf",
  vocabulary_pdf: "application/pdf",
};

const EXT: Record<FileType, string> = {
  question: "pdf",
  solution: "pdf",
  listening_audio: "mp3",
  listening_script: "pdf",
  vocabulary_pdf: "pdf",
};

const FILE_NAME_LABEL: Record<FileType, string> = {
  question: "문제",
  solution: "정답및해설",
  listening_audio: "듣기",
  listening_script: "듣기대본",
  vocabulary_pdf: "단어장",
};

const SUBJECT_FILE_LABEL: Record<Subject, string> = {
  korean: "국어",
  math: "수학",
  english: "영어",
  history: "한국사",
  social: "사회",
  science: "과학",
};

function makeFile(exam: Exam, subject: Subject, type: FileType, fileSize: number): ExamFile {
  const base = `exams/${exam.year}/high${exam.grade}/${monthSegment(exam.month)}/${subject}`;
  return {
    id: `file_${exam.id.replace("exam_", "")}_${subject}_${type}`,
    examId: exam.id,
    subject,
    type,
    deliveryType: "storage",
    storageKey: `${base}/${type}.${EXT[type]}`,
    externalUrl: null,
    artifactOrigin: "official",
    sourceArtifactId: null,
    sourceLabel: null,
    mimeType: MIME[type],
    fileSize,
    originalFileName: `[샘플] ${exam.year}년 고${exam.grade} ${exam.month}월 ${SUBJECT_FILE_LABEL[subject]} ${FILE_NAME_LABEL[type]}.${EXT[type]}`,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function buildFiles(featured: Exam): ExamFile[] {
  const rand = mulberry32(hashString("files"));
  const size = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const files: ExamFile[] = [];
  for (const subject of SUBJECTS) {
    files.push(makeFile(featured, subject, "question", size(1_800_000, 6_500_000)));
    // 한국사 해설지는 "자료 준비 중" 상태 확인용으로 비워둔다.
    if (subject !== "history") {
      files.push(makeFile(featured, subject, "solution", size(900_000, 3_200_000)));
    }
  }
  files.push(makeFile(featured, "english", "listening_audio", 14_200_000));
  files.push(makeFile(featured, "english", "listening_script", 420_000));
  files.push(makeFile(featured, "english", "vocabulary_pdf", 310_000));
  return files;
}

// ── questions / statistics ──────────────────────────────────
function scoreTable(subject: Subject, count: number): number[] {
  switch (subject) {
    case "math": {
      // 2점 3문항 + 3점 14문항 + 4점 13문항 = 100
      return Array.from({ length: count }, (_, i) => (i < 3 ? 2 : i < 17 ? 3 : 4));
    }
    case "korean":
    case "english": {
      // 2점 35문항 + 3점 10문항 = 100
      const threes = new Set([12, 16, 21, 24, 29, 31, 33, 34, 37, 39]);
      return Array.from({ length: count }, (_, i) => (threes.has(i + 1) ? 3 : 2));
    }
    default: {
      // 2점 10문항 + 3점 10문항 = 50
      return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 2 : 3));
    }
  }
}

function buildQuestions(featured: Exam): Question[] {
  const questions: Question[] = [];
  for (const subject of SUBJECTS) {
    const { questionCount } = SUBJECT_SHAPE[subject];
    const scores = scoreTable(subject, questionCount);
    const rand = mulberry32(hashString(`answers:${subject}`));
    for (let n = 1; n <= questionCount; n += 1) {
      const isShortAnswer = subject === "math" && n >= 22;
      const answer = isShortAnswer
        ? String(Math.floor(rand() * 200) + 1)
        : String(Math.floor(rand() * 5) + 1);
      questions.push({
        id: `q_${featured.id.replace("exam_", "")}_${subject}_${n}`,
        examId: featured.id,
        subject,
        questionNumber: n,
        answer,
        choiceCount: isShortAnswer ? null : 5,
        score: scores[n - 1] ?? 2,
        explanation: `[샘플 해설] ${n}번 문항의 해설 자리입니다. 실제 해설이 아닌 개발용 예시 문장이며, 향후 웹 해설 또는 해설지 PDF 페이지와 연결됩니다.`,
        solutionPage: Math.floor((n - 1) / 4) + 1,
      });
    }
  }
  return questions;
}

function buildStatistics(questions: Question[]): QuestionStatistic[] {
  const rand = mulberry32(hashString("stats"));
  return questions
    .filter((q) => q.subject === "english" || q.subject === "math" || q.subject === "korean")
    .map((q) => {
      // 뒤 번호일수록 어렵게: 대략 95% → 15%
      const base = 95 - (q.questionNumber / (q.subject === "math" ? 30 : 45)) * 70;
      const correctRate = Math.max(8, Math.min(98, Math.round(base + (rand() - 0.5) * 30)));
      let answerDistribution: number[] | null = null;
      if (q.choiceCount) {
        const correctIndex = Number(q.answer) - 1;
        const weights = Array.from({ length: q.choiceCount }, () => rand() + 0.2);
        const wrongTotal = weights.reduce((acc, w, i) => (i === correctIndex ? acc : acc + w), 0);
        const rest = 100 - correctRate;
        answerDistribution = weights.map((w, i) =>
          i === correctIndex ? correctRate : Math.round((w / wrongTotal) * rest),
        );
        // 반올림 오차 보정
        const diff = 100 - answerDistribution.reduce((a, b) => a + b, 0);
        const fixIndex = correctIndex === 0 ? 1 : 0;
        answerDistribution[fixIndex] = Math.max(0, (answerDistribution[fixIndex] ?? 0) + diff);
      }
      return {
        id: `stat_${q.id}`,
        questionId: q.id,
        correctRate,
        answerDistribution,
        statisticsSource: SAMPLE_STATISTICS_SOURCE,
        statisticsSourceUrl: null,
        isSample: true,
        statisticsUpdatedAt: CREATED_AT,
      };
    });
}

// ── grade cuts ──────────────────────────────────────────────
function buildGradeCuts(featured: Exam): GradeCut[] {
  const cuts: GradeCut[] = [];
  const make = (
    subject: Subject,
    source: GradeCutSource,
    values: number[],
    sourceUrl: string | null,
  ): GradeCut => ({
    id: `gc_${featured.id.replace("exam_", "")}_${subject}_${source}`,
    examId: featured.id,
    subject,
    source,
    sourceUrl,
    isOfficial: source === "official",
    isSample: true,
    cuts: values.map((rawScore, i) => ({ grade: i + 1, rawScore })),
    updatedAt: CREATED_AT,
  });

  // 상대평가 과목: 모든 수치는 임의로 만든 샘플이다.
  const relative: Array<[Subject, Record<GradeCutSource, number[]>]> = [
    [
      "korean",
      {
        official: [88, 80, 70, 59, 47, 36, 26, 18],
        megastudy: [88, 79, 69, 58, 46, 35, 26, 18],
        daesung: [89, 80, 70, 59, 47, 36, 27, 19],
        ebs: [88, 80, 69, 58, 47, 36, 26, 18],
      },
    ],
    [
      "math",
      {
        official: [84, 76, 64, 50, 36, 25, 16, 10],
        megastudy: [84, 75, 63, 50, 36, 24, 16, 10],
        daesung: [85, 76, 64, 51, 37, 25, 17, 11],
        ebs: [84, 76, 64, 50, 36, 25, 16, 10],
      },
    ],
  ];
  for (const [subject, bySource] of relative) {
    for (const source of Object.keys(bySource) as GradeCutSource[]) {
      cuts.push(make(subject, source, bySource[source], null));
    }
  }
  // 영어·한국사는 절대평가. (등급 기준 점수를 샘플로 입력)
  cuts.push(make("english", "official", [90, 80, 70, 60, 50, 40, 30, 20], null));
  cuts.push(make("history", "official", [40, 35, 30, 25, 20, 15, 10, 5], null));
  return cuts;
}

// ── vocabulary ──────────────────────────────────────────────
const VOCAB_BY_QUESTION: Record<number, Array<[string, string, string, 1 | 2 | 3]>> = {
  18: [
    ["environment", "환경", "n.", 1],
    ["recognize", "인식하다, 알아보다", "v.", 1],
    ["significant", "중요한, 상당한", "adj.", 2],
    ["facility", "시설", "n.", 2],
    ["renovation", "보수, 개조", "n.", 3],
  ],
  19: [
    ["individual", "개인; 개인의", "n.", 1],
    ["interaction", "상호작용", "n.", 2],
    ["determine", "결정하다, 알아내다", "v.", 2],
    ["anxious", "불안한", "adj.", 1],
    ["relieved", "안도한", "adj.", 2],
  ],
  20: [
    ["priority", "우선순위", "n.", 2],
    ["consistent", "일관된", "adj.", 2],
    ["pursue", "추구하다", "v.", 2],
    ["deliberately", "의도적으로", "adv.", 3],
  ],
  21: [
    ["perception", "인식, 지각", "n.", 3],
    ["inevitable", "불가피한", "adj.", 3],
    ["assumption", "가정, 추정", "n.", 2],
    ["distort", "왜곡하다", "v.", 3],
  ],
  22: [
    ["cooperation", "협력", "n.", 1],
    ["benefit", "이익; 이익을 얻다", "n.", 1],
    ["sustain", "유지하다, 지속시키다", "v.", 2],
    ["collective", "집단의, 공동의", "adj.", 2],
  ],
  23: [
    ["adaptation", "적응", "n.", 2],
    ["species", "종(種)", "n.", 1],
    ["exposure", "노출", "n.", 2],
    ["variation", "변이, 변화", "n.", 2],
  ],
  24: [
    ["innovation", "혁신", "n.", 2],
    ["resistance", "저항", "n.", 2],
    ["conventional", "관습적인, 전통적인", "adj.", 3],
    ["embrace", "받아들이다", "v.", 2],
  ],
  29: [
    ["compensate", "보상하다", "v.", 3],
    ["hypothesis", "가설", "n.", 3],
    ["substantial", "상당한", "adj.", 2],
    ["inherent", "내재된", "adj.", 3],
  ],
  31: [
    ["ambiguity", "모호함", "n.", 3],
    ["interpret", "해석하다", "v.", 2],
    ["context", "맥락", "n.", 1],
    ["implicit", "암시적인", "adj.", 3],
  ],
};

function buildVocabulary(featured: Exam, questions: Question[]): VocabularyItem[] {
  const items: VocabularyItem[] = [];
  for (const [numberText, words] of Object.entries(VOCAB_BY_QUESTION)) {
    const questionNumber = Number(numberText);
    const question = questions.find(
      (q) => q.subject === "english" && q.questionNumber === questionNumber,
    );
    if (!question) continue;
    for (const [word, meaning, partOfSpeech, difficulty] of words) {
      items.push({
        id: `voc_${questionNumber}_${word}`,
        examId: featured.id,
        questionId: question.id,
        questionNumber,
        word,
        meaning,
        partOfSpeech,
        difficulty,
        createdAt: CREATED_AT,
      });
    }
  }
  return items;
}

// ── listening ───────────────────────────────────────────────
/** 샘플 대본: 실제 시험 대본이 아닌 개발용 창작 문장이다. */
const SAMPLE_TRANSCRIPTS: TranscriptLine[][] = [
  [
    { speaker: "W", text: "Hello, students. This is your librarian speaking." },
    { speaker: "W", text: "The library will be closed next Monday for cleaning." },
  ],
  [
    { speaker: "M", text: "I was wondering whether you could help me with my science project." },
    { speaker: "W", text: "Of course. What do you need?" },
  ],
  [
    { speaker: "W", text: "You look tired today. Did you sleep well?" },
    { speaker: "M", text: "Not really. I stayed up late finishing my essay." },
  ],
  [
    { speaker: "M", text: "Look at this picture of our school garden." },
    { speaker: "W", text: "I like the bench under the tall tree." },
  ],
  [
    { speaker: "W", text: "Can you bring the speakers to the gym after lunch?" },
    { speaker: "M", text: "Sure. I will ask my friend to help me carry them." },
  ],
  [
    { speaker: "M", text: "How much are the concert tickets?" },
    { speaker: "W", text: "They are twenty dollars each, but students get a discount." },
  ],
  [
    { speaker: "W", text: "Why didn't you join the soccer practice yesterday?" },
    { speaker: "M", text: "I had to visit my grandmother in the hospital." },
  ],
  [
    { speaker: "M", text: "Are you going to the science fair this weekend?" },
    { speaker: "W", text: "Yes, it starts at ten in the morning at the city hall." },
  ],
  [
    { speaker: "W", text: "Our town is holding a recycling campaign next month." },
    { speaker: "W", text: "Everyone who participates will receive a small gift." },
  ],
  [
    { speaker: "M", text: "I am looking for a backpack for hiking." },
    { speaker: "W", text: "This one is light and has a water bottle pocket." },
  ],
  [
    { speaker: "W", text: "Did you finish reading the book I lent you?" },
    { speaker: "M", text: "Almost. I will return it to you tomorrow." },
  ],
  [
    { speaker: "M", text: "Excuse me, where can I find the lost and found office?" },
    { speaker: "W", text: "It is on the first floor next to the main entrance." },
  ],
  [
    { speaker: "W", text: "I heard you are planning a trip to the mountains." },
    { speaker: "M", text: "That's right. I want to watch the sunrise from the top." },
    { speaker: "W", text: "Don't forget to bring a warm jacket." },
  ],
  [
    { speaker: "M", text: "Our club needs a new logo for the festival." },
    { speaker: "W", text: "Why don't we hold a design contest among the members?" },
    { speaker: "M", text: "That sounds like a great idea." },
  ],
  [
    { speaker: "W", text: "Mina wants to learn how to play the guitar." },
    { speaker: "W", text: "She asks her brother, who is good at music, for advice." },
  ],
  [
    {
      speaker: "M",
      text: "Today, I'd like to talk about animals that live in extreme environments.",
    },
    { speaker: "M", text: "Some of them survive without water for several months." },
  ],
  [
    { speaker: "M", text: "For example, camels store energy in their humps." },
    { speaker: "M", text: "This helps them travel long distances across the desert." },
  ],
];

const TRACK_SECONDS = 3;

function buildListeningTracks(featured: Exam, files: ExamFile[]): ListeningTrack[] {
  const audio = files.find((f) => f.subject === "english" && f.type === "listening_audio");
  if (!audio) return [];
  const tracks: ListeningTrack[] = [
    {
      id: `lt_${featured.id}_all`,
      examId: featured.id,
      fileId: audio.id,
      questionNumber: null,
      label: "전체 듣기",
      startSeconds: 0,
      endSeconds: SAMPLE_TRANSCRIPTS.length * TRACK_SECONDS,
      transcript: null,
    },
  ];
  SAMPLE_TRANSCRIPTS.forEach((transcript, index) => {
    const questionNumber = index + 1;
    tracks.push({
      id: `lt_${featured.id}_${questionNumber}`,
      examId: featured.id,
      fileId: audio.id,
      questionNumber,
      label: `${questionNumber}번`,
      startSeconds: index * TRACK_SECONDS,
      endSeconds: (index + 1) * TRACK_SECONDS,
      transcript,
    });
  });
  return tracks;
}

// ── schedules ───────────────────────────────────────────────
/**
 * 샘플 일정 1건 (시험 전 페이지 UI 확인용). 실제 일정이 아니며 isSample=true.
 * 운영 DB 에는 공식 발표로 확인된 일정만 등록한다.
 */
function buildSchedules(): ExamSchedule[] {
  return [
    {
      id: "sched_sample_2026_h2_10",
      year: 2026,
      grade: 2,
      month: 10,
      examType: "school_mock",
      organizer: organizerOf("school_mock"),
      examDate: "2026-10-21",
      expectedReleaseStart: null,
      expectedReleaseEnd: null,
      status: "scheduled",
      announcementUrl: null,
      isSample: true,
      examId: examId(2026, 2, 10),
    },
  ];
}

function buildScheduledExams(schedules: ExamSchedule[]): Exam[] {
  return schedules
    .filter((s) => s.examId)
    .map((s) => ({
      id: s.examId!,
      year: s.year,
      grade: s.grade,
      month: s.month,
      academicYear: null,
      examType: s.examType,
      organizer: s.organizer,
      examDate: s.examDate,
      slug: examSlug(s),
      isSample: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }));
}

// ── assemble ────────────────────────────────────────────────
export interface SampleDataset {
  exams: Exam[];
  examSubjects: ExamSubject[];
  files: ExamFile[];
  questions: Question[];
  statistics: QuestionStatistic[];
  gradeCuts: GradeCut[];
  vocabulary: VocabularyItem[];
  listeningTracks: ListeningTrack[];
  schedules: ExamSchedule[];
}

function buildSampleDataset(): SampleDataset {
  const schedules = buildSchedules();
  const exams = [...buildExams(), ...buildScheduledExams(schedules)];
  const featured = exams.find(
    (e) =>
      e.year === FEATURED_EXAM.year &&
      e.grade === FEATURED_EXAM.grade &&
      e.month === FEATURED_EXAM.month,
  );
  if (!featured) throw new Error("Featured sample exam is missing");
  const files = buildFiles(featured);
  const questions = buildQuestions(featured);
  return {
    exams,
    examSubjects: buildExamSubjects(exams),
    files,
    questions,
    statistics: buildStatistics(questions),
    gradeCuts: buildGradeCuts(featured),
    vocabulary: buildVocabulary(featured, questions),
    listeningTracks: buildListeningTracks(featured, files),
    schedules,
  };
}

export const sampleDataset: SampleDataset = buildSampleDataset();

/** mock storage가 샘플 음원 길이를 알 수 있도록 노출 */
export const SAMPLE_AUDIO_SECONDS = SAMPLE_TRANSCRIPTS.length * TRACK_SECONDS;
