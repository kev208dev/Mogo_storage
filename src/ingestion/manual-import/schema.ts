import { z } from "zod";
import { EXAM_TYPES, SUBJECTS, SUBJECT_SEGMENTS, type Subject } from "../../lib/constants";
import { courseByCode } from "../../lib/courses";
import { isHostAllowed } from "../net/url-policy";

/** CSV 헤더 (순서 무관, 이름으로 찾는다) */
export const IMPORT_COLUMNS = [
  "year",
  "grade",
  "month",
  "exam_type",
  "exam_date",
  "organizer",
  "subject",
  "course_code",
  "file_type",
  "official_url",
  "original_file_name",
  "source_label",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_COLUMNS: ImportColumn[] = [
  "year",
  "grade",
  "month",
  "exam_type",
  "subject",
  "file_type",
  "official_url",
  "source_label",
];

/**
 * 공식 자료로 인정하는 도메인. 운영자가 브라우저에서 확인한 URL 이라도 이 목록 밖이면 거부한다
 * (비공식 미러·개인 블로그·클라우드 공유 링크 차단). 서버는 이 URL 에 요청하지 않는다.
 * ".example" = 해당 도메인과 모든 하위 도메인.
 */
export const OFFICIAL_URL_HOSTS = [
  ".ebsi.co.kr",
  ".ebs.co.kr",
  ".suneung.re.kr",
  ".kice.re.kr",
  // 17개 시·도교육청 (공식 도메인)
  ".sen.go.kr",
  ".goe.go.kr",
  ".ice.go.kr",
  ".pen.go.kr",
  ".dge.go.kr",
  ".gen.go.kr",
  ".dje.go.kr",
  ".use.go.kr",
  ".sje.go.kr",
  ".gwe.go.kr",
  ".cbe.go.kr",
  ".cne.go.kr",
  ".jbe.go.kr",
  ".jne.go.kr",
  ".gbe.kr",
  ".gne.go.kr",
  ".jje.go.kr",
];

/** 운영자 입력 가능한 자료 종류 (단어장은 우리가 생성하는 자료라 입력 대상이 아님) */
export const IMPORT_FILE_TYPES = [
  "question",
  "solution",
  "listening_audio",
  "listening_script",
] as const;

const SUBJECT_INPUT = new Map<string, Subject>();
for (const s of SUBJECTS) {
  SUBJECT_INPUT.set(s, s);
  SUBJECT_INPUT.set(SUBJECT_SEGMENTS[s], s); // "second-language" 도 허용
}

const int = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${label}: 숫자가 아닙니다`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label}: ${min}~${max} 범위가 아닙니다`);

export const importRowSchema = z
  .object({
    year: int("year", 2000, 2100),
    grade: int("grade", 1, 3).transform((g) => g as 1 | 2 | 3),
    month: int("month", 1, 12),
    exam_type: z.enum(EXAM_TYPES, { message: `exam_type: ${EXAM_TYPES.join(" | ")}` }),
    exam_date: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "exam_date: YYYY-MM-DD 형식이어야 합니다")
      .transform((v) => v || null),
    organizer: z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || null),
    subject: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const s = SUBJECT_INPUT.get(v);
        if (!s) {
          ctx.addIssue({ code: "custom", message: `subject: 알 수 없는 영역 "${v}"` });
          return z.NEVER;
        }
        return s;
      }),
    course_code: z
      .string()
      .trim()
      .transform((v) => v || null),
    file_type: z.enum(IMPORT_FILE_TYPES, {
      message: `file_type: ${IMPORT_FILE_TYPES.join(" | ")}`,
    }),
    official_url: z
      .string()
      .trim()
      .max(2000, "official_url: 너무 깁니다")
      .transform((v, ctx) => {
        let url: URL;
        try {
          url = new URL(v);
        } catch {
          ctx.addIssue({ code: "custom", message: "official_url: 절대 URL 이 아닙니다" });
          return z.NEVER;
        }
        if (url.protocol !== "https:")
          ctx.addIssue({ code: "custom", message: "official_url: https 만 허용합니다" });
        if (url.username || url.password)
          ctx.addIssue({
            code: "custom",
            message: "official_url: 계정 정보가 든 URL 은 안 됩니다",
          });
        if (!isHostAllowed(url.hostname, OFFICIAL_URL_HOSTS))
          ctx.addIssue({
            code: "custom",
            message: `official_url: 공식 기관 도메인이 아닙니다 (${url.hostname})`,
          });
        if (/\.(zip|7z|egg|alz|rar)$/i.test(url.pathname))
          ctx.addIssue({
            code: "custom",
            message: "official_url: 압축 파일은 받지 않습니다 (PDF/MP3 파일 URL 을 입력)",
          });
        return url.toString();
      }),
    original_file_name: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null),
    source_label: z.string().trim().min(1, "source_label: 비어 있습니다").max(200),
  })
  .superRefine((row, ctx) => {
    // 시험 종류와 학년·월의 일관성 (오타로 다른 시험에 붙는 것을 막는다)
    if (row.exam_type === "csat" && !(row.grade === 3 && (row.month === 11 || (row.year <= 2020 && row.month === 12))))
      ctx.addIssue({
        code: "custom",
        message: "exam_type=csat 은 고3 11월(2020년 이전 카탈로그는 12월)이어야 합니다",
      });
    if (row.exam_type === "kice_mock" && !(row.grade === 3 && (row.month === 6 || row.month === 9)))
      ctx.addIssue({
        code: "custom",
        message: "exam_type=kice_mock 은 grade=3, month=6 또는 9 이어야 합니다",
      });
    if (row.exam_date && row.exam_date.slice(0, 4) !== String(row.year))
      ctx.addIssue({ code: "custom", message: "exam_date 의 연도가 year(시행 연도)와 다릅니다" });
    const legacyCourseCodes = new Set([
      "math-a", "math-b", "agriculture-understanding", "basic-drafting",
      "accounting-principles", "ocean-understanding", "service-industry-understanding",
      "geography-general", "general-social", "life-and-ethics-general", "social-studies",
      "science-studies", "physics-general", "chemistry-general", "life-science-general", "earth-science-general",
      "social-science-studies",
      "korean-a", "korean-b", "morality", "agriculture-bio-industry", "industry", "commerce-information", "fisheries-shipping", "home-economics-industry",
      "english-a", "english-b",
    ]);
    if (row.course_code && !legacyCourseCodes.has(row.course_code)) {
      const course = courseByCode(row.course_code);
      if (!course)
        ctx.addIssue({
          code: "custom",
          message: `course_code: 카탈로그에 없는 code "${row.course_code}"`,
        });
      else if (course.subject !== row.subject)
        ctx.addIssue({
          code: "custom",
          message: `course_code: ${row.course_code} 는 ${row.subject} 영역이 아닙니다`,
        });
    }
    if (row.file_type.startsWith("listening") && row.subject !== "english")
      ctx.addIssue({ code: "custom", message: "listening_* 는 english 에만 있습니다" });
  });

export type ImportRow = z.output<typeof importRowSchema>;
