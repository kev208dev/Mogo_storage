import { checkProductionEnv } from "@/lib/server/env";
import { Panel } from "./ui";

/**
 * 운영 설정 상태 (값은 절대 표시하지 않는다 — 설정 여부와 검증 메시지만).
 * 생성 학습지(PDF)는 스토리지에 저장해야 하므로 STORAGE_DRIVER=mock 이면 운영에서 게시할 수 없다.
 */
export function ConfigPanel() {
  const driver = process.env.STORAGE_DRIVER ?? "mock";
  const { errors, warnings } = checkProductionEnv();
  const storageMessages = [...errors, ...warnings].filter((m) => /STORAGE|R2/.test(m));
  return (
    <Panel title="운영 설정">
      <dl
        className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4"
        data-testid="config-panel"
      >
        <dt className="text-muted-foreground">스토리지</dt>
        <dd className="font-semibold">{driver}</dd>
        <dt className="text-muted-foreground">생성 학습지 저장</dt>
        <dd className="font-semibold">{driver === "r2" ? "가능" : "불가 (mock)"}</dd>
        <dt className="text-muted-foreground">설정 오류</dt>
        <dd className="font-semibold tabular-nums">{errors.length}</dd>
        <dt className="text-muted-foreground">설정 경고</dt>
        <dd className="font-semibold tabular-nums">{warnings.length}</dd>
      </dl>
      {storageMessages.length ? (
        <ul className="text-warning-strong mt-2 list-disc pl-5 text-xs">
          {storageMessages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
