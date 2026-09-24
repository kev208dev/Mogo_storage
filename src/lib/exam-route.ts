import "server-only";
import { notFound, permanentRedirect } from "next/navigation";
import { DEFAULT_SUBJECT, type Subject } from "./constants";
import { getSubjectDetail } from "./data";
import { examPath, monthSegment, parseExamParams, type ExamKey } from "./exam-path";

/** URL params → ExamKey. 잘못된 형식이면 404, "9"처럼 canonical이 아니면 "09"로 redirect. */
export function resolveExamKey(
  params: { year: string; grade: string; month: string },
  subject?: Subject,
): ExamKey {
  const key = parseExamParams(params);
  if (!key) notFound();
  if (params.month !== monthSegment(key.month)) permanentRedirect(examPath(key, subject));
  return key;
}

export async function loadSubjectDetail(key: ExamKey, subject: Subject = DEFAULT_SUBJECT) {
  const detail = await getSubjectDetail(key.year, key.grade, key.month, subject);
  if (!detail) notFound();
  return detail;
}
