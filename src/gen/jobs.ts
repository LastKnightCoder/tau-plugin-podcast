/**
 * 生成任务：在 activate 里创建，与页面解耦，单并发排队。阶段写进实体 meta（侧栏、面板、播客库据此显示），
 * 合成进度只放内存，避免逐段写库。已合成的段落按期缓存在内存里，失败后同一次运行内可从断点续；
 * 应用关闭后进行中的任务在下次启用时标为失败，保留草稿可重新合成。
 * Notebook 入口的脚本由 Tau 的 Notebook 生成流程写好后交回（completeNotebook），这里只解析与合成。
 */
import {
  PluginPermissionError,
  type PluginContext,
  type PluginEntityRef,
  type TTSAudio,
} from "@tau/plugins";
import type { EpisodeData } from "../data/episodes";
import type {
  Draft,
  Episode,
  GenerationOptions,
  PickableKind,
  ScriptLine,
  SourceKind,
} from "../data/model";
import {
  NOTEBOOK_REMINDERS,
  buildScriptMessages,
  notebookInstructions,
  parseScript,
  retime,
} from "./script";
import { concat, measure, replaceSegment, saveAudio } from "./audio";

export const AI_FEATURE = "script";

export interface LiveProgress {
  phase: "script" | "synth" | "merge" | "save" | "line";
  done: number;
  total: number;
}

type Listener = () => void;

export interface Jobs {
  /** 新建或重新生成；返回这一期的 ID */
  start(input: {
    source: PluginEntityRef & { kind: PickableKind };
    sourceTitle: string;
    options: GenerationOptions;
  }): Promise<string>;
  /** Notebook 入口：建好占位，返回交给 Tau 的任务要求 */
  prepareNotebook(input: {
    notebook: { id: string; title: string };
    options: GenerationOptions;
    signal: AbortSignal;
  }): Promise<{ entity: string; instructions: string; reminders: readonly string[] }>;
  /** Notebook 入口：Tau 写好的脚本交回后解析并合成（或停在审稿） */
  completeNotebook(
    id: string,
    text: string,
    report: { phase(text: string): void; progress(done: number, total: number): void },
    signal: AbortSignal
  ): Promise<void>;
  failNotebook(id: string, reason: "cancelled" | "failed", message: string): Promise<void>;
  confirmReview(id: string, draft: Draft): Promise<void>;
  resume(id: string): Promise<void>;
  /** 取消进行中的任务，或放弃待审 / 失败的稿子；首次生成直接删掉这一期 */
  discard(id: string): Promise<void>;
  /** 改一句并只重合成这一句；original 为当前整期音频 */
  redoLine(id: string, index: number, text: string, original: Blob): Promise<void>;
  live(id: string): LiveProgress | null;
  subscribe(listener: Listener): () => void;
}

const SOURCE_LABEL: Record<SourceKind, string> = {
  card: "卡片",
  article: "文章",
  document: "项目文档",
  notebook: "Notebook",
};
const PHASE_TEXT: Record<LiveProgress["phase"], string> = {
  script: "写脚本",
  synth: "合成语音",
  merge: "合并音频",
  save: "保存音频",
  line: "重新合成",
};

