/**
 * 播放：音频地址经宿主 useResource 解析（本地库、远端存储、缓存），一个页面一个 <audio>。
 * 远端音频边下边播：点了播放到出声前、播放中途缓冲时 loading 为真，数据到了自动开播。
 * 倍速记在插件存储里，下次打开沿用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "@tau/plugins";
import { useRuntime } from "../runtime";

export const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATE_KEY = "playbackRate";

export interface Playback {
  element: React.ReactElement;
  /** 地址已解析且能加载，可跳转、导出 */
  ready: boolean;
  /** 地址解析失败，或重新解析后仍加载不了 */
  error: boolean;
  /** 要播还没出声：等地址解析、等首段数据，或播放中途缓冲 */
  loading: boolean;
  /** 当前位置所在缓冲段的末端占全长的比例（0–1） */
  buffered: number;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  /** 播放 / 暂停；还在等开播时再点取消这次播放 */
  toggle(): void;
  /** 播放；地址还没解析好时等就绪后开播 */
  play(): void;
  /** 切到另一期（传它的音频地址），就绪后开播 */
  playWhenReady(url: string): void;
  seek(time: number): void;
  setRate(rate: number): void;
  /** 当前整期音频的字节，改句重合成用 */
  blob(): Promise<Blob>;
}

function bufferedRatio(audio: HTMLAudioElement, fallbackDuration: number) {
  const total = Number.isFinite(audio.duration) ? audio.duration : fallbackDuration;
  if (!total) return 0;
  const { buffered, currentTime } = audio;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.5 && currentTime <= buffered.end(i))
      return Math.min(1, buffered.end(i) / total);
  }
  return 0;
}

export function usePlayback(url: string | null, fallbackDuration = 0): Playback {
  const { context } = useRuntime();
  const resource = useResource(url ?? "", { kind: "audio" });
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [rate, setRateState] = useState(1);
  const src = url ? resource.src : undefined;
  const retried = useRef(false);
  // 等开播的那一期：事件回调里要读最新值，state 驱动界面
  const [pendingUrl, setPendingState] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const setPending = useCallback((next: string | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);
  // 已对这次等待调用过 play()；之前的暂停是切换时停掉上一期，不算取消
  const started = useRef(false);

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
    setStalled(false);
    setBuffered(0);
    setMediaError(false);
    setDuration(fallbackDuration);
    retried.current = false;
    if (pendingRef.current !== url) setPending(null);
  }, [url, fallbackDuration, setPending]);
  useEffect(() => {
    if (resource.status === "error") setPending(null);
  }, [resource.status, setPending]);

  const start = useCallback(() => {
    const audio = ref.current;
    if (!audio) return;
    started.current = true;
    audio.play().catch((error: unknown) => {
      // AbortError：换了地址；NotSupportedError：加载失败，交给 onError 重新解析后再开播
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError" || name === "NotSupportedError") return;
      console.error("[播客] 播放失败", error);
      setPending(null);
    });
  }, [setPending]);
  const play = useCallback(() => {
    setPending(url);
    started.current = false;
    if (ref.current?.src) start();
  }, [url, setPending, start]);
  const playWhenReady = useCallback(
    (next: string) => {
      if (next === url) return play();
      ref.current?.pause();
      started.current = false;
      setPending(next);
    },
    [url, play, setPending]
  );
  const toggle = useCallback(() => {
    const audio = ref.current;
    if (!audio) return;
    if (pendingRef.current || !audio.paused) {
      setPending(null);
      audio.pause();
    } else play();
  }, [play, setPending]);
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
      onPlaying={() => {
        setStalled(false);
        setPending(null);
      }}
      onWaiting={() => setStalled(true)}
      onPause={() => {
        setPlaying(false);
        setStalled(false);
        if (started.current) setPending(null);
      }}
      onEnded={() => {
        setPlaying(false);
        setPending(null);
      }}
      onProgress={event => setBuffered(bufferedRatio(event.currentTarget, duration))}
      onTimeUpdate={event => {
        setTime(event.currentTarget.currentTime);
        setBuffered(bufferedRatio(event.currentTarget, duration));
      }}
      onLoadedMetadata={event => {
        if (Number.isFinite(event.currentTarget.duration))
          setDuration(event.currentTarget.duration);
        event.currentTarget.playbackRate = rate;
        if (url && pendingRef.current === url && !started.current) start();
      }}
      onError={() => {
        // 缓存失效时重新解析一次，仍失败就显示错误
        if (retried.current) {
          setMediaError(true);
          setPending(null);
          return;
        }
        retried.current = true;
        resource.retry();
      }}
    />
  );
  const error = resource.status === "error" || mediaError;
  return {
    element,
    ready: !!src && resource.status === "ready" && !mediaError,
    error,
    loading: !error && ((!!url && pendingUrl === url) || (playing && stalled)),
    buffered,
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
