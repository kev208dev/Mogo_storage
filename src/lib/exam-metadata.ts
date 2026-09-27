import type { Metadata } from "next";
import { SITE_NAME, SUBJECTS, SUBJECT_LABELS, type Subject } from "./constants";
import { courseByCode, courseSeoName, SUBJECT_AREA_LABELS } from "./courses";
import type { Course, Exam, ExamSubject, ExamSubjectDetail } from "./data/types";
import { examCoursePath, examPath, examTitle } from "./exam-path";
import { absoluteUrl } from "./site";

/**
 * 페이지가 실제로 제공하는 것. title · description · visible heading 은 이 값으로만 기능을 말한다.
 * (없는 등급컷·듣기·단어장을 주장하지 않는다)
 */
export interface ExamSeoFeatures {
  /** 문제지 PDF */
  questionPaper: boolean;
  /** 정답·해설 PDF */
  solution: boolean;
  /** 검증된 문항 정답 (정답 바로 보기 · 자동 채점) */
  answers: boolean;
  gradeCuts: boolean;
  listening: boolean;
  vocabulary: boolean;
}

export const NO_FEATURES: ExamSeoFeatures = {
  questionPaper: false,
  solution: false,
  answers: false,
  gradeCuts: false,
  listening: false,
  vocabulary: false,
};

/** 시험 상세 데이터 → 제공 기능 (이미 불러온 detail 만 쓴다: 추가 조회 없음) */
export function examSeoFeatures(detail: ExamSubjectDetail): ExamSeoFeatures {
  const has = (type: string) => detail.files.some((f) => f.type === type);
  return {
    questionPaper: has("question"),
    solution: has("solution"),
    answers: detail.questions.length > 0,
    gradeCuts: detail.gradeCuts.length > 0,
    listening: has("listening_audio"),
    vocabulary: detail.vocabulary.length > 0,
  };
}

/** 3·6·9월만 널리 쓰는 약칭이 있다 (3모 · 6모 · 9모). 다른 달은 약칭을 만들지 않는다 */
export function monthAlias(month: number): string | null {
  return month === 3 || month === 6 || month === 9 ? `${month}모` : null;
}

/** "2026년 고3 9월 모의고사(9모)" */
export function examSearchTitle(exam: Pick<Exam, "year" | "grade" | "month">): string {
  const alias = monthAlias(exam.month);
  return `${examTitle(exam)}${alias ? `(${alias})` : ""}`;
}

/** "문제·정답·해설·등급컷" — 실제로 있는 것만 */
export function examContentWords(features: ExamSeoFeatures): string {
  return [
    features.questionPaper && "문제",
    (features.solution || features.answers) && "정답",
    features.solution && "해설",
    features.gradeCuts && "등급컷",
  ]
    .filter(Boolean)
    .join("·");
}

type ExamSeoOptions = {
  upcomingExamDate?: string | null;
  course?: Course | null;
  features?: ExamSeoFeatures;
};

function courseDisplayName(course: Course): string {
  const abbr = courseByCode(course.code)?.abbreviations[0];
  return abbr ? `${course.name}(${abbr})` : course.name;
}

function formatKoreanDate(isoDate: string): string {
  return isoDate.replace(
    /^(\d{4})-(\d{2})-(\d{2})$/,
    (_, y, m, d) => `${y}년 ${Number(m)}월 ${Number(d)}일`,
  );
}

