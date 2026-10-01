"use client";

import { PlayIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { readJson, writeJson } from "@/components/exam/grader-storage";
import type { ListeningTrack } from "@/lib/data/types";
import { createDictationTokens, isDictationMatch, type DictationLevel } from "@/lib/dictation";
import { listeningMode, transcriptTracks } from "@/lib/listening";
import { cn } from "@/lib/utils";
import { DICTATION_SELECT_EVENT, playListeningTrack } from "./events";

const LEVELS: Array<{ value: DictationLevel; label: string; hint: string }> = [
  { value: "easy", label: "쉬움", hint: "핵심 단어 빈칸" },
  { value: "medium", label: "보통", hint: "여러 단어 빈칸" },
  { value: "hard", label: "어려움", hint: "문장 전체 입력" },
];

/** 문항별 받아쓰기 기록 (이 기기에만 저장) */
type DictationProgress = Record<
  string,
  { level: DictationLevel; correct: number; total: number; at: string }
>;
const progressKey = (examId: string) => `mogo:dictation:${examId}`;

export function DictationPractice({
  examId,
  tracks,
}: {
  examId: string;
  tracks: ListeningTrack[];
}) {
  // 공개 가능한 대본이 있는 문항만 (문항 구간 검증 여부와는 무관)
  const available = useMemo(() => transcriptTracks(tracks), [tracks]);
  const segmentMode = listeningMode(tracks) === "segments";
  const [progress, setProgress] = useState<DictationProgress>({});
  const [ready, setReady] = useState(false);
  const [questionNumber, setQuestionNumber] = useState(available[0]?.questionNumber ?? 1);
  const [level, setLevel] = useState<DictationLevel>("easy");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const track = available.find((t) => t.questionNumber === questionNumber) ?? available[0];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 저장소 동기화
    setProgress(readJson<DictationProgress>(progressKey(examId)) ?? {});
    setReady(true);
  }, [examId]);

  useEffect(() => {
    const onSelect = (e: Event) => {
      setQuestionNumber((e as CustomEvent<number>).detail);
      setInputs({});
      setChecked(false);
      const section = document.getElementById("dictation");
      section?.scrollIntoView({ block: "start" });
      requestAnimationFrame(() =>
        rootRef.current?.querySelector<HTMLInputElement>("input[type=text]")?.focus({
          preventScroll: true,
        }),
      );
    };
    window.addEventListener(DICTATION_SELECT_EVENT, onSelect);
    return () => window.removeEventListener(DICTATION_SELECT_EVENT, onSelect);
  }, []);

  if (!track?.transcript) {
    return <p className="text-muted-foreground text-sm">받아쓰기 대본 준비 중입니다.</p>;
  }

  const lines = track.transcript.map((line) => ({
    ...line,
    tokens: createDictationTokens(line.text, level),
  }));
  const blanks = lines.flatMap((line, li) =>
    level === "hard"
      ? [{ key: `${li}`, answer: line.text }]
      : line.tokens.flatMap((t, ti) =>
          t.answer ? [{ key: `${li}-${ti}`, answer: t.answer }] : [],
        ),
  );
  const correctCount = blanks.filter((b) => isDictationMatch(b.answer, inputs[b.key] ?? "")).length;
  const done = Object.keys(progress).length;

  function check() {
    setChecked(true);
    if (track?.questionNumber == null) return;
    const next = {
      ...progress,
      [String(track.questionNumber)]: {
        level,
        correct: correctCount,
        total: blanks.length,
        at: new Date().toISOString(),
      },
    };
    setProgress(next);
    writeJson(progressKey(examId), next);
  }

  function reset(nextLevel = level, nextQuestion = questionNumber) {
    setLevel(nextLevel);
    setQuestionNumber(nextQuestion);
    setInputs({});
    setChecked(false);
  }

  const fieldClass = (key: string, answer: string) =>
    cn(
      "rounded-md border px-2 text-base outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
      checked &&
        (isDictationMatch(answer, inputs[key] ?? "")
          ? "border-success-strong bg-success-soft"
          : "border-danger-strong bg-danger-soft"),
      !checked && "border-border",
    );

  return (
    <div
      ref={rootRef}
      className="space-y-4"
      data-testid="dictation"
      data-ready={ready ? "" : undefined}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <label htmlFor={`${uid}-q`} className="mb-1 block text-sm font-semibold">
            문항
          </label>
          <NativeSelect
            id={`${uid}-q`}
            value={track.questionNumber ?? undefined}
            onChange={(e) => reset(level, Number(e.target.value))}
          >
            {available.map((t) => {
              const p = progress[String(t.questionNumber)];
              return (
                <option key={t.id} value={t.questionNumber ?? ""}>
                  {t.label}
                  {p ? ` ✓ ${p.correct}/${p.total}` : ""}
                </option>
              );
            })}
          </NativeSelect>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">난이도</legend>
          <div className="flex gap-1.5">
            {LEVELS.map((l) => (
              <label key={l.value} title={l.hint}>
                <input
                  type="radio"
                  name={`${uid}-level`}
                  className="peer sr-only"
                  checked={level === l.value}
                  onChange={() => reset(l.value)}
                  aria-label={`${l.label}: ${l.hint}`}
                />
                <span className="border-border peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/60 flex h-12 cursor-pointer items-center rounded-md border px-3 text-sm font-semibold peer-focus-visible:ring-[3px]">
                  {l.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          variant="outline"
          size="lg"
          onClick={() => playListeningTrack(track.questionNumber)}
          aria-label={segmentMode ? `${track.label} 듣기` : "듣기 음원 재생 (전체 음원)"}
        >
          <PlayIcon aria-hidden />
          {segmentMode ? "듣기" : "음원 재생"}
        </Button>
      </div>
      <p
        className="text-muted-foreground text-xs"
        aria-live="polite"
        data-testid="dictation-progress"
      >
        {available.length}문항 중 {done}문항 완료 · 기록은 이 기기에만 저장됩니다.
        {segmentMode
          ? ""
          : " 문항별 구간이 확인되지 않아 전체 음원에서 해당 문항을 찾아 들어 주세요."}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        className="space-y-3"
        lang="en"
      >
        {lines.map((line, li) => (
          <div key={li} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2 leading-loose">
            {line.speaker ? <strong className="mr-1">{line.speaker}:</strong> : null}
            {level === "hard" ? (
              <div className="w-full">
                <input
                  type="text"
                  value={inputs[`${li}`] ?? ""}
                  onChange={(e) => setInputs((p) => ({ ...p, [`${li}`]: e.target.value }))}
                  aria-label={`${li + 1}번째 문장 전체 입력`}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={cn("h-11 w-full", fieldClass(`${li}`, line.text))}
                />
                {checked && !isDictationMatch(line.text, inputs[`${li}`] ?? "") ? (
                  <p className="text-danger-strong mt-1 text-sm">정답: {line.text}</p>
                ) : null}
              </div>
            ) : (
              line.tokens.map((token, ti) => {
                if (!token.answer) return <span key={ti}>{token.text}</span>;
                const key = `${li}-${ti}`;
                const wrong = checked && !isDictationMatch(token.answer, inputs[key] ?? "");
                return (
                  <span key={ti} className="inline-flex flex-col">
                    <span className="inline-flex items-baseline">
                      <input
                        type="text"
                        value={inputs[key] ?? ""}
                        onChange={(e) => setInputs((p) => ({ ...p, [key]: e.target.value }))}
                        aria-label={`빈칸 (${token.answer.length}글자)`}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        style={{ width: `${Math.max(4, token.answer.length + 2)}ch` }}
                        className={cn("h-10", fieldClass(key, token.answer))}
                      />
                      {token.trailing}
                    </span>
                    {wrong ? (
                      <span className="text-danger-strong text-xs">{token.answer}</span>
                    ) : null}
                  </span>
                );
              })
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="lg">
            정답 확인
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => reset()}>
            다시 하기
          </Button>
          <p aria-live="polite" className="text-sm font-semibold">
            {checked ? `${correctCount} / ${blanks.length} 정답` : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
