import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { sourceArtifacts } from "@/db/schema";
import { upsertReviewNote, type ReviewEvidence, type ReviewReasonCode } from "./evidence";
import { OPERATOR_IMPORT_SOURCE_ID } from "./source";

/**
 * 근거 파일 → 운영자 입력 artifact 에 근거·보류 사유를 붙인다 (상태는 바꾸지 않는다).
 * 지원 형식:
 *   1) import:candidates 의 <out>.evidence.json / .held.json : [{ url, evidence, reasonCode?, reason? }]
 *   2) 브라우저 검증 기록 data/imports/verification/<연도>.json : { records: [...] }
 */
export interface EvidenceEntry {
  url: string;
  reasonCode?: ReviewReasonCode | null;
  reason?: string | null;
  evidence: ReviewEvidence[];
}

function inferReasonCode(reason: string | undefined | null): ReviewReasonCode | null {
  if (!reason) return null;
  if (/시행 연도·월·학년|시험의 시행/.test(reason)) return "no_exam_identity";
  if (/과목 불일치|탐구 영역\(과학\)/.test(reason)) return "subject_mismatch";
  if (/월 미확인/.test(reason)) return "exam_month_unconfirmed";
  if (/서로 다른 파일/.test(reason)) return "slot_conflict";
  if (/변형/.test(reason)) return "ambiguous_variant";
  return "other";
}

interface VerificationRecord {
  url: string;
  result?: string;
  reason?: string;
  browser?: {
    status?: number;
    contentType?: string;
    bytes?: number;
    pdfPages?: number;
    checkedAt?: string;
  };
  evidence?: {
    method?: string;
    page1Header?: string;
    examLineInDocument?: string | null;
    visual?: string | null;
  };
  recheck?: { checkedAt?: string; method?: string; result?: string; reason?: string };
}

export function parseEvidenceFile(data: unknown): EvidenceEntry[] {
  if (Array.isArray(data)) {
    return data
      .filter((e): e is EvidenceEntry => typeof e?.url === "string")
      .map((e) => ({
        url: e.url,
        reasonCode: e.reasonCode ?? null,
        reason: e.reason ?? null,
        evidence: Array.isArray(e.evidence) ? e.evidence : [],
      }));
  }
  const records = (data as { records?: VerificationRecord[] })?.records;
  if (!Array.isArray(records)) throw new Error("알 수 없는 근거 파일 형식");
  return records
    .filter((r) => typeof r.url === "string")
    .map((r) => {
      const evidence: ReviewEvidence[] = [];
      if (r.browser?.status !== undefined)
        evidence.push({
          kind: "browser_check",
          status: r.browser.status,
          contentType: r.browser.contentType ?? "",
          bytes: r.browser.bytes,
          pdfPages: r.browser.pdfPages,
          checkedAt: r.browser.checkedAt ?? "",
        });
      if (r.evidence?.page1Header)
        evidence.push({ kind: "page1_header", text: r.evidence.page1Header.slice(0, 200) });
      if (r.evidence && "examLineInDocument" in r.evidence)
        evidence.push({ kind: "exam_line", text: r.evidence.examLineInDocument ?? null });
      if (r.evidence?.visual) evidence.push({ kind: "visual_check", note: r.evidence.visual });
      if (r.recheck?.reason)
        evidence.push({
          kind: "visual_check",
          note: `재확인(${r.recheck.method ?? ""}, ${r.recheck.checkedAt?.slice(0, 10) ?? ""}): ${r.recheck.reason}`,
        });
      const held = r.result && r.result !== "approved";
      const reason = held ? (r.recheck?.reason ?? r.reason ?? null) : null;
      return { url: r.url, reasonCode: held ? inferReasonCode(r.reason) : null, reason, evidence };
    });
}

export async function attachEvidence(
  db: Database,
  entries: EvidenceEntry[],
  admin: string,
  now = new Date(),
): Promise<{ attached: number; unmatched: string[] }> {
  if (entries.length === 0) return { attached: 0, unmatched: [] };
  const artifacts = await db
    .select({ id: sourceArtifacts.id, url: sourceArtifacts.sourceUrl })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
        inArray(
          sourceArtifacts.sourceUrl,
          entries.map((e) => e.url),
        ),
      ),
    );
  const byUrl = new Map<string, string[]>();
  for (const a of artifacts) byUrl.set(a.url, [...(byUrl.get(a.url) ?? []), a.id]);
  let attached = 0;
  const unmatched: string[] = [];
  for (const e of entries) {
    const ids = byUrl.get(e.url);
    if (!ids) {
      unmatched.push(e.url);
      continue;
    }
    for (const artifactId of ids) {
      await upsertReviewNote(db, {
        artifactId,
        reasonCode: e.reasonCode ?? null,
        reason: e.reason ?? null,
        evidence: e.evidence,
        updatedBy: admin,
        now,
      });
      attached += 1;
    }
  }
  return { attached, unmatched };
}