function message(error: unknown) {
  if (error instanceof PluginPermissionError)
    return "没有获得所需的权限，可在插件详情页的「权限」里允许后重试";
  if (error instanceof Error && error.message) return error.message.replace(/^[A-Z_]+：/, "");
  return "未知错误";
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function createJobs(context: PluginContext, data: EpisodeData): Jobs {
  const listeners = new Set<Listener>();
  const live = new Map<string, LiveProgress>();
  const controllers = new Map<string, AbortController>();
  /** 正在运行的任务，取消时等它完全退出再改状态，避免迟到的写入覆盖 */
  const settled = new Map<string, Promise<void>>();
  /** 已合成的段落：按「说话人音色 + 文字」对上，改稿后未变的段落不重合成 */
  const segments = new Map<string, Map<string, TTSAudio>>();
  const queue: string[] = [];
  let running = false;

  const emit = () => listeners.forEach(listener => listener());
  const setLive = (id: string, value: LiveProgress | null) => {
    if (value) live.set(id, value);
    else live.delete(id);
    emit();
  };

  async function readSource(source: PluginEntityRef & { kind: SourceKind }) {
    if (source.kind === "notebook") throw new Error("Notebook 的播客脚本要在 Notebook 里重新生成");
    const entity =
      source.kind === "card"
        ? await context.data.cards.get(source.id)
        : source.kind === "article"
          ? await context.data.articles.get(source.id)
          : await context.data.documents.get(source.id);
    if (!entity) throw new Error(`${SOURCE_LABEL[source.kind]}已删除`);
    if (!entity.contentRef) throw new Error(`这篇${SOURCE_LABEL[source.kind]}没有正文`);
    const snapshot = await context.content.read(entity.contentRef, { format: "markdown" });
    const markdown = snapshot?.markdown?.trim();
    if (!markdown) throw new Error(`${SOURCE_LABEL[source.kind]}正文是空的`);
    return { title: entity.title, markdown };
  }

  async function writeScript(episode: Episode, signal: AbortSignal) {
    const source = await readSource(episode.source);
    signal.throwIfAborted();
    const session = await context.tts.open({ signal });
    let instructions: string | undefined;
    try {
      instructions = session.textInstructions;
    } finally {
      await session.close();
    }
    const { speakers, format, minutes, focus } = episode.options;
    const messages = buildScriptMessages({
      sourceTitle: source.title,
      content: source.markdown,
      format,
      speakers,
      minutes,
      focus,
      textInstructions: instructions,
    });
    let output = "";
    for await (const event of context.ai.stream({ feature: AI_FEATURE, messages, signal })) {
      if (event.type === "text") output += event.delta;
    }
    signal.throwIfAborted();
    const parsed = parseScript(output, speakers);
    if (!parsed.lines.length) throw new Error("模型没有写出可用的对话，请重试或换一个模型");
    return {
      sourceTitle: source.title,
      draft: { title: parsed.title || source.title, speakers, lines: parsed.lines } satisfies Draft,
    };
  }

  async function synthesize(
    id: string,
    draft: Draft,
    signal: AbortSignal,
    report: (id: string, value: LiveProgress | null) => void = setLive
  ) {
    const cache = segments.get(id) ?? new Map<string, TTSAudio>();
    segments.set(id, cache);
    const session = await context.tts.open({ signal });
    const audios: TTSAudio[] = [];
    const durations: number[] = [];
    try {
      for (let i = 0; i < draft.lines.length; i++) {
        signal.throwIfAborted();
        report(id, { phase: "synth", done: i, total: draft.lines.length });
        const line = draft.lines[i];
        const voiceId = draft.speakers[line.speaker]?.voiceId;
        if (!voiceId)
          throw new Error(`「${draft.speakers[line.speaker]?.name ?? "说话人"}」没有选音色`);
        const key = `${voiceId}\n${line.text}`;
        let audio = cache.get(key);
        if (!audio) {
          try {
            audio = await session.synthesize({ text: line.text, voiceId }, { signal });
          } catch (error) {
            if (isAbort(error)) throw error;
            throw new Error(
              `第 ${i + 1} 段合成失败：${message(error)}（已合成 ${i} / ${draft.lines.length} 段）`
            );
          }
          cache.set(key, audio);
        }
        audios.push(audio);
        durations.push(await measure(audio));
      }
    } finally {
      await session.close();
    }
    report(id, { phase: "merge", done: draft.lines.length, total: draft.lines.length });
    const merged = await concat(context, audios, signal);
    report(id, { phase: "save", done: draft.lines.length, total: draft.lines.length });
    const url = await saveAudio(context, merged, draft.title, signal);
    const lines = retime(draft.lines, durations);
    return { url, lines, duration: lines.reduce((sum, line) => sum + line.duration, 0) };
  }

  function run(id: string) {
    const task = execute(id).then(() => undefined);
    settled.set(id, task);
    return task.finally(() => settled.delete(id));
  }

  /** 跑一期的任务；返回失败原因（成功、停在审稿或被取消为 null），队列不关心，Notebook 入口据此报错 */
  async function execute(
    id: string,
    outer?: { signal: AbortSignal; onLive(value: LiveProgress): void }
  ): Promise<string | null> {
    const controller = new AbortController();
    controllers.set(id, controller);
    const signal = AbortSignal.any([
      controller.signal,
      context.signal,
      ...(outer ? [outer.signal] : []),
    ]);
    const report = outer
      ? (id_: string, value: LiveProgress | null) => {
          setLive(id_, value);
          if (value) outer.onLive(value);
        }
      : setLive;
    try {
      let episode = await data.get(id);
      if (!episode) return null;
      if (episode.status === "script") {
        report(id, { phase: "script", done: 0, total: 0 });
        const { draft, sourceTitle } = await writeScript(episode, signal);
        signal.throwIfAborted();
        const review = episode.options.review;
        episode = await data.patch(id, () => ({
          draft,
          sourceTitle,
          status: review ? "review" : "synth",
          ...(episode?.audio ? {} : { title: draft.title }),
        }));
        if (!episode || review) {
          if (episode && review)
            context.notifications.send({
              title: "播客脚本写好了",
              body: `「${draft.title}」等你过一遍再合成`,
              mode: "auto",
            });
          return null;
        }
      }
      if (episode.status !== "synth" || !episode.draft) return null;
      const draft = episode.draft;
      const result = await synthesize(id, draft, signal, report);
      signal.throwIfAborted();
      const done = await data.patch(id, () => ({
        title: draft.title || episode!.title,
        status: "ready",
        error: null,
        progress: null,
        draft: null,
        audio: {
          url: result.url,
          duration: result.duration,
          speakers: draft.speakers,
          lines: result.lines,
        },
      }));
      segments.delete(id);
      if (done) {
        await data
          .writeScript(done)
          .catch(error => console.error("[播客] 写入脚本正文失败", error));
        context.notifications.send({
          title: "播客已生成",
          body: `「${done.title}」可以收听了`,
          tone: "ok",
        });
      }
      return null;
    } catch (error) {
      if (signal.aborted) return null;
      console.error("[播客] 生成失败", error);
      const total = live.get(id)?.total ?? 0;
      const done = live.get(id)?.done ?? 0;
      await data
        .patch(id, () => ({
          status: "failed",
          error: message(error),
          progress: total ? { done, total } : null,
        }))
        .catch(() => undefined);
      return message(error);
    } finally {
      controllers.delete(id);
      setLive(id, null);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !context.signal.aborted) await run(queue.shift()!);
    } finally {
      running = false;
    }
  }
  const enqueue = (id: string) => {
    if (!queue.includes(id) && !controllers.has(id)) queue.push(id);
    setLive(id, live.get(id) ?? { phase: "script", done: 0, total: 0 });
    void pump();
  };

  // 上次运行中断的任务：标为失败，草稿还在的可以直接重新合成
  void data
    .busy()
    .then(list =>
      Promise.all(
        list
          .filter(episode => episode.status === "script" || episode.status === "synth")
          .map(episode =>
            data.patch(episode.id, current =>
              current.status === "script" || current.status === "synth"
                ? { status: "failed", error: "应用关闭时生成被中断" }
                : null
            )
          )
      )
    )
    .catch(error => console.error("[播客] 恢复任务状态失败", error));

  return {
    async start({ source, sourceTitle, options }) {
      const existing = await data.find(source);
      if (existing && controllers.has(existing.id)) throw new Error("这篇内容的播客正在生成");
      const episode = existing
        ? await data.patch(existing.id, () => ({
            status: "script",
            error: null,
            progress: null,
            draft: null,
            options,
            sourceTitle,
          }))
        : await data.create({ source, sourceTitle, options });
      if (!episode) throw new Error("播客已被删除");
      segments.delete(episode.id);
      enqueue(episode.id);
      return episode.id;
    },
    async prepareNotebook({ notebook, options, signal }) {
      const session = await context.tts.open({ signal });
      let textInstructions: string | undefined;
      try {
        textInstructions = session.textInstructions;
      } finally {
        await session.close();
      }
      const episode = await data.create({
        source: { kind: "notebook", id: notebook.id },
        sourceTitle: notebook.title,
        options,
        key: `notebook:${notebook.id}:${crypto.randomUUID()}`,
      });
      return {
        entity: episode.id,
        instructions: notebookInstructions({ ...options, textInstructions }),
        reminders: NOTEBOOK_REMINDERS,
      };
    },
    async completeNotebook(id, text, task, signal) {
      const episode = await data.get(id);
      if (!episode) throw new Error("这期播客已被删除");
      const parsed = parseScript(text, episode.options.speakers);
      if (!parsed.lines.length) throw new Error("没有解析出可用的对话，请重新生成");
      const draft: Draft = {
        title: parsed.title || episode.title,
        speakers: episode.options.speakers,
        lines: parsed.lines,
      };
      const review = episode.options.review;
      await data.patch(id, () => ({
        draft,
        title: draft.title,
        status: review ? "review" : "synth",
        error: null,
      }));
      if (review) {
        task.phase("脚本已写好，等待审稿");
        return;
      }
      const failure = await execute(id, {
        signal,
        onLive: value => {
          task.phase(PHASE_TEXT[value.phase]);
          task.progress(value.done, value.total);
        },
      });
      signal.throwIfAborted();
      if (failure) throw new Error(failure);
    },
    async failNotebook(id, reason, failure) {
      const episode = await data.get(id);
      if (!episode) return;
      if (reason === "cancelled" && !episode.audio) return data.remove(id);
      await data.patch(id, current =>
        current.status === "ready" || current.status === "review"
          ? null
          : { status: "failed", error: failure }
      );
    },
    async confirmReview(id, draft) {
      await data.patch(id, () => ({ draft, status: "synth", error: null }));
      enqueue(id);
    },
    async resume(id) {
      const episode = await data.get(id);
      if (episode?.source.kind === "notebook" && !episode.draft)
        throw new Error("脚本没有写完，请回到 Notebook 重新生成");
      await data.patch(id, current => ({
        status: current.draft ? "synth" : "script",
        error: null,
      }));
      enqueue(id);
    },
    async discard(id) {
      controllers.get(id)?.abort();
      const index = queue.indexOf(id);
      if (index >= 0) queue.splice(index, 1);
      await settled.get(id);
      segments.delete(id);
      setLive(id, null);
      const episode = await data.get(id);
      if (!episode) return;
      if (!episode.audio) await data.remove(id);
      else
        await data.patch(id, () => ({ status: "ready", error: null, progress: null, draft: null }));
    },
    async redoLine(id, index, text, original) {
      if (controllers.has(id)) throw new Error("这期播客正在处理");
      const controller = new AbortController();
      controllers.set(id, controller);
      const signal = AbortSignal.any([controller.signal, context.signal]);
      setLive(id, { phase: "line", done: index, total: 0 });
      try {
        const episode = await data.get(id);
        const audio = episode?.audio;
        const line = audio?.lines[index];
        if (!episode || !audio || !line) throw new Error("找不到这一句");
        const voiceId = audio.speakers[line.speaker]?.voiceId;
        if (!voiceId) throw new Error("这一句的说话人没有音色");
        const session = await context.tts.open({ signal });
        let replacement: TTSAudio;
        try {
          replacement = await session.synthesize({ text, voiceId }, { signal });
        } finally {
          await session.close();
        }
        const duration = await measure(replacement);
        const merged = await replaceSegment(
          context,
          { original, start: line.start, duration: line.duration, replacement },
          signal
        );
        const url = await saveAudio(context, merged, episode.title, signal);
        const lines: ScriptLine[] = audio.lines.map((item, i) =>
          i === index ? { ...item, text, duration } : item
        );
        const timed = retime(
          lines,
          lines.map(item => item.duration)
        );
        const updated = await data.patch(id, current =>
          current.audio
            ? {
                audio: {
                  ...current.audio,
                  url,
                  lines: timed,
                  duration: timed.reduce((sum, l) => sum + l.duration, 0),
                },
              }
            : null
        );
        if (updated) await data.writeScript(updated).catch(() => undefined);
      } finally {
        controllers.delete(id);
        setLive(id, null);
      }
    },
    live: id => live.get(id) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
