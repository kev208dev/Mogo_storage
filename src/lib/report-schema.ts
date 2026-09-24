import { z } from "zod";
import { REPORT_CATEGORIES, SUBJECTS } from "./constants";

export const REPORT_MESSAGE_MAX = 1000;

/** 오류 신고 요청 body (클라이언트/서버 공용) */
export const reportInputSchema = z.object({
  examId: z.string().trim().min(1).max(100),
  fileId: z.string().trim().min(1).max(100).nullish(),
  subject: z.enum(SUBJECTS).nullish(),
  category: z.enum(REPORT_CATEGORIES),
  message: z
    .string()
    .trim()
    .max(REPORT_MESSAGE_MAX, `설명은 ${REPORT_MESSAGE_MAX}자 이하로 입력해 주세요.`)
    .nullish()
    .transform((v) => (v ? v : null)),
  /** honeypot: 사람은 비워두는 숨은 필드. 값이 있으면 봇으로 간주한다. */
  website: z.string().max(200).optional(),
});

export type ReportInput = z.input<typeof reportInputSchema>;
