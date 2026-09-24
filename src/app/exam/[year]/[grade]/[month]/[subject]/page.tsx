import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ExamSubjectView } from "@/components/exam/ExamSubjectView";
import { DEFAULT_SUBJECT } from "@/lib/constants";
import { getExam, getExamSubjects, getRepository, getSubjectDetail } from "@/lib/data";
import { buildExamMetadata, upcomingDate } from "@/lib/exam-metadata";
import {
  examPath,
  gradeSegment,
  monthSegment,
  parseExamParams,
  parseSubjectSegment,
  subjectSegment,
} from "@/lib/exam-path";
import { loadSubjectDetail, resolveExamKey } from "@/lib/exam-route";

export const revalidate = 3600;

export async function generateStaticParams() {
  const repo = getRepository();
  const [exams, allSubjects] = await Promise.all([repo.listExams(), repo.listAllExamSubjects()]);
  const params = [];
  // 시험에 실제로 있는 영역만 (직업탐구·제2외국어는 해당 시험에만)
  for (const e of exams) {
    for (const { subject } of allSubjects.filter((x) => x.examId === e.id)) {
      if (subject === DEFAULT_SUBJECT) continue;
      params.push({
        year: String(e.year),
        grade: gradeSegment(e.grade),
        month: monthSegment(e.month),
        subject: subjectSegment(subject),
      });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: PageProps<"/exam/[year]/[grade]/[month]/[subject]">): Promise<Metadata> {
  const p = await params;
  const key = parseExamParams(p);
  const subject = parseSubjectSegment(p.subject);
  if (!key || !subject) return {};
  const exam = await getExam(key.year, key.grade, key.month);
  if (!exam) return {};
  const detail = await getSubjectDetail(key.year, key.grade, key.month, subject);
  return buildExamMetadata(exam, await getExamSubjects(exam.id), subject, {
    upcomingExamDate: upcomingDate(detail),
  });
}

export default async function ExamSubjectPage({
  params,
}: PageProps<"/exam/[year]/[grade]/[month]/[subject]">) {
  const p = await params;
  const subject = parseSubjectSegment(p.subject);
  if (!subject) notFound();
  const key = resolveExamKey(p, subject);
  // 기본 과목은 /exam/.../09 가 canonical
  if (subject === DEFAULT_SUBJECT) permanentRedirect(examPath(key));
  const detail = await loadSubjectDetail(key, subject);
  return <ExamSubjectView detail={detail} />;
}
