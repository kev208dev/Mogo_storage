"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  PauseIcon,
  PencilLineIcon,
  PlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListeningTrack } from "@/lib/data/types";
import { activeLineIndex, clampSeek, neighborSegment, verifiedSegments } from "@/lib/listening";
import { cn } from "@/lib/utils";
import { LISTENING_PLAY_EVENT, openDictation } from "./events";
import { TranscriptSource } from "./TranscriptSource";

const RATES = [0.75, 1, 1.25, 1.5] as const;

/**
 * 영어 듣기 플레이어 — 문항 구간(start~end)이 검증된 트랙만 문항별로 재생한다.
 * 구간이 검증되지 않은 시험은 이 컴포넌트를 쓰지 않고 FullListeningPlayer(전체 재생)를 쓴다.
 * 음원은 preload="none" 으로 사용자가 재생할 때만 내려받는다.
 *
 * 키보드 (플레이어에 포커스가 있을 때): Space 재생/일시정지, ←/→ 5초, Shift+←/→ 10초,
 * [ / ] 이전/다음 문항, R 구간 반복
 */
export function ListeningPlayer({
  tracks,
  audioUrl,
}: {
  tracks: ListeningTrack[];
  audioUrl: string;
}) {
  const segments = useMemo(() => verifiedSegments(tracks), [tracks]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<ListeningTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [repeat, setRepeat] = useState(false);
  const [openScripts, setOpenScripts] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 완료 표시 (테스트·접근성 상태용)
  useEffect(() => setReady(true), []);

  const play = useCallback(async (track: ListeningTrack, restart = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    setCurrent(track);
    try {
      if (
        restart ||
        audio.currentTime < track.startSeconds ||
        audio.currentTime >= track.endSeconds
      ) {
        audio.currentTime = track.startSeconds;
      }
      await audio.play();
    } catch {
      setError("음원을 재생하지 못했습니다. 잠시 후 다시 시도하거나 MP3를 다운로드해 주세요.");
    }
  }, []);

  function toggle(track: ListeningTrack | null = current ?? segments[0] ?? null) {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (current?.id === track.id && playing) audio.pause();
    else void play(track, current?.id !== track.id);
  }

  // 구간 끝: 반복이면 처음으로, 아니면 멈춤
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setTime(audio.currentTime);
      if (current && audio.currentTime >= current.endSeconds) {
        audio.currentTime = current.startSeconds;
        if (!repeat) audio.pause();
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () =>
      setError("음원을 불러오지 못했습니다. 잠시 후 다시 시도하거나 MP3를 다운로드해 주세요.");
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("error", onError);
    };
  }, [current, repeat]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, current]);

  // 받아쓰기 등 다른 컴포넌트에서 재생 요청
  useEffect(() => {
    const onRequest = (e: Event) => {
      const n = (e as CustomEvent<number | null>).detail;
      const track = segments.find((t) => t.questionNumber === n);
      if (track) void play(track);
    };
    window.addEventListener(LISTENING_PLAY_EVENT, onRequest);
    return () => window.removeEventListener(LISTENING_PLAY_EVENT, onRequest);
  }, [segments, play]);

  /** ±초 이동. 현재 문항 구간 밖으로는 나가지 않는다 */
  function seek(delta: number) {
    const audio = audioRef.current;
    if (!audio || !current) return;
    audio.currentTime = clampSeek(current, audio.currentTime + delta);
  }

  function go(delta: -1 | 1) {
    const next = neighborSegment(segments, current?.id ?? null, delta);
    if (next) void play(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (e.key === " " && target.tagName !== "BUTTON") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      seek((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 5));
    } else if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      go(e.key === "[" ? -1 : 1);
    } else if (e.key === "r" || e.key === "R") {
      setRepeat((r) => !r);
    }
  }

  const toggleScript = (id: string) =>
    setOpenScripts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const prev = neighborSegment(segments, current?.id ?? null, -1);
  const next = neighborSegment(segments, current?.id ?? null, 1);

  return (
    <div
      onKeyDown={onKeyDown}
      role="group"
      aria-label="문항별 듣기 플레이어"
      aria-keyshortcuts="Space ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight [ ] R"
      data-testid="listening-segment-player"
      data-ready={ready ? "" : undefined}
    >
      <audio ref={audioRef} src={audioUrl} preload="none" className="hidden" />

      <div className="bg-muted/50 border-border rounded-md border p-2">
        <p className="text-sm font-semibold" aria-live="polite" data-testid="listening-current">
          {current
            ? `${current.label} ${playing ? "재생 중" : "일시정지"}`
            : "재생할 문항을 선택하세요"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <TrackAction
            icon={ChevronLeftIcon}
            label="이전 문항"
            ariaLabel="이전 문항"
            disabled={!prev}
            onClick={() => go(-1)}
          />
          <TrackAction
            icon={RotateCcwIcon}
            label="10초"
            ariaLabel="10초 뒤로"
            disabled={!current}
            onClick={() => seek(-10)}
          />
          <TrackAction
            icon={RotateCcwIcon}
            label="5초"
            ariaLabel="5초 뒤로"
            disabled={!current}
            onClick={() => seek(-5)}
          />
          <button
            type="button"
            onClick={() => toggle()}
            disabled={segments.length === 0}
            aria-label={playing ? "일시정지" : "현재 문항 재생"}
            className="bg-primary text-primary-foreground focus-visible:ring-ring/60 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 focus-visible:ring-[3px] focus-visible:outline-none"
          >
            {playing ? (
              <PauseIcon className="size-5" aria-hidden />
            ) : (
              <PlayIcon className="size-5" aria-hidden />
            )}
          </button>
          <TrackAction
            icon={RotateCwIcon}
            label="5초"
            ariaLabel="5초 앞으로"
            disabled={!current}
            onClick={() => seek(5)}
          />
          <TrackAction
            icon={RotateCwIcon}
            label="10초"
            ariaLabel="10초 앞으로"
            disabled={!current}
            onClick={() => seek(10)}
          />
          <TrackAction
            icon={ChevronRightIcon}
            label="다음 문항"
            ariaLabel="다음 문항"
            disabled={!next}
            onClick={() => go(1)}
          />
          <TrackAction
            icon={RepeatIcon}
            label="구간 반복"
            ariaLabel="현재 문항 구간 반복"
            pressed={repeat}
            onClick={() => setRepeat((r) => !r)}
          />
        </div>
        <fieldset className="mt-2 flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">재생 속도</legend>
          <span aria-hidden className="text-sm font-semibold">
            속도
          </span>
          {RATES.map((r) => (
            <label key={r}>
              <input
                type="radio"
                name="listening-rate"
                className="peer sr-only"
                checked={rate === r}
                onChange={() => setRate(r)}
                aria-label={`${r}배속`}
              />
              <span className="border-border peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/60 bg-background flex min-h-10 min-w-12 cursor-pointer items-center justify-center rounded-md border px-2 text-sm font-semibold tabular-nums peer-focus-visible:ring-[3px]">
                {r}x
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-muted-foreground mt-1 hidden text-xs sm:block">
          단축키: Space 재생 · ←/→ 5초 · Shift+←/→ 10초 · [ ] 이전/다음 문항 · R 구간 반복
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-danger-strong mt-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}

      <ul className="divide-border border-border mt-3 divide-y rounded-md border">
        {segments.map((track) => {
          const isCurrent = current?.id === track.id;
          const isPlaying = isCurrent && playing;
          const scriptOpen = openScripts.has(track.id);
          const active =
            isCurrent && track.transcript ? activeLineIndex(track.transcript, time) : null;
          return (
            <li
              key={track.id}
              className={cn("px-2 py-1.5", isCurrent && "bg-primary-soft")}
              aria-current={isCurrent ? "true" : undefined}
              data-question={track.questionNumber}
            >
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle(track)}
                  aria-label={`${track.label} ${isPlaying ? "일시정지" : "재생"}`}
                  className="hover:bg-muted focus-visible:ring-ring/60 inline-flex min-h-11 min-w-28 items-center gap-2 rounded-md px-2 font-bold focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  {isPlaying ? (
                    <PauseIcon className="text-primary size-5" aria-hidden />
                  ) : (
                    <PlayIcon className="text-primary size-5" aria-hidden />
                  )}
                  {track.label}
                </button>
                <div className="ml-auto flex gap-0.5">
                  <TrackAction
                    icon={FileTextIcon}
                    label="대본 보기"
                    pressed={scriptOpen}
                    disabled={!track.transcript}
                    onClick={() => toggleScript(track.id)}
                    ariaLabel={`${track.label} 대본 ${scriptOpen ? "숨기기" : "보기"}`}
                  />
                  <TrackAction
                    icon={RotateCcwIcon}
                    label="다시 듣기"
                    onClick={() => void play(track, true)}
                    ariaLabel={`${track.label} 처음부터 다시 듣기`}
                  />
                  <TrackAction
                    icon={PencilLineIcon}
                    label="받아쓰기"
                    disabled={!track.transcript}
                    onClick={() => openDictation(track.questionNumber!)}
                    ariaLabel={`${track.label} 받아쓰기`}
                  />
                </div>
              </div>
              {scriptOpen && track.transcript ? (
                <div className="bg-background mt-1 mb-1 rounded-md px-3 py-2 text-sm">
                  <div className="space-y-1" lang="en">
                    {track.transcript.map((line, i) => {
                      const content = (
                        <>
                          {line.speaker ? (
                            <strong className="mr-1.5">{line.speaker}:</strong>
                          ) : null}
                          {line.text}
                        </>
                      );
                      // 문장 구간은 공식 자료로 주어진 경우에만 (없으면 클릭 이동 없음)
                      return typeof line.startSeconds === "number" ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            const audio = audioRef.current;
                            if (!audio) return;
                            setCurrent(track);
                            audio.currentTime = clampSeek(track, line.startSeconds!);
                            void audio.play().catch(() => undefined);
                          }}
                          aria-current={active === i ? "true" : undefined}
                          className={cn(
                            "block w-full rounded px-1 text-left",
                            active === i && "bg-primary-soft font-semibold",
                          )}
                        >
                          {content}
                        </button>
                      ) : (
                        <p key={i}>{content}</p>
                      );
                    })}
                  </div>
                  <TranscriptSource
                    origin={track.transcriptOrigin}
                    url={track.transcriptSourceUrl}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TrackAction({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
  pressed,
  disabled,
}: {
  icon: typeof PlayIcon;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-40",
        pressed && "text-primary bg-primary-soft",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
