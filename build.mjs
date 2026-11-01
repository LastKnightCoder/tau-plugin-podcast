import { buildPortablePluginManifest, PORTABLE_SHARED_MODULES } from "@tau/plugins/portable";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import AdmZip from "adm-zip";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { isBuiltin } from "node:module";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

async function collectSkills(staging) {
  let folders;
  try {
    folders = (await readdir("skills", { withFileTypes: true }))
      .filter(entry => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === "ENOENT") return { ids: [], files: [] };
    throw error;
  }
  const ids = [];
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(relative, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__"].includes(entry.name))
        continue;
      const file = `${relative}/${entry.name}`;
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`Skill 不能包含符号链接：${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        await mkdir(path.dirname(path.join(staging, file)), {
          recursive: true,
        });
        await cp(file, path.join(staging, file));
        files.push(file);
      }
    }
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) throw new Error(`skills 下只能放 Skill 目录：${folder.name}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(folder.name))
      throw new Error(`Skill 目录名只能使用字母、数字、点、横线和下划线：${folder.name}`);
    const readme = await readFile(`skills/${folder.name}/SKILL.md`, "utf8").catch(() => null);
    if (readme === null) throw new Error(`skills/${folder.name} 缺少 SKILL.md`);
    const front = readme.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front || !/^description:\s*\S/m.test(front[1]))
      throw new Error(
        `skills/${folder.name}/SKILL.md 需要在开头的 front matter 中填写 description`
      );
    ids.push(folder.name);
    await walk(`skills/${folder.name}`);
  }
  return { ids, files };
}

const shared = [...PORTABLE_SHARED_MODULES];
await mkdir("dist", { recursive: true });
const staging = await mkdtemp(path.resolve("dist/.building-"));
const buildId = randomUUID();
const pointer = path.resolve("dist", `.building-pointer-${buildId}`);
try {
  const readme = await readFile("README.md", "utf8");
  if (!readme.trim()) throw new Error("README.md 必须包含插件介绍与使用说明");
  if (typeof manifest.description !== "string" || !manifest.description.trim())
    throw new Error("manifest.description 必须为非空简介");
  await writeFile(path.join(staging, "README.md"), readme);
  for (const name of ["LICENSE", "CHANGELOG.md"]) {
    try {
      await writeFile(path.join(staging, name), await readFile(name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const skills = await collectSkills(staging);
  const result = await build({
    entryPoints: ["src/index.tsx"],
    outfile: path.join(staging, "main.js"),
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    external: shared,
    metafile: true,
    loader: { ".svg": "dataurl" },
    define: {
      "process.env.NODE_ENV": '"production"',
      __PLUGIN_META__: JSON.stringify({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      }),
    },
  });
  for (const output of Object.values(result?.metafile.outputs ?? {})) {
    for (const dependency of output.imports) {
      // 第三方样式里内联的 data: 字体不是外部依赖
      if (
        dependency.external &&
        !shared.includes(dependency.path) &&
        !dependency.path.startsWith("data:")
      )
        throw new Error(`插件构建包含未支持的外部依赖：${dependency.path}`);
    }
  }
  // 组件的 Tailwind 类由插件自己编译，接在打包出的样式之后
  const tailwind = await compile(await readFile("src/tailwind.css", "utf8"), {
    base: path.resolve("src"),
    onDependency() {},
  });
  const bundledCss = await readFile(path.join(staging, "main.css"), "utf8").catch(() => "");
  const utilities = tailwind.build(new Scanner({ sources: tailwind.sources }).scan());
  // 不带前缀的工具类会覆盖 Tau 与博客模板的同名类（如模板的 md:flex 被 .hidden 盖掉）
  const bare = [
    ...utilities.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.((?:\\.|[A-Za-z_-])(?:\\.|[\w-])*)/g),
  ]
    .map(match => match[1].replace(/\\(.)/g, "$1"))
    .filter(name => !name.startsWith("pc:"));
  if (bare.length) throw new Error(`Tailwind 类名需要 pc: 前缀：${[...new Set(bare)].join(" ")}`);
  await writeFile(path.join(staging, "main.css"), bundledCss + utilities);
  const styles = true;
  const integrity = {};
  for (const file of ["main.js", ...(styles ? ["main.css"] : []), ...skills.files])
    integrity[file] = createHash("sha256")
      .update(await readFile(path.join(staging, file)))
      .digest("hex");
  const packaged = buildPortablePluginManifest(manifest, {
    main: "main.js",
    integrity,
    ...(styles ? { styles: "main.css" } : {}),
    ...(skills.ids.length ? { skills: skills.ids } : {}),
  });
  await writeFile(path.join(staging, "manifest.json"), JSON.stringify(packaged, null, 2));
  const destination = path.resolve("dist", `${manifest.version}-${buildId}`);
  await rename(staging, destination);
  await writeFile(
    pointer,
    JSON.stringify({
      formatVersion: 1,
      id: manifest.id,
      buildId,
      directory: path.basename(destination),
    })
  );
  await rename(pointer, path.resolve("dist", `tau-build-${manifest.id}.json`));
  const zip = new AdmZip();
  zip.addLocalFolder(destination, manifest.id);
  const archive = path.resolve("dist", `${manifest.id}-${manifest.version}.zip`);
  zip.writeZip(archive);
  console.log(`构建完成：${archive}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
} finally {
  await rm(pointer, { force: true });
}
