import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ExamSubjectView } from "@/components/exam/ExamSubjectView";
import { DEFAULT_SUBJECT, SUBJECTS } from "@/lib/constants";
import { getExam, getExamSubjects, getRepository, getSubjectDetail } from "@/lib/data";
import { buildExamMetadata, upcomingDate } from "@/lib/exam-metadata";
import { examPath, gradeSegment, isSubject, monthSegment, parseExamParams } from "@/lib/exam-path";
import { loadSubjectDetail, resolveExamKey } from "@/lib/exam-route";

export const revalidate = 3600;

export async function generateStaticParams() {
  const exams = await getRepository().listExams();
  return exams.flatMap((e) =>
    SUBJECTS.filter((s) => s !== DEFAULT_SUBJECT).map((subject) => ({
      year: String(e.year),
      grade: gradeSegment(e.grade),
      month: monthSegment(e.month),
      subject,
    })),
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/exam/[year]/[grade]/[month]/[subject]">): Promise<Metadata> {
  const p = await params;
  const key = parseExamParams(p);
  if (!key || !isSubject(p.subject)) return {};
  const exam = await getExam(key.year, key.grade, key.month);
  if (!exam) return {};
  const detail = await getSubjectDetail(key.year, key.grade, key.month, p.subject);
  return buildExamMetadata(exam, await getExamSubjects(exam.id), p.subject, {
    upcomingExamDate: upcomingDate(detail),
  });
}

export default async function ExamSubjectPage({
  params,
}: PageProps<"/exam/[year]/[grade]/[month]/[subject]">) {
  const p = await params;
  if (!isSubject(p.subject)) notFound();
  const key = resolveExamKey(p, p.subject);
  // 기본 과목은 /exam/.../09 가 canonical
  if (p.subject === DEFAULT_SUBJECT) permanentRedirect(examPath(key));
  const detail = await loadSubjectDetail(key, p.subject);
  return <ExamSubjectView detail={detail} />;
}
