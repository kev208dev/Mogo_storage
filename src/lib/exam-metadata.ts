import type { Metadata } from "next";
import { SITE_NAME, SUBJECTS, SUBJECT_LABELS, type Subject } from "./constants";
import { courseSeoName, SUBJECT_AREA_LABELS } from "./courses";
import type { Course, Exam, ExamSubject, ExamSubjectDetail } from "./data/types";
import { examCoursePath, examPath, examTitle } from "./exam-path";

export function buildExamMetadata(
  exam: Exam,
  subjects: ExamSubject[],
  subject: Subject | null,
  options: { upcomingExamDate?: string | null; course?: Course | null } = {},
): Metadata {
  const baseTitle = examTitle(exam);
  const available = SUBJECTS.filter((s) => subjects.some((x) => x.subject === s));
  const subjectList = available.map((s) => SUBJECT_LABELS[s]).join(", ");

  const course = options.course ?? null;
  const title = course
    ? `${baseTitle} ${courseSeoName(course.name)} 문제·정답·해설 PDF`
    : subject
      ? `${baseTitle} ${SUBJECT_AREA_LABELS[subject] ?? SUBJECT_LABELS[subject]}`
      : baseTitle;
  const upcoming = options.upcomingExamDate
    ? `${baseTitle} 시행일은 ${options.upcomingExamDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}년 ${Number(m)}월 ${Number(d)}일`)}입니다. 시험 종료 후 문제지와 정답·해설이 공개되면 바로 다운로드할 수 있습니다.`
    : null;
  const description = upcoming
    ? upcoming
    : course
      ? `${baseTitle} ${SUBJECT_AREA_LABELS[course.subject] ?? SUBJECT_LABELS[course.subject]} ${course.name} 문제지와 정답·해설 PDF를 바로 다운로드하세요. 정답 확인과 자동 채점, 과목별 등급컷도 제공합니다.`
      : subject
        ? `${baseTitle} ${SUBJECT_LABELS[subject]} 문제지와 정답·해설 PDF를 빠르게 확인하고 다운로드하세요.${
            subject === "english" ? " 듣기 MP3, 지문별 단어장, 받아쓰기도 제공합니다." : ""
          } 정답 바로 보기와 자동 채점, 등급컷도 확인할 수 있습니다.`
        : `${baseTitle} ${subjectList} 문제지와 정답·해설 PDF를 빠르게 확인하고 다운로드하세요.`;
  const path = course
    ? examCoursePath(exam, course.subject, course.code)
    : examPath(exam, subject ?? undefined);

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
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
