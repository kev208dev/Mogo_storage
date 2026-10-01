"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IngestionError } from "@/ingestion/errors";
import {
  enqueueStudyMaterials,
  reviewStudyMaterial,
  type StudyReviewAction,
} from "@/ingestion/study/materials";
import { requireAdmin } from "@/lib/server/admin-session";
import { createAppIngestionContext } from "@/lib/server/ingestion-context";

const PAGE = "/admin/study";
const ACTIONS: StudyReviewAction[] = ["start_review", "approve", "publish", "reject"];

function formId(form: FormData, key: string): string {
  const value = String(form.get(key) ?? "").trim();
  if (!/^[\w-]{1,100}$/.test(value)) throw new IngestionError("INVALID_ID", "잘못된 식별자입니다.");
  return value;
}

async function withNotice(fn: () => Promise<string>) {
  let message: string;
  try {
    message = await fn();
  } catch (error) {
    if (error instanceof IngestionError) message = error.message;
    else throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent(message)}`);
}

/** 학습 자료 검토: 검토 시작 · 승인 · 게시 · 반려 (게시는 승인된 자료만) */
export async function reviewStudyMaterialAction(form: FormData) {
  const admin = await requireAdmin();
  const ctx = createAppIngestionContext();
  if (!ctx) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  await withNotice(async () => {
    const action = String(form.get("action") ?? "") as StudyReviewAction;
    if (!ACTIONS.includes(action)) throw new IngestionError("INVALID_ACTION", "잘못된 요청입니다.");
    const note = String(form.get("note") ?? "").slice(0, 300) || null;
    const id = formId(form, "id");
    const { from, to } = await reviewStudyMaterial(ctx, { id, action, admin, note });
    console.info(
      JSON.stringify({ event: "admin.action", admin, action: `study.${action}`, target: id }),
    );
    return `${from} → ${to}`;
  });
}

/** 시험의 학습지 생성 예약 (입력이 바뀐 것만 다시 만든다) */
export async function regenerateStudyMaterialsAction(form: FormData) {
  const admin = await requireAdmin();
  const ctx = createAppIngestionContext();
  if (!ctx) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  await withNotice(async () => {
    const examId = formId(form, "examId");
    await enqueueStudyMaterials(ctx, examId);
    console.info(
      JSON.stringify({ event: "admin.action", admin, action: "study.regenerate", target: examId }),
    );
    return "학습지 생성 작업을 예약했습니다 (jobs worker 가 처리).";
  });
}