function buildExamSeoContent(
  exam: Exam,
  subjects: ExamSubject[],
  subject: Subject | null,
  options: ExamSeoOptions = {},
) {
  const features = options.features ?? NO_FEATURES;
  const course = options.course ?? null;
  const searchTitle = examSearchTitle(exam);
  const subjectSeoName = subject ? (SUBJECT_AREA_LABELS[subject] ?? SUBJECT_LABELS[subject]) : null;
  const nameInTitle = course ? courseSeoName(course.name) : subjectSeoName;
  const words = examContentWords(features);

  const title = [searchTitle, nameInTitle, words || (options.upcomingExamDate ? "시행 일정" : null)]
    .filter(Boolean)
    .join(" ");

  const available = SUBJECTS.filter((s) => subjects.some((x) => x.subject === s));
  const subjectDesc = course
    ? `${SUBJECT_AREA_LABELS[course.subject] ?? SUBJECT_LABELS[course.subject]} ${courseDisplayName(course)}`
    : subject
      ? SUBJECT_LABELS[subject]
      : available.map((s) => SUBJECT_LABELS[s]).join(", ");

  const files =
    features.questionPaper && features.solution
      ? "문제지와 정답·해설 PDF"
      : features.questionPaper
        ? "문제지 PDF"
        : features.solution
          ? "정답·해설 PDF"
          : null;
  const extras = [
    features.answers && "정답 바로 보기와 자동 채점",
    features.gradeCuts && "등급컷",
    features.listening && "영어 듣기 MP3",
    features.vocabulary && "지문별 단어장",
  ].filter(Boolean);

  let description: string;
  if (options.upcomingExamDate) {
    description = `${searchTitle} 시행일은 ${formatKoreanDate(options.upcomingExamDate)}입니다. 시험 종료 후 공식 문제지와 정답·해설이 공개되면 이 페이지에서 받을 수 있습니다.`;
  } else if (files || extras.length) {
    description = `${searchTitle} ${subjectDesc}${files ? ` ${files}를 바로 확인하고 받을 수 있습니다.` : "."}${
      extras.length ? ` ${extras.join(", ")}도 제공합니다.` : ""
    }`;
  } else {
    description = `${searchTitle} ${subjectDesc} 자료입니다. 공식 문제지와 정답·해설은 공개되는 대로 제공합니다.`;
  }

  const path = course
    ? examCoursePath(exam, course.subject, course.code)
    : examPath(exam, subject ?? undefined);

  return { title, description, path, course, subjectSeoName };
}

export function buildExamMetadata(
  exam: Exam,
  subjects: ExamSubject[],
  subject: Subject | null,
  options: ExamSeoOptions = {},
): Metadata {
  const { title, description, path } = buildExamSeoContent(exam, subjects, subject, options);

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title: `${title} | ${SITE_NAME}`,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "ko_KR",
    },
    twitter: { card: "summary", title, description },
    // 샘플 데이터 시험은 운영 환경 검색 결과에 노출되지 않도록 한다. (실제 데이터는 isSample=false → index)
    robots: shouldNoindexExam(exam) ? { index: false, follow: true } : undefined,
  };
}

/** 시험 상세 페이지용 Schema.org CollectionPage JSON-LD (BreadcrumbList 는 Breadcrumb 이 따로 낸다) */
export function buildExamStructuredData(
  exam: Exam,
  subjects: ExamSubject[],
  subject: Subject | null,
  options: ExamSeoOptions = {},
): Record<string, unknown> {
  const { title, description, path, course, subjectSeoName } = buildExamSeoContent(
    exam,
    subjects,
    subject,
    options,
  );
  const about: Array<Record<string, string>> = [{ "@type": "Thing", name: examTitle(exam) }];
  if (subjectSeoName) {
    about.push({
      "@type": "Thing",
      name: course ? `${subjectSeoName} ${course.name}` : subjectSeoName,
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: absoluteUrl(path),
    inLanguage: "ko-KR",
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    about,
  };
}

/**
 * 샘플 시험 noindex 정책.
 * production 에서는 기본적으로 샘플 시험을 noindex 하고, 측정 등 특수한 경우에만
 * ALLOW_SAMPLE_INDEXING=1 로 명시적으로 해제한다. (기본값으로 켜지 말 것)
 */
export function shouldNoindexExam(
  exam: Pick<Exam, "isSample">,
  env: { NODE_ENV?: string; ALLOW_SAMPLE_INDEXING?: string } = process.env,
): boolean {
  return exam.isSample && env.NODE_ENV === "production" && env.ALLOW_SAMPLE_INDEXING !== "1";
}

/** 자료가 아직 없고 시험일이 오늘 이후면 시행일, 아니면 null */
export function upcomingDate(detail: ExamSubjectDetail | null): string | null {
  if (!detail?.schedule || detail.files.length > 0) return null;
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return detail.schedule.examDate >= today ? detail.schedule.examDate : null;
}

/** 시험 상세 metadata/JSON-LD 옵션을 detail 하나로 만든다 (page · generateMetadata · view 가 공유) */
export function examSeoOptions(detail: ExamSubjectDetail): ExamSeoOptions {
  return {
    upcomingExamDate: upcomingDate(detail),
    course: detail.course,
    features: examSeoFeatures(detail),
  };
}
