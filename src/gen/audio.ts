/**
 * 音频处理：逐段时长用浏览器解码测量，拼接与替换单段交给宿主 FFmpeg，统一编码为 MP3。
 */
import type { PluginContext, TTSAudio } from "@tau/plugins";

const EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/pcm": "pcm",
};
const extOf = (mime: string) => EXT[mime.toLowerCase()] ?? "mp3";

/** 一段合成音频的实际时长（秒） */
export async function measure(audio: TTSAudio): Promise<number> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(audio.audio.slice().buffer as ArrayBuffer);
    return buffer.duration;
  } finally {
    await context.close();
  }
}

/** 按顺序拼成一个 MP3 */
export async function concat(
  context: PluginContext,
  segments: readonly TTSAudio[],
  signal: AbortSignal
): Promise<Blob> {
  const files = segments.map((segment, i) => ({
    name: `s${i}.${extOf(segment.mime)}`,
    data: new Blob([segment.audio.slice()], { type: segment.mime }),
  }));
  const inputs = files.flatMap(file => ["-i", file.name]);
  const filter = `${files.map((_, i) => `[${i}:a]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  const { files: outputs } = await context.services.ffmpeg.run(
    {
      files,
      args: [
        ...inputs,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "out.mp3",
      ],
      outputs: [{ name: "out.mp3", mimeType: "audio/mpeg" }],
    },
    { signal }
  );
  return outputs[0].data;
}

/** 把整期音频中 [start, start + duration) 一段换成新合成的音频 */
export async function replaceSegment(
  context: PluginContext,
  input: { original: Blob; start: number; duration: number; replacement: TTSAudio },
  signal: AbortSignal
): Promise<Blob> {
  const end = input.start + input.duration;
  const segmentName = `new.${extOf(input.replacement.mime)}`;
  const filter = [
    `[0:a]atrim=0:${input.start.toFixed(3)},asetpts=PTS-STARTPTS[a]`,
    `[0:a]atrim=start=${end.toFixed(3)},asetpts=PTS-STARTPTS[c]`,
    `[a][1:a][c]concat=n=3:v=0:a=1[out]`,
  ].join(";");
  const { files } = await context.services.ffmpeg.run(
    {
      files: [
        { name: "orig.mp3", data: input.original },
        {
          name: segmentName,
          data: new Blob([input.replacement.audio.slice()], { type: input.replacement.mime }),
        },
      ],
      args: [
        "-i",
        "orig.mp3",
        "-i",
        segmentName,
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "out.mp3",
      ],
      outputs: [{ name: "out.mp3", mimeType: "audio/mpeg" }],
    },
    { signal }
  );
  return files[0].data;
}

export async function saveAudio(
  context: PluginContext,
  blob: Blob,
  title: string,
  signal: AbortSignal
): Promise<string> {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "podcast";
  return context.upload.save(
    {
      name: `${safe}.mp3`,
      mimeType: "audio/mpeg",
      content: new Uint8Array(await blob.arrayBuffer()),
    },
    { signal }
  );
}
