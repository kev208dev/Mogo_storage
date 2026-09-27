"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import {
  ConceptReviewError,
  renameConcept,
  reviewQuestionConcept,
} from "@/ingestion/concepts/review";
import { requireAdmin } from "@/lib/server/admin-session";

const PAGE = "/admin/concepts";

function formId(form: FormData, key: string): string {
  const value = String(form.get(key) ?? "").trim();
  if (!/^[\w-]{1,100}$/.test(value)) throw new ConceptReviewError("잘못된 식별자입니다.");
  return value;
}

async function withNotice(fn: () => Promise<{ message: string; paths: string[] }>) {
  let message: string;
  try {
    const result = await fn();
    for (const p of result.paths) revalidatePath(p);
    message = result.message;
  } catch (error) {
    if (error instanceof ConceptReviewError) message = error.message;
    else throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent(message)}`);
}

export async function reviewConceptAction(form: FormData) {
  const admin = await requireAdmin();
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  await withNotice(async () => {
    const decision = String(form.get("decision") ?? "");
    if (decision !== "approved" && decision !== "rejected")
      throw new ConceptReviewError("잘못된 요청입니다.");
    const paths = await reviewQuestionConcept(db, {
      questionId: formId(form, "questionId"),
      conceptId: formId(form, "conceptId"),
      decision,
      reviewer: admin,
    });
    return { message: decision === "approved" ? "승인했습니다." : "거절했습니다.", paths };
  });
}

export async function renameConceptAction(form: FormData) {
  await requireAdmin();
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  await withNotice(async () => {
    const paths = await renameConcept(
      db,
      formId(form, "conceptId"),
      String(form.get("name") ?? "").slice(0, 200),
    );
    return { message: "개념 이름을 수정했습니다.", paths };
  });
}
