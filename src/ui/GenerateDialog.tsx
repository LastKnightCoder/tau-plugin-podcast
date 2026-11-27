/**
 * 卡片、文章、项目文档的生成对话框：只问形式、谁来说、多长；标题由 AI 起。
 * 打开时检查脚本模型与语音服务，缺哪个就只显示对应的引导；「生成」后立即关闭，任务在后台跑。
 */
import { useEffect, useRef, useState } from "react";
import { AudioLines, Podcast, Settings2, Sparkles } from "lucide-react";
import { useI18n } from "@tau/plugins";
import { Button, Dialog, DialogBody, Input, toast } from "@tau/ui";
import type { Episode, PickableKind } from "../data/model";
import { messages } from "../i18n";
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
  const { t } = useI18n(messages);
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

  const blocker = voices.kind === "ready" ? formBlocker(t, form) : null;
  const ready = model === "ok" && voices.kind === "ready";

  const submit = async () => {
    if (!ready || blocker) return;
    setSubmitting(true);
    try {
      const options = { ...trimForm(form), focus: focus.trim() };
      await jobs.start({ source, sourceTitle, options });
      await saveForm(context, options);
      onClose();
      toast.success(t("dialog.started"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("dialog.startFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const SourceIcon = SOURCE_META[source.kind].icon;
  const footer =
    model === "missing" ? (
      <>
        <Button size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Settings2}
          onClick={() => context.ai.openSettings(AI_FEATURE)}
        >
          {t("dialog.pickModel")}
        </Button>
      </>
    ) : voices.kind === "no-tts" ? (
      <Button size="sm" onClick={onClose}>
        {t("dialog.acknowledge")}
      </Button>
    ) : (
      <>
        <Button size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={AudioLines}
          disabled={!ready || !!blocker}
          loading={submitting}
          onClick={() => void submit()}
        >
          {episode?.audio ? t("dialog.regenerate") : t("dialog.generate")}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && onClose()}
      title={episode?.audio ? t("dialog.title.regenerate") : t("dialog.title.generate")}
      icon={<Podcast size={16} strokeWidth={1.75} />}
      width={560}
      impact={
        voices.kind === "ready"
          ? (blocker ?? t("dialog.voiceProvider", { name: voices.providerName }))
          : undefined
      }
      footer={footer}
    >
      <DialogBody>
        <div className="pc:flex pc:flex-col pc:gap-4 pc:pt-1">
          <div className="pc:bg-hover pc:rounded-tau-sm pc:flex pc:items-center pc:gap-2 pc:px-2.5 pc:py-2 pc:text-[12.5px]">
            <SourceIcon {...ICON} className="pc:text-ink-3 pc:shrink-0" />
            <b className="pc:min-w-0 pc:truncate pc:font-medium">
              {sourceTitle || t("dialog.untitled")}
            </b>
            <span className="pc:text-ink-3 pc:ml-auto pc:shrink-0 pc:text-[12px]">
              {t(SOURCE_META[source.kind].key)}
            </span>
          </div>

          {model === "missing" ? (
            <Notice icon={<Sparkles {...ICON} />} title={t("dialog.noModel")}>
              {t("dialog.noModelHint")}
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
                <Field label={t("options.focus")} hint={t("options.focusHint")}>
                  <Input
                    size="sm"
                    value={focus}
                    maxLength={200}
                    placeholder={t("options.focusPlaceholder")}
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
