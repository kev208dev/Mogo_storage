import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExamSubjectView } from "@/components/exam/ExamSubjectView";
import { isCourseCode } from "@/lib/courses";
import { getExam, getExamSubjects, getRepository, getSubjectDetail } from "@/lib/data";
import { buildExamMetadata, upcomingDate } from "@/lib/exam-metadata";
import { gradeSegment, isSubject, monthSegment, parseExamParams } from "@/lib/exam-path";
import { resolveExamKey } from "@/lib/exam-route";

// 세부과목 페이지: /exam/2026/high3/09/social/social-culture
export const revalidate = 3600;

export async function generateStaticParams() {
  const paths = await getRepository().listExamCoursePaths();
  return paths.map(({ exam, course }) => ({
    year: String(exam.year),
    grade: gradeSegment(exam.grade),
    month: monthSegment(exam.month),
    subject: course.subject,
    course: course.code,
  }));
}

type Props = PageProps<"/exam/[year]/[grade]/[month]/[subject]/[course]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  const key = parseExamParams(p);
  if (!key || !isSubject(p.subject) || !isCourseCode(p.course)) return {};
  const exam = await getExam(key.year, key.grade, key.month);
  if (!exam) return {};
  const detail = await getSubjectDetail(key.year, key.grade, key.month, p.subject, p.course);
  if (!detail?.course) return {};
  return buildExamMetadata(exam, await getExamSubjects(exam.id), p.subject, {
    upcomingExamDate: upcomingDate(detail),
    course: detail.course,
  });
}

export default async function ExamCoursePage({ params }: Props) {
  const p = await params;
  if (!isSubject(p.subject) || !isCourseCode(p.course)) notFound();
  const key = resolveExamKey(p);
  const detail = await getSubjectDetail(key.year, key.grade, key.month, p.subject, p.course);
  if (!detail?.course) notFound();
  return <ExamSubjectView detail={detail} />;
}
