/**
 * 播客的数据形状：一篇原文一期（实体 episode，key 为原文引用），可读脚本写进实体正文供搜索与 @ 引用，
 * 播放用的结构化数据放 meta。重新生成期间旧音频照常可听：新稿放 draft，合成成功后才替换。
 */
import type { JsonValue, PluginEntityRef, PluginOwnEntity } from "@tau/plugins";

export const EPISODE_KIND = "episode";
export const SOURCE_ROLE = "source";
export const PAGE_ID = "podcasts";

export type SourceKind = "card" | "article" | "document";
export const SOURCE_KINDS: readonly SourceKind[] = ["card", "article", "document"];

export type PodcastFormat = "duo" | "panel" | "solo";

/** 生成任务所处阶段；ready 为没有进行中的任务 */
export type EpisodeStatus = "script" | "review" | "synth" | "failed" | "ready";

export interface Speaker {
  name: string;
  voiceId: string;
  voiceName: string;
  /** 1–5，对应 tag 色板 */
  tone: number;
}

export interface ScriptLine {
  /** speakers 的下标 */
  speaker: number;
  text: string;
  /** 秒；尚未合成时为 0 */
  start: number;
  duration: number;
}

export interface GenerationOptions {
  format: PodcastFormat;
  speakers: Speaker[];
  /** 目标时长（分钟） */
  minutes: number;
  focus: string;
  review: boolean;
}

export interface Draft {
  title: string;
  speakers: Speaker[];
  lines: ScriptLine[];
}

export interface Episode {
  id: string;
  revision: string;
  title: string;
  source: PluginEntityRef & { kind: SourceKind };
  /** 生成时原文的标题，原文删除后仍可显示 */
  sourceTitle: string;
  status: EpisodeStatus;
  error: string | null;
  /** 合成进度：已完成段数 / 总段数 */
  progress: { done: number; total: number } | null;
  options: GenerationOptions;
  /** 已完成的版本；首次生成完成前为 null */
  audio: { url: string; duration: number; speakers: Speaker[]; lines: ScriptLine[] } | null;
  draft: Draft | null;
  createdAt: number;
  updatedAt: number;
}

export const EPISODE_INDEXES = { status: "string", sourceKind: "string" } as const;

export const sourceKey = (ref: PluginEntityRef) => `${ref.kind}:${ref.id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function readSpeakers(value: unknown): Speaker[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item, index) => ({
    name: str(item.name, `说话人 ${index + 1}`),
    voiceId: str(item.voiceId),
    voiceName: str(item.voiceName),
    tone: Math.min(5, Math.max(1, Math.round(num(item.tone, (index % 5) + 1)))),
  }));
}

function readLines(value: unknown, speakerCount: number): ScriptLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap(item => {
    const speaker = Math.round(num(item.speaker, -1));
    const text = str(item.text).trim();
    if (speaker < 0 || speaker >= speakerCount || !text) return [];
    return [{ speaker, text, start: num(item.start), duration: num(item.duration) }];
  });
}

function readOptions(value: unknown): GenerationOptions {
  const item = isRecord(value) ? value : {};
  const format = str(item.format);
  return {
    format: format === "panel" || format === "solo" ? format : "duo",
    speakers: readSpeakers(item.speakers),
    minutes: Math.min(15, Math.max(1, Math.round(num(item.minutes, 5)))),
    focus: str(item.focus),
    review: item.review === true,
  };
}

const STATUSES = new Set<EpisodeStatus>(["script", "review", "synth", "failed", "ready"]);

export function readEpisode(entity: PluginOwnEntity): Episode | null {
  const meta = entity.meta;
  const source = isRecord(meta.source) ? meta.source : null;
  const kind = str(source?.kind) as SourceKind;
  if (!source || !SOURCE_KINDS.includes(kind) || !str(source.id)) return null;
  const status = str(meta.status) as EpisodeStatus;
  const audioMeta = isRecord(meta.audio) ? meta.audio : null;
  const audioSpeakers = readSpeakers(audioMeta?.speakers);
  const draftMeta = isRecord(meta.draft) ? meta.draft : null;
  const draftSpeakers = readSpeakers(draftMeta?.speakers);
  const progress = isRecord(meta.progress) ? meta.progress : null;
  return {
    id: entity.id,
    revision: entity.revision,
    title: entity.title,
    source: { kind, id: str(source.id) },
    sourceTitle: str(meta.sourceTitle),
    status: STATUSES.has(status) ? status : "ready",
    error: typeof meta.error === "string" ? meta.error : null,
    progress: progress ? { done: num(progress.done), total: num(progress.total) } : null,
    options: readOptions(meta.options),
    audio:
      audioMeta && str(audioMeta.url)
        ? {
            url: str(audioMeta.url),
            duration: num(audioMeta.duration),
            speakers: audioSpeakers,
            lines: readLines(audioMeta.lines, audioSpeakers.length),
          }
        : null,
    draft: draftMeta
      ? {
          title: str(draftMeta.title),
          speakers: draftSpeakers,
          lines: readLines(draftMeta.lines, draftSpeakers.length),
        }
      : null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

const speakersJson = (speakers: Speaker[]): JsonValue =>
  speakers.map(s => ({ name: s.name, voiceId: s.voiceId, voiceName: s.voiceName, tone: s.tone }));
const linesJson = (lines: ScriptLine[]): JsonValue =>
  lines.map(l => ({ speaker: l.speaker, text: l.text, start: l.start, duration: l.duration }));

export function episodeMeta(episode: Omit<Episode, "id" | "revision" | "title" | "createdAt" | "updatedAt">) {
  return {
    source: { kind: episode.source.kind, id: episode.source.id },
    sourceKind: episode.source.kind,
    sourceTitle: episode.sourceTitle,
    status: episode.status,
    error: episode.error,
    progress: episode.progress,
    options: {
      format: episode.options.format,
      speakers: speakersJson(episode.options.speakers),
      minutes: episode.options.minutes,
      focus: episode.options.focus,
      review: episode.options.review,
    },
    audio: episode.audio
      ? {
          url: episode.audio.url,
          duration: episode.audio.duration,
          speakers: speakersJson(episode.audio.speakers),
          lines: linesJson(episode.audio.lines),
        }
      : null,
    draft: episode.draft
      ? {
          title: episode.draft.title,
          speakers: speakersJson(episode.draft.speakers),
          lines: linesJson(episode.draft.lines),
        }
      : null,
  } satisfies Record<string, JsonValue>;
}

/** 可读脚本：写进实体正文，供搜索与 @ 引用 */
export function scriptMarkdown(speakers: Speaker[], lines: ScriptLine[]) {
  return lines.map(line => `**${speakers[line.speaker]?.name ?? "?"}**：${line.text}`).join("\n\n");
}

export const isBusy = (status: EpisodeStatus) => status === "script" || status === "synth";
