/**
 * Notebook 输出：Tau 的生成对话框里放的选项区（与卡片入口同一套表单，「额外要求」由 Tau 提供），
 * 以及产物在 Notebook 阅读区里的显示（单期详情，不带「全部播客」返回）。
 */
import { useEffect, useRef, useState } from "react";
import type {
  JsonValue,
  PluginNotebookOutputOptionsProps,
  PluginNotebookOutputViewProps,
} from "@tau/plugins";
import { Loading } from "@tau/ui";
import { readEpisode } from "../data/model";
import { useRuntime } from "../runtime";
import { DetailView } from "./DetailView";
import { usePlayback } from "./playback";
import { useEpisode, useSourceStates } from "./queries";
import { sourceKey } from "../data/model";
import {
  NoTTSNotice,
  OPTIONS_KEY,
  PodcastOptionsForm,
  VoicesLoading,
  formBlocker,
  readForm,
  trimForm,
  useVoices,
  type PodcastForm,
} from "./PodcastOptions";

export function NotebookOptions({
  context,
  onChange,
  setBlocker,
}: PluginNotebookOutputOptionsProps) {
  const [form, setForm] = useState<PodcastForm | null>(null);
  const voices = useVoices(context, true);
  const report = useRef({ onChange, setBlocker });
  report.current = { onChange, setBlocker };

  useEffect(() => {
    let active = true;
    void context.storage.get(OPTIONS_KEY).then(saved => {
      if (active) setForm(readForm(saved));
    });
    return () => {
      active = false;
    };
  }, [context]);

  useEffect(() => {
    if (form) report.current.onChange(trimForm(form) as unknown as JsonValue);
    report.current.setBlocker(
      voices.kind === "no-tts"
        ? "还没有可用的语音合成服务"
        : voices.kind === "loading" || !form
          ? "正在读取音色"
          : formBlocker(form)
    );
  }, [form, voices.kind]);

  if (voices.kind === "no-tts") return <NoTTSNotice reason={voices.reason} />;
  if (voices.kind === "loading" || !form) return <VoicesLoading />;
  return (
    <div className="pc:flex pc:flex-col pc:gap-4">
      <PodcastOptionsForm form={form} onChange={setForm} voices={voices} />
    </div>
  );
}

export function NotebookEpisodeView({ entity }: PluginNotebookOutputViewProps) {
  const runtime = useRuntime();
  const query = useEpisode(entity.id);
  const episode = query.data ?? readEpisode(entity);
  const states = useSourceStates(episode ? [episode] : []);
  const playback = usePlayback(episode?.audio?.url ?? null, episode?.audio?.duration ?? 0);
  if (!episode) return query.isLoading ? <Loading /> : null;
  return (
    <>
      {playback.element}
      <DetailView
        embedded
        episode={episode}
        sourceState={states.data?.get(sourceKey(episode.source))}
        playback={playback}
        onBack={() => void runtime.pages.library?.open({ episode: episode.id })}
        onReview={() => void runtime.pages.library?.open({ episode: episode.id, review: "1" })}
      />
    </>
  );
}
