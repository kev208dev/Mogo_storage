"use client";

import { PauseIcon, PlayIcon, RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const RATES = [0.75, 1, 1.25, 1.5] as const;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 공식 듣기 음원 전체 재생기. 문항별 구간이 검증되지 않은 시험에서 쓴다 (임의로 자르지 않는다).
 * 재생/일시정지, ±5초, 속도. 음원은 사용자가 재생할 때만 내려받는다 (preload="none").
 * 파일은 /api/files/{id}/view → 스토리지로 redirect 되므로 Range(구간 탐색)는 스토리지가 처리한다.
 */
export function FullListeningPlayer({ audioUrl }: { audioUrl: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onError = () =>
      setError("음원을 재생하지 못했습니다. 잠시 후 다시 시도하거나 MP3를 다운로드해 주세요.");
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setError("음원을 재생하지 못했습니다. 잠시 후 다시 시도하거나 MP3를 다운로드해 주세요.");
    }
  }

  function seek(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), max);
    setTime(audio.currentTime);
  }

  const btn =
    "border-border hover:bg-muted focus-visible:ring-ring/60 inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold focus-visible:ring-[3px] focus-visible:outline-none";

  return (
    <div data-testid="listening-full-player">
      <audio ref={audioRef} src={audioUrl} preload="none" data-testid="listening-full-audio" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => seek(-5)} className={btn} aria-label="5초 뒤로">
          <RotateCcwIcon className="size-4" aria-hidden />
          5초
        </button>
        <button
          type="button"
          onClick={() => void toggle()}
          className={`${btn} bg-primary text-primary-foreground border-primary min-w-24`}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing ? (
            <PauseIcon className="size-5" aria-hidden />
          ) : (
            <PlayIcon className="size-5" aria-hidden />
          )}
          {playing ? "일시정지" : "재생"}
        </button>
        <button type="button" onClick={() => seek(5)} className={btn} aria-label="5초 앞으로">
          5초
          <RotateCwIcon className="size-4" aria-hidden />
        </button>
        <span className="text-muted-foreground text-sm tabular-nums" aria-live="off">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={1}
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        onChange={(e) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = Number(e.target.value);
          setTime(audio.currentTime);
        }}
        aria-label="재생 위치"
        className="accent-primary mt-2 w-full"
      />
      <fieldset className="mt-1 flex items-center gap-1.5">
        <legend className="sr-only">재생 속도</legend>
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={rate === r}
            onClick={() => setRate(r)}
            className={`min-h-10 min-w-12 rounded-md border px-2 text-sm font-semibold tabular-nums ${rate === r ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
          >
            {r}x
          </button>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-danger-strong mt-2 text-sm font-semibold">
          {error}{" "}
          <a href={audioUrl} className="underline">
            듣기 파일 열기
          </a>
        </p>
      ) : null}
    </div>
  );
}
