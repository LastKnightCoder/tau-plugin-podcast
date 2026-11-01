/**
 * 播客数据的查询：列表按创建时间倒序分页，原文的当前标题与是否已删除批量 describe。
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PluginEntityDescription, PluginEntityRef } from "@tau/plugins";
import { sourceKey, type Episode } from "../data/model";
import { EPISODES_KEY, REFS_KEY, useRuntime } from "../runtime";

export function useEpisodeList() {
  const { data } = useRuntime();
  return useInfiniteQuery({
    queryKey: [...EPISODES_KEY, "list"],
    queryFn: ({ pageParam }) => data.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.cursor,
  });
}

export function useEpisode(id: string | null) {
  const { data } = useRuntime();
  return useQuery({
    queryKey: [...EPISODES_KEY, "one", id],
    queryFn: () => (id ? data.get(id) : null),
    enabled: !!id,
  });
}

export function useEpisodeBySource(source: PluginEntityRef) {
  const { data } = useRuntime();
  return useQuery({
    queryKey: [...EPISODES_KEY, "source", sourceKey(source)],
    queryFn: () => data.find(source),
  });
}

export function useBusyEpisodes() {
  const { data } = useRuntime();
  return useQuery({ queryKey: [...EPISODES_KEY, "busy"], queryFn: () => data.busy() });
}

/** 原文的当前状态：ok 带最新标题，missing 为已删除 */
export function useSourceStates(episodes: readonly Episode[]) {
  const { context } = useRuntime();
  const refs = episodes.map(episode => episode.source);
  const key = refs.map(sourceKey).join(",");
  return useQuery({
    queryKey: [...REFS_KEY, key],
    queryFn: async () => {
      const map = new Map<string, PluginEntityDescription>();
      for (let i = 0; i < refs.length; i += 200) {
        const described = await context.app.describe(refs.slice(i, i + 200));
        described.forEach(item => map.set(sourceKey(item.ref), item));
      }
      return map;
    },
    enabled: refs.length > 0,
  });
}
