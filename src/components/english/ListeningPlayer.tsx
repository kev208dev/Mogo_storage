"use client";

import { FileTextIcon, PauseIcon, PencilLineIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ListeningTrack } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { LISTENING_PLAY_EVENT, openDictation } from "./events";

const RATES = [0.75, 1, 1.25, 1.5] as const;

/**
 * 영어 듣기 플레이어. 하나의 음원 파일에서 문항별 구간(start~end)을 재생한다.
 * 음원은 preload="none" 으로 사용자가 재생할 때만 내려받는다.
 */
export function ListeningPlayer({
  tracks,
  audioUrl,
}: {
  tracks: ListeningTrack[];
  audioUrl: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<ListeningTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [openScripts, setOpenScripts] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

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

  function toggle(track: ListeningTrack) {
    const audio = audioRef.current;
    if (!audio) return;
    if (current?.id === track.id && playing) audio.pause();
    else void play(track, current?.id !== track.id);
  }

  // 구간 끝에서 멈춤
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (current && audio.currentTime >= current.endSeconds) {
        audio.pause();
        audio.currentTime = current.startSeconds;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [current]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, current]);

  // 받아쓰기 등 다른 컴포넌트에서 재생 요청
  useEffect(() => {
    const onRequest = (e: Event) => {
      const n = (e as CustomEvent<number | null>).detail;
      const track = tracks.find((t) => t.questionNumber === n);
      if (track) void play(track);
    };
    window.addEventListener(LISTENING_PLAY_EVENT, onRequest);
    return () => window.removeEventListener(LISTENING_PLAY_EVENT, onRequest);
  }, [tracks, play]);

  const toggleScript = (id: string) =>
    setOpenScripts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <audio ref={audioRef} src={audioUrl} preload="none" className="hidden" />

      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex items-center gap-1.5">
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
              <span className="border-border peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-ring/60 flex min-h-10 min-w-12 cursor-pointer items-center justify-center rounded-md border px-2 text-sm font-semibold tabular-nums peer-focus-visible:ring-[3px]">
                {r}x
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {current
            ? `${current.label} ${playing ? "재생 중" : "일시정지"}`
            : "재생할 문항을 선택하세요"}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-danger-strong mt-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}

      <ul className="divide-border border-border mt-3 divide-y rounded-md border">
        {tracks.map((track) => {
          const isCurrent = current?.id === track.id;
          const isPlaying = isCurrent && playing;
          const scriptOpen = openScripts.has(track.id);
          return (
            <li key={track.id} className={cn("px-2 py-1.5", isCurrent && "bg-primary-soft")}>
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
                {track.questionNumber !== null ? (
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
                ) : null}
              </div>
              {scriptOpen && track.transcript ? (
                <div
                  className="bg-background mt-1 mb-1 space-y-1 rounded-md px-3 py-2 text-sm"
                  lang="en"
                >
                  {track.transcript.map((line, i) => (
                    <p key={i}>
                      {line.speaker ? <strong className="mr-1.5">{line.speaker}:</strong> : null}
                      {line.text}
                    </p>
                  ))}
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
        "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-semibold focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-40",
        pressed && "text-primary",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
