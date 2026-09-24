import type { Metadata } from "next";
import { ExamSubjectView } from "@/components/exam/ExamSubjectView";
import { DEFAULT_SUBJECT } from "@/lib/constants";
import { getExam, getExamSubjects, getRepository } from "@/lib/data";
import { buildExamMetadata } from "@/lib/exam-metadata";
import { gradeSegment, monthSegment, parseExamParams } from "@/lib/exam-path";
import { loadSubjectDetail, resolveExamKey } from "@/lib/exam-route";

// 시험 데이터는 변경 빈도가 낮다: 빌드 시 정적 생성 + 1시간 ISR
export const revalidate = 3600;

export async function generateStaticParams() {
  const exams = await getRepository().listExams();
  return exams.map((e) => ({
    year: String(e.year),
    grade: gradeSegment(e.grade),
    month: monthSegment(e.month),
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/exam/[year]/[grade]/[month]">): Promise<Metadata> {
  const key = parseExamParams(await params);
  if (!key) return {};
  const exam = await getExam(key.year, key.grade, key.month);
  if (!exam) return {};
  return buildExamMetadata(exam, await getExamSubjects(exam.id), null);
}

export default async function ExamPage({ params }: PageProps<"/exam/[year]/[grade]/[month]">) {
  const key = resolveExamKey(await params);
  const detail = await loadSubjectDetail(key, DEFAULT_SUBJECT);
  return <ExamSubjectView detail={detail} />;
}
