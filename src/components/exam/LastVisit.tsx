"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readJson, writeJson } from "./grader-storage";

/** 마지막으로 본 시험 페이지 (이 기기에만 저장 · 개인정보 없음) */
const KEY = "mogo:last-visit";
interface Visit {
  path: string;
  title: string;
  at: string;
}

export function RecordVisit({ path, title }: { path: string; title: string }) {
  useEffect(() => {
    writeJson(KEY, { path, title, at: new Date().toISOString() } satisfies Visit);
  }, [path, title]);
  return null;
}

export function ContinueStudy() {
  const [visit, setVisit] = useState<Visit | null>(null);
  useEffect(() => {
    const v = readJson<Visit>(KEY);
    // 같은 사이트 경로만 (저장값이 조작돼도 외부로 보내지 않는다)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    if (v && typeof v.path === "string" && v.path.startsWith("/exam/")) setVisit(v);
  }, []);
  if (!visit) return null;
  return (
    <p className="mt-3 text-sm" data-testid="continue-study">
      <span className="text-muted-foreground">이어서 보기: </span>
      <Link href={visit.path} className="font-semibold underline">
        {visit.title}
      </Link>
    </p>
  );
}
