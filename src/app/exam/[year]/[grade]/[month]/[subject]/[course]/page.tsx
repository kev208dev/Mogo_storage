import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ExamSubjectView } from "@/components/exam/ExamSubjectView";
import { isCourseCode } from "@/lib/courses";
import { getExam, getExamSubjects, getSubjectDetail } from "@/lib/data";
import { buildExamMetadata, upcomingDate } from "@/lib/exam-metadata";
import {
  gradeSegment,
  legacySubjectSegmentRedirect,
  monthSegment,
  parseExamParams,
  parseSubjectSegment,
  subjectSegment,
} from "@/lib/exam-path";
import { resolveExamKey } from "@/lib/exam-route";

// 세부과목 페이지: /exam/2026/high3/09/social/social-culture
// 전체 세부과목을 빌드 시 미리 생성하면 수천 페이지가 되어 Vercel build timeout을 초과한다.
// 빈 static params + ISR로 요청된 경로만 최초 접근 시 생성하고 이후 1시간 재사용한다.
export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = PageProps<"/exam/[year]/[grade]/[month]/[subject]/[course]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  const key = parseExamParams(p);
  const subject = parseSubjectSegment(p.subject);
  if (!key || !subject || !isCourseCode(p.course)) return {};
  const exam = await getExam(key.year, key.grade, key.month);
  if (!exam) return {};
  const detail = await getSubjectDetail(key.year, key.grade, key.month, subject, p.course);
  if (!detail?.course) return {};
  return buildExamMetadata(exam, await getExamSubjects(exam.id), subject, {
    upcomingExamDate: upcomingDate(detail),
    course: detail.course,
  });
}

export default async function ExamCoursePage({ params }: Props) {
  const p = await params;
  const legacy = legacySubjectSegmentRedirect(p.subject);
  // DB enum 표기(second_language)는 URL 이 아니다 → /second-language/<course> 로 영구 이동
  if (legacy && isCourseCode(p.course))
    permanentRedirect(`/exam/${p.year}/${p.grade}/${p.month}/${legacy}/${p.course}`);
  const subject = parseSubjectSegment(p.subject);
  if (!subject || !isCourseCode(p.course)) notFound();
  const key = resolveExamKey(p);
  const detail = await getSubjectDetail(key.year, key.grade, key.month, subject, p.course);
  if (!detail?.course) notFound();
  return <ExamSubjectView detail={detail} />;
}
