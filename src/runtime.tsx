/**
 * 插件运行时：本次启用的 context、数据层、生成任务、查询缓存与跨组件状态（待打开的生成对话框、
 * 正在播放的那一期）。组件经 useRuntime 取得。
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginContext, PluginEventType, PluginPageHandle } from "@tau/plugins";
import { createEpisodeData, type EpisodeData } from "./data/episodes";
import { sourceKey, type SourceKind } from "./data/model";
import { createJobs, type Jobs } from "./gen/jobs";

export const EPISODES_KEY = ["episodes"] as const;
export const REFS_KEY = ["refs"] as const;

const OWN_EVENTS: PluginEventType[] = [
  "entity.created",
  "entity.updated",
  "entity.deleted",
  "workspace.reset",
];
const SOURCE_EVENTS: PluginEventType[] = [
  "card.updated",
  "card.deleted",
  "article.updated",
  "article.deleted",
  "document.updated",
  "document.deleted",
];

/** 小型可订阅状态：给 useSyncExternalStore 用 */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export type Store<T> = ReturnType<typeof createStore<T>>;
export const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.get);

export interface PlayerState {
  episodeId: string;
  /** 播放器请求跳转的位置（秒），消费后清空 */
  seek: number | null;
  playing: boolean;
}

export interface PodcastRuntime {
  context: PluginContext;
  data: EpisodeData;
  jobs: Jobs;
  queryClient: QueryClient;
  pages: { library?: PluginPageHandle };
  /** 「⋯ › 生成播客」后打开原文详情，由原文上方的面板弹出生成对话框 */
  pendingDialog: Store<string | null>;
  player: Store<PlayerState | null>;
}

export function createRuntime(context: PluginContext): PodcastRuntime {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const data = createEpisodeData(context);
  const jobs = createJobs(context, data);
  context.events.on(
    OWN_EVENTS,
    () => void queryClient.invalidateQueries({ queryKey: EPISODES_KEY })
  );
  context.events.on(
    SOURCE_EVENTS,
    () => void queryClient.invalidateQueries({ queryKey: REFS_KEY })
  );
  context.register({ dispose: () => queryClient.clear() });
  return {
    context,
    data,
    jobs,
    queryClient,
    pages: {},
    pendingDialog: createStore<string | null>(null),
    player: createStore<PlayerState | null>(null),
  };
}

export const requestDialog = (runtime: PodcastRuntime, source: { kind: SourceKind; id: string }) =>
  runtime.pendingDialog.set(sourceKey(source));

const RuntimeContext = createContext<PodcastRuntime | null>(null);

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: PodcastRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): PodcastRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("播客的组件需要在插件页面内使用");
  return runtime;
}

export const useLive = (id: string | undefined) => {
  const { jobs } = useRuntime();
  return useSyncExternalStore(jobs.subscribe, () => (id ? jobs.live(id) : null));
};
