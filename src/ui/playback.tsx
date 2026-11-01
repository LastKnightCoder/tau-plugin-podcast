/**
 * 播放：音频地址经宿主 useResource 解析（本地库、远端存储、缓存），一个页面一个 <audio>。
 * 倍速记在插件存储里，下次打开沿用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "@tau/plugins";
import { useRuntime } from "../runtime";

export const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATE_KEY = "playbackRate";

export interface Playback {
  element: React.ReactElement;
  ready: boolean;
  error: boolean;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  toggle(): void;
  play(): void;
  /** 地址解析好后立即播放（切换到另一期时用） */
  playWhenReady(): void;
  seek(time: number): void;
  setRate(rate: number): void;
  /** 当前整期音频的字节，改句重合成用 */
  blob(): Promise<Blob>;
}

export function usePlayback(url: string | null, fallbackDuration = 0): Playback {
  const { context } = useRuntime();
  const resource = useResource(url ?? "", { kind: "audio" });
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [rate, setRateState] = useState(1);
  const src = url ? resource.src : undefined;
  const retried = useRef(false);
  const autoplay = useRef(false);

  useEffect(() => {
    void context.storage.get(RATE_KEY).then(value => {
      if (typeof value === "number" && RATES.includes(value as (typeof RATES)[number]))
        setRateState(value);
    });
  }, [context]);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, src]);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setDuration(fallbackDuration);
    retried.current = false;
  }, [url, fallbackDuration]);

  const play = useCallback(() => {
    void ref.current?.play().catch(error => console.error("[播客] 播放失败", error));
  }, []);
  const playWhenReady = useCallback(() => {
    if (ref.current?.src) play();
    else autoplay.current = true;
  }, [play]);
  const toggle = useCallback(() => {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) play();
    else audio.pause();
  }, [play]);
  const seek = useCallback((next: number) => {
    const audio = ref.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(next, audio.duration || next));
    setTime(audio.currentTime);
  }, []);
  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      void context.storage.set(RATE_KEY, next);
    },
    [context]
  );
  const blob = useCallback(async () => {
    if (!src) throw new Error("音频还没有加载");
    const response = await fetch(src);
    if (!response.ok) throw new Error("读取音频失败");
    return response.blob();
  }, [src]);

  const element = (
    <audio
      ref={ref}
      src={src}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onLoadedMetadata={event => {
        if (Number.isFinite(event.currentTarget.duration))
          setDuration(event.currentTarget.duration);
        event.currentTarget.playbackRate = rate;
        if (autoplay.current) {
          autoplay.current = false;
          play();
        }
      }}
      onError={() => {
        // 缓存失效时重新解析一次，仍失败就显示错误
        if (retried.current) return;
        retried.current = true;
        resource.retry();
      }}
    />
  );
  return {
    element,
    ready: !!src && resource.status === "ready",
    error: resource.status === "error",
    playing,
    time,
    duration,
    rate,
    toggle,
    play,
    playWhenReady,
    seek,
    setRate,
    blob,
  };
}
