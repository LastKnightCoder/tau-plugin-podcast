/**
 * 卡片、文章、项目文档的生成对话框：只问形式、谁来说、多长；标题由 AI 起。
 * 打开时检查脚本模型与语音服务，缺哪个就只显示对应的引导；「生成」后立即关闭，任务在后台跑。
 */
import { useEffect, useRef, useState } from "react";
import { AudioLines, Podcast, Settings2, Sparkles } from "lucide-react";
import { Button, Dialog, DialogBody, Input, toast } from "@tau/ui";
import type { Episode, PickableKind } from "../data/model";
import { AI_FEATURE } from "../gen/jobs";
import { useRuntime } from "../runtime";
import { ICON, SOURCE_META } from "./bits";
import {
  Field,
  NoTTSNotice,
  Notice,
  OPTIONS_KEY,
  PodcastOptionsForm,
  VoicesLoading,
  formBlocker,
  readForm,
  saveForm,
  trimForm,
  useVoices,
  type PodcastForm,
} from "./PodcastOptions";

export function GenerateDialog({
  open,
  source,
  sourceTitle,
  episode,
  onClose,
}: {
  open: boolean;
  source: { kind: PickableKind; id: string };
  sourceTitle: string;
  episode?: Episode | null;
  onClose(): void;
}) {
  const { context, jobs } = useRuntime();
  const [model, setModel] = useState<"loading" | "missing" | "ok">("loading");
  const [form, setForm] = useState<PodcastForm>(() => readForm(undefined));
  const [focus, setFocus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const voices = useVoices(context, open && model === "ok");
  // 查询刷新会换掉 episode 对象；对话框只在打开时读一次，不因刷新重置表单
  const episodeRef = useRef(episode);
  episodeRef.current = episode;
  const episodeId = episode?.id;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setModel("loading");
    void (async () => {
      const initial = episodeRef.current;
      const saved = initial ? initial.options : await context.storage.get(OPTIONS_KEY);
      if (!active) return;
      setForm(readForm(saved));
      setFocus(initial?.options.focus ?? "");
      const status = await context.ai.getStatus(AI_FEATURE).catch(() => null);
      if (active) setModel(status?.configured && status.enabled ? "ok" : "missing");
    })();
    return () => {
      active = false;
    };
  }, [open, context, episodeId]);

  const blocker = voices.kind === "ready" ? formBlocker(form) : null;
  const ready = model === "ok" && voices.kind === "ready";

  const submit = async () => {
    if (!ready || blocker) return;
    setSubmitting(true);
    try {
      const options = { ...trimForm(form), focus: focus.trim() };
      await jobs.start({ source, sourceTitle, options });
      await saveForm(context, options);
      onClose();
      toast.success("已开始生成，可以离开这个页面");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "开始生成失败");
    } finally {
      setSubmitting(false);
    }
  };

  const SourceIcon = SOURCE_META[source.kind].icon;
  const footer =
    model === "missing" ? (
      <>
        <Button size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Settings2}
          onClick={() => context.ai.openSettings(AI_FEATURE)}
        >
          去选模型
        </Button>
      </>
    ) : voices.kind === "no-tts" ? (
      <Button size="sm" onClick={onClose}>
        知道了
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={AudioLines}
          disabled={!ready || !!blocker}
          loading={submitting}
          onClick={() => void submit()}
        >
          {episode?.audio ? "重新生成" : "生成"}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && onClose()}
      title={episode?.audio ? "重新生成播客" : "生成播客"}
      icon={<Podcast size={16} strokeWidth={1.75} />}
      width={560}
      impact={voices.kind === "ready" ? (blocker ?? `语音：${voices.providerName}`) : undefined}
      footer={footer}
    >
      <DialogBody>
        <div className="pc:flex pc:flex-col pc:gap-4 pc:pt-1">
          <div className="pc:bg-hover pc:rounded-tau-sm pc:flex pc:items-center pc:gap-2 pc:px-2.5 pc:py-2 pc:text-[12.5px]">
            <SourceIcon {...ICON} className="pc:text-ink-3 pc:shrink-0" />
            <b className="pc:min-w-0 pc:truncate pc:font-medium">{sourceTitle || "未命名"}</b>
            <span className="pc:text-ink-3 pc:ml-auto pc:shrink-0 pc:text-[12px]">
              {SOURCE_META[source.kind].label}
            </span>
          </div>

          {model === "missing" ? (
            <Notice icon={<Sparkles {...ICON} />} title="还没给「播客脚本」选模型">
              播客插件用 AI 把原文改写成对话脚本。在插件的 AI
              配置里选一个已配置的模型并开启，用量计入插件的每日额度。
            </Notice>
          ) : voices.kind === "no-tts" ? (
            <NoTTSNotice reason={voices.reason} />
          ) : voices.kind === "loading" ? (
            <VoicesLoading />
          ) : (
            <PodcastOptionsForm
              form={form}
              onChange={setForm}
              voices={voices}
              extra={
                <Field label="想多聊点什么" hint="选填">
                  <Input
                    size="sm"
                    value={focus}
                    maxLength={200}
                    placeholder="例如：多举例子，少讲公式"
                    onChange={event => setFocus(event.target.value)}
                  />
                </Field>
              }
            />
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}
