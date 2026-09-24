import type { FileType, Subject } from "../../lib/constants";
import { COURSE_BASED_SUBJECTS, courseByCode } from "../../lib/courses";
import type { DiscoveredArtifact } from "../types";
import { normalizeArtifactType } from "./artifact-type";
import { resolveCourse, type CourseResolution } from "./course";
import { normalizeSubject } from "./subject";

/** 선택과목이 존재할 수 있는 영역 (국어/수학 선택, 탐구) */
const SUBJECTS_WITH_COURSES: Subject[] = [
  "korean",
  "math",
  "social",
  "science",
  "vocational",
  "second_language",
];

export interface ClassifyInput {
  /** 영역/과목 블록 표기 (예: "사회탐구", "국어") — 없으면 null */
  subjectLabel: string | null;
  /** 링크/파일 표기 (예: "한국지리 문제", "사회탐구영역_생활과윤리_문제지.pdf") */
  linkLabel: string;
  url: string;
  publishedAt?: string | null;
}

export type ClassifyResult =
  | { ok: true; artifact: DiscoveredArtifact }
  | { ok: false; reason: "unsupported_subject" | "unknown_type"; label: string };

function isArchive(url: string, label: string): boolean {
  return /\.(zip|7z|egg|alz)(?:$|[?#])/i.test(url) || /압축|\bzip\b/i.test(label);
}

/**
 * source 표기 → 영역 / 세부과목 / 자료 종류.
 * 모든 parser 가 같은 규칙을 쓰도록 한 곳에 둔다. course 는 코드 카탈로그 기준으로만 판정하며
 * (관리자 alias 는 pipeline 에서 DB alias 로 다시 판정) 모호하면 ambiguous 로 남긴다.
 */
export function classifyArtifact(input: ClassifyInput): ClassifyResult {
  const { subjectLabel, linkLabel, url } = input;
  const combined = `${subjectLabel ?? ""} ${linkLabel}`.trim();
  const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");

  let course: CourseResolution = resolveCourse(combined);
  let subject: Subject | null = normalizeSubject(subjectLabel ?? "") ?? normalizeSubject(linkLabel);
  if (!subject && course.status === "resolved")
    subject = courseByCode(course.code)?.subject ?? null;
  if (!subject) {
    // 영역 표기가 없고 과목명이 모호한 경우 (예: "윤리 문제") — 후보가 모두 같은 영역이면 그 영역
    if (course.status === "ambiguous") {
      const subjects = new Set(course.candidates.map((c) => courseByCode(c)?.subject));
      if (subjects.size === 1) subject = [...subjects][0] ?? null;
    }
  }
  if (!subject) return { ok: false, reason: "unsupported_subject", label: combined };

  const type: FileType | null =
    normalizeArtifactType(linkLabel) ??
    normalizeArtifactType(fileName) ??
    normalizeArtifactType(url);
  if (!type) return { ok: false, reason: "unknown_type", label: combined };

  if (SUBJECTS_WITH_COURSES.includes(subject)) {
    course = resolveCourse(combined, { subject });
  } else {
    course = { status: "none" };
  }
  const archive = isArchive(url, linkLabel);
  return {
    ok: true,
    artifact: {
      subject,
      type,
      url,
      label: linkLabel,
      fileNameHint: fileName || linkLabel || null,
      publishedAt: input.publishedAt ?? null,
      course,
      courseLabel: course.status === "none" ? null : linkLabel,
      containerType: archive ? "archive" : "file",
      containsMultipleCourses:
        archive && course.status !== "resolved" && COURSE_BASED_SUBJECTS.includes(subject),
      sourceSubjectLabel: subjectLabel?.trim() || null,
      sourceLabel: combined,
    },
  };
}
