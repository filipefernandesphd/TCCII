#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  ContentError,
  findRepositoryRoot,
  readCourseConfiguration,
} from "./check-content.mjs";

const SEMESTER_PATTERN = /^[0-9]{4}\.[12]$/u;
const LESSON_PATTERN = /^aula-[0-9]{2}$/u;
const TEMPLATE_FILES = [
  "academic.config.ts",
  "global-top.vue",
  "slides.md",
  "style.css",
];
const TEMPLATE_DIRECTORIES = ["components", "layouts"];
const FORBIDDEN_TEMPLATE_NAMES = new Set([".git", "dist", "node_modules"]);
const LOCAL_VITE_CONFIG = path.join("site", "templates", "slidev.vite.config.ts");

function assert(condition, message) {
  if (!condition) {
    throw new ContentError(message);
  }
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertRealFile(target, label) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ContentError(`${label}: arquivo obrigatório ausente no template.`);
    }
    throw error;
  }
  assert(!info.isSymbolicLink(), `${label}: symlink não é aceito no template.`);
  assert(info.isFile(), `${label}: arquivo regular esperado no template.`);
}

async function assertRealDirectory(target, label) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ContentError(`${label}: diretório obrigatório ausente.`);
    }
    throw error;
  }
  assert(!info.isSymbolicLink(), `${label}: symlink não é permitido.`);
  assert(info.isDirectory(), `${label}: diretório real esperado.`);
}

async function assertTreeHasNoSymlinks(directory, label) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const relative = `${label}/${entry.name}`;
    const info = await lstat(target);
    assert(!info.isSymbolicLink(), `${relative}: symlink não é aceito no template.`);
    assert(
      !FORBIDDEN_TEMPLATE_NAMES.has(entry.name),
      `${relative}: infraestrutura do template não pode ser copiada.`,
    );
    if (info.isDirectory()) {
      await assertTreeHasNoSymlinks(target, relative);
    }
  }
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new ContentError(`Não foi possível executar Git: ${error.message}.`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const detail = stderr.trim().split(/\r?\n/u).at(-1);
      reject(
        new ContentError(
          `Git falhou${signal ? ` com sinal ${signal}` : ` (código ${code})`}` +
            `${detail ? `: ${detail}` : "."}`,
        ),
      );
    });
  });
}

async function prepareSlides(root, templateDirectory, stagingDirectory, revision) {
  const slidesDirectory = path.join(stagingDirectory, "slides");
  await mkdir(slidesDirectory);

  for (const name of TEMPLATE_FILES) {
    const source = path.join(templateDirectory, name);
    await assertRealFile(source, name);
    await cp(source, path.join(slidesDirectory, name), {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
  }

  for (const name of TEMPLATE_DIRECTORIES) {
    const source = path.join(templateDirectory, name);
    await assertRealDirectory(source, name);
    await assertTreeHasNoSymlinks(source, name);
    await cp(source, path.join(slidesDirectory, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }

  const viteConfig = path.join(root, LOCAL_VITE_CONFIG);
  await assertRealFile(viteConfig, LOCAL_VITE_CONFIG);
  await cp(viteConfig, path.join(slidesDirectory, "vite.config.ts"), {
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });

  await writeFile(
    path.join(slidesDirectory, ".slidev-template-revision"),
    `${revision}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

async function copyPreparedLesson(stagingDirectory, targetDirectory) {
  await mkdir(targetDirectory);
  try {
    for (const entry of await readdir(stagingDirectory)) {
      await cp(
        path.join(stagingDirectory, entry),
        path.join(targetDirectory, entry),
        {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        },
      );
    }
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function createLesson(options) {
  const semester = options.semester;
  const lesson = options.lesson;
  assert(
    typeof semester === "string" && SEMESTER_PATTERN.test(semester),
    "Semestre inválido; use AAAA.1 ou AAAA.2.",
  );
  assert(
    typeof lesson === "string" && LESSON_PATTERN.test(lesson),
    "Aula inválida; use aula-NN.",
  );

  const root = options.root
    ? path.resolve(options.root)
    : await findRepositoryRoot(process.cwd());
  const { config } = await readCourseConfiguration(root);
  const semesterDirectory = path.join(root, semester);
  const targetDirectory = path.join(semesterDirectory, lesson);
  await assertRealDirectory(semesterDirectory, semester);
  assert(
    !(await pathExists(targetDirectory)),
    `${semester}/${lesson}: a aula já existe; nada foi sobrescrito.`,
  );

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "course-slidev-template-"),
  );
  const templateDirectory = path.join(temporaryRoot, "template");
  const stagingDirectory = path.join(temporaryRoot, "lesson");

  try {
    await runGit(
      [
        "clone",
        "--no-checkout",
        "--filter=blob:none",
        "--no-tags",
        config.slides.templateRepository,
        templateDirectory,
      ],
      root,
    );
    await runGit(
      [
        "-C",
        templateDirectory,
        "checkout",
        "--detach",
        config.slides.templateRevision,
      ],
      root,
    );
    const checkedOutRevision = await runGit(
      ["-C", templateDirectory, "rev-parse", "HEAD"],
      root,
    );
    assert(
      checkedOutRevision === config.slides.templateRevision,
      "A revisão obtida do template diverge de course.config.json.",
    );

    await mkdir(stagingDirectory);
    await prepareSlides(
      root,
      templateDirectory,
      stagingDirectory,
      checkedOutRevision,
    );

    assert(
      !(await pathExists(targetDirectory)),
      `${semester}/${lesson}: a aula passou a existir durante a preparação; nada foi sobrescrito.`,
    );
    await copyPreparedLesson(stagingDirectory, targetDirectory);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  return {
    root,
    semester,
    lesson,
    target: path.relative(root, targetDirectory),
    templateRepository: config.slides.templateRepository,
    templateRevision: config.slides.templateRevision,
  };
}

function parseArguments(argv) {
  const positional = [];
  const options = { root: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--root") {
      index += 1;
      assert(index < argv.length, "--root exige um caminho.");
      options.root = argv[index];
    } else if (argument.startsWith("-")) {
      throw new ContentError(`Argumento desconhecido: ${argument}.`);
    } else {
      positional.push(argument);
    }
  }
  if (!options.help) {
    assert(
      positional.length === 2,
      "Informe exatamente o semestre e a aula.",
    );
    [options.semester, options.lesson] = positional;
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Uso: node scripts/new-lesson.mjs [--root CAMINHO] AAAA.S aula-NN",
      "",
      "Clona o template configurado, fixa sua revisão e cria uma aula nova.",
      "",
    ].join("\n"),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await createLesson(options);
  process.stdout.write(
    `Aula criada em ${result.target} com o template na revisão ` +
      `${result.templateRevision}.\n`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    const prefix = error instanceof ContentError ? "Aula não criada" : "Erro";
    process.stderr.write(`${prefix}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
