"use client";
import { useState, useTransition } from "react";
import { importOfficialUrlsAction } from "@/app/admin/actions";
import { previewOfficialCsv } from "@/app/admin/(console)/imports/preview";
import type { AdminExamFilter } from "@/lib/admin-exam-filter";

export function OfficialCsvForm({ header, filter }: { header: string; filter: AdminExamFilter }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof previewOfficialCsv>> | null>(null);
  const [busy, startTransition] = useTransition();
  const [checked, setChecked] = useState("");
  const [fileError, setFileError] = useState("");
  const valid =
    result &&
    !result.error &&
    result.rows.length > 0 &&
    result.rows.some((r) => r.status !== "invalid") &&
    checked === csv;
  const template = `${header}\n`;
  return (
    <form action={importOfficialUrlsAction} className="space-y-3 text-sm">
      <p>기존 등록 규칙으로 검사합니다. DB 저장이나 원문 URL 요청은 하지 않습니다.</p>
      <a
        className="text-primary underline"
        download="official-urls.template.csv"
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
      >
        CSV 템플릿 다운로드
      </a>
      <button
        type="button"
        className="border-border ml-3 rounded border p-2"
        onClick={() => {
          setCsv(
            `${header}\n${filter.year ?? 2026},${filter.grade ?? ""},${filter.month ?? 10},school_mock,${filter.year === 2026 && filter.month === 10 ? "2026-10-20" : ""},,,,,,,`,
          );
          setResult(null);
        }}
      >
        선택 시험으로 빈 행 작성
      </button>
      <p className="text-muted-foreground text-xs">
        시험 정보는 입력 보조입니다. 날짜·학년·과목·원문 URL을 확인해 채우세요. 기존 입력은 빈
        행으로 교체됩니다.
      </p>
      <label className="block">
        CSV 파일
        <input
          type="file"
          accept=".csv,text/csv"
          className="block"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setResult(null);
            setFileError("");
            if (!file) return;
            if (file.size > 2_000_000) {
              setFileError("CSV 는 2MB 이하로 입력하세요");
              return;
            }
            try {
              setCsv(await file.text());
            } catch {
              setFileError("파일을 읽지 못했습니다");
            }
          }}
        />
      </label>
      <label className="block">
        또는 붙여넣기
        <textarea
          name="csv"
          rows={8}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
          }}
          className="border-border block w-full rounded border p-2 font-mono text-xs"
          placeholder={header}
        />
      </label>
      {fileError ? <p role="alert">{fileError}</p> : null}
      <button
        type="button"
        disabled={busy || !csv}
        className="bg-muted min-h-11 rounded px-3"
        onClick={() => {
          const input = csv;
          startTransition(async () => {
            const next = await previewOfficialCsv(input);
            setResult(next);
            setChecked(input);
          });
        }}
      >
        {busy ? "검사 중…" : "저장 전 검사"}
      </button>
      <div aria-live="polite">
        {result ? (
          <>
            <p>
              {result.error ||
                `검사 ${result.rows.length}행 · 오류 ${result.rows.filter((r) => r.status === "invalid").length}행`}
            </p>
            <p className="text-muted-foreground text-xs">
              검사는 형식·CSV 내부 슬롯 충돌만 확인합니다. DB 기존 URL과의 중복·충돌은 등록 결과와
              검토 목록에서 확인하세요.
            </p>
            <ul className="max-h-60 overflow-auto">
              {result.rows.map((r) => (
                <li key={r.line}>
                  {r.line}행 ·{" "}
                  {r.status === "invalid"
                    ? r.errors?.join("; ")
                    : "형식 통과 (동일 슬롯·동일 URL은 중복 등록 안 됨)"}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <button
        disabled={!valid || busy}
        className="bg-primary text-primary-foreground min-h-11 rounded px-3 disabled:opacity-50"
      >
        입력
      </button>
      <p className="text-muted-foreground text-xs">
        오류 행은 저장되지 않으며 정상 행만 등록됩니다. 등록 후에도 검토 대기입니다. 브라우저 확인과
        별도 승인 없이는 게시되지 않습니다.
      </p>
    </form>
  );
}
