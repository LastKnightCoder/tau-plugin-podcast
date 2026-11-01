/**
 * 播客实体的读写：按原文找一期、分页列出、带冲突重试的 meta 更新、可读脚本写回正文。
 */
import { PluginConflictError, type PluginContext, type PluginEntityRef } from "@tau/plugins";
import {
  EPISODE_KIND,
  SOURCE_ROLE,
  episodeMeta,
  readEpisode,
  scriptMarkdown,
  sourceKey,
  type Episode,
  type GenerationOptions,
  type SourceKind,
} from "./model";

export interface EpisodeData {
  find(source: PluginEntityRef): Promise<Episode | null>;
  get(id: string): Promise<Episode | null>;
  list(cursor?: string): Promise<{ items: Episode[]; cursor?: string }>;
  count(): Promise<number>;
  busy(): Promise<Episode[]>;
  create(input: {
    source: PluginEntityRef & { kind: SourceKind };
    sourceTitle: string;
    options: GenerationOptions;
    /** 缺省为原文引用；Notebook 每次生成一期，key 另给 */
    key?: string;
  }): Promise<Episode>;
  /** 读最新版本后改写；并发修改时重读重试 */
  patch(id: string, change: (episode: Episode) => Partial<Episode> | null): Promise<Episode | null>;
  writeScript(episode: Episode): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createEpisodeData(context: PluginContext): EpisodeData {
  const entities = context.entities;
  const get = async (id: string) => {
    const entity = await entities.get(id);
    return entity ? readEpisode(entity) : null;
  };
  return {
    async find(source) {
      const entity = await entities.find(EPISODE_KIND, sourceKey(source));
      return entity ? readEpisode(entity) : null;
    },
    get,
    async list(cursor) {
      const page = await entities.query({
        kind: EPISODE_KIND,
        orderBy: { field: "createdAt", direction: "desc" },
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      return {
        items: page.items.flatMap(entity => readEpisode(entity) ?? []),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
    },
    count: () => entities.count({ kind: EPISODE_KIND }),
    async busy() {
      const page = await entities.query({
        kind: EPISODE_KIND,
        where: { status: { in: ["script", "synth", "review", "failed"] } },
        limit: 200,
      });
      return page.items.flatMap(entity => readEpisode(entity) ?? []);
    },
    async create({ source, sourceTitle, options, key }) {
      const entity = await entities.create({
        kind: EPISODE_KIND,
        key: key ?? sourceKey(source),
        title: sourceTitle || "未命名播客",
        meta: episodeMeta({
          source,
          sourceTitle,
          status: "script",
          error: null,
          progress: null,
          options,
          audio: null,
          draft: null,
        }),
      });
      // Notebook 的 output 关联由 Tau 在 prepare 之后建立
      if (source.kind !== "notebook") await context.links.add(entity.id, source, { role: SOURCE_ROLE });
      const episode = readEpisode(entity);
      if (!episode) throw new Error("播客数据无效");
      return episode;
    },
    async patch(id, change) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await get(id);
        if (!current) return null;
        const next = change(current);
        if (!next) return current;
        const merged = { ...current, ...next };
        try {
          const entity = await entities.update(
            id,
            { title: merged.title, meta: episodeMeta(merged) },
            { expectedRevision: current.revision }
          );
          return readEpisode(entity);
        } catch (error) {
          if (!(error instanceof PluginConflictError) || attempt === 3) throw error;
        }
      }
      return null;
    },
    async writeScript(episode) {
      if (!episode.audio) return;
      const entity = await entities.get(episode.id);
      if (!entity) return;
      const snapshot = await context.content.read(entity.contentRef);
      await context.content.edit(
        entity.contentRef,
        {
          op: "replaceAll",
          content: { markdown: scriptMarkdown(episode.audio.speakers, episode.audio.lines) },
        },
        { expectedRevision: snapshot?.revision ?? "" }
      );
    },
    async rename(id, title) {
      const trimmed = title.trim().slice(0, 100);
      if (trimmed) await this.patch(id, current => (current.title === trimmed ? null : { title: trimmed }));
    },
    async remove(id) {
      const entity = await entities.get(id);
      if (entity) await entities.delete(id, { expectedRevision: entity.revision });
    },
  };
}
