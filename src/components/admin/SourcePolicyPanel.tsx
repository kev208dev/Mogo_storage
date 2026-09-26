import type { Database } from "@/db/client";
import { loadSources } from "@/ingestion/pipeline/sources";
import {
  FEATURE_LABELS,
  SOURCE_FEATURES,
  sourceStatusMatrix,
  type FeatureStatus,
} from "@/ingestion/sources/policy";
import { cn } from "@/lib/utils";
import { Panel } from "./ui";

const STATUS: Record<FeatureStatus, { label: string; className: string }> = {
  automated_verified: { label: "자동", className: "bg-success-soft text-success-strong" },
  degraded: { label: "장애", className: "bg-danger-soft text-danger-strong" },
  disabled_unverified: { label: "미검증", className: "bg-warning-soft text-warning-strong" },
  disabled_policy: { label: "정책상 금지", className: "bg-muted text-muted-foreground" },
  manual_only: { label: "수동", className: "bg-primary/10 text-primary" },
  not_applicable: { label: "-", className: "text-muted-foreground" },
};

/** source × 기능 자동화 범위. 정책상 금지(robots·anti-bot)는 코드로 막혀 있어 켤 수 없다 */
export async function SourcePolicyPanel({ db }: { db: Database }) {
  const rows = sourceStatusMatrix(await loadSources(db));
  return (
    <Panel title="Source 자동화 범위">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm" data-testid="source-policy">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="py-1">source</th>
              {SOURCE_FEATURES.map((f) => (
                <th key={f}>{FEATURE_LABELS[f]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => (
              <tr key={r.source} className="align-top">
                <td className="py-1.5">
                  <span className="font-semibold">{r.name}</span>
                  {r.notes.length ? (
                    <ul className="text-muted-foreground mt-0.5 text-xs">
                      {r.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                {SOURCE_FEATURES.map((f) => {
                  const s = STATUS[r.features[f]];
                  return (
                    <td key={f} className="py-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", s.className)}>
                        {s.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        근거: docs/SOURCE_SURVEY.md · 새 공개 source 추가: docs/ADDING_SOURCE.md
      </p>
    </Panel>
  );
}
