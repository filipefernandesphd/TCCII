#!/usr/bin/env node

import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const SEMESTER_PATTERN = /^[0-9]{4}\.[12]$/u;
const SEMESTER_LIKE_PATTERN = /^[0-9]{4}\./u;
const LESSON_PATTERN = /^aula-[0-9]{2}$/u;
const LESSON_LIKE_PATTERN = /^aula(?:-|$)/iu;
const DATE_PATTERN = /^(?:|[0-9]{2}\/[0-9]{2}\/[0-9]{4})$/u;
const SCHEDULE_FIELDS = ["day", "date", "module", "topic", "id"];
const REQUIRED_SLIDE_FILES = [
  ".slidev-template-revision",
  "academic.config.ts",
  "global-top.vue",
  "slides.md",
  "style.css",
  "vite.config.ts",
];
const REQUIRED_SLIDE_DIRECTORIES = ["components", "layouts"];
const FORBIDDEN_CONTENT_NAMES = new Set([".git", "node_modules", "_site"]);
const FORBIDDEN_SLIDE_ROOT_NAMES = new Set([
  "AGENTS.md",
  "dist",
  "package-lock.json",
  "package.json",
  "prompts",
  "skills",
]);
const FORBIDDEN_PUBLIC_ASSET_NAMES = new Set([
  ".env",
  ".git",
  ".gitignore",
  "AGENTS.md",
  "INSTRUCTIONS.md",
  "README.md",
  "_site",
  "dist",
  "node_modules",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "yarn.lock",
]);

export class ContentError extends Error {
  constructor(message, code = "INVALID_CONTENT") {
    super(message);
    this.name = "ContentError";
    this.code = code;
  }
}

function assert(condition, message, code) {
  if (!condition) {
    throw new ContentError(message, code);
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

export async function findRepositoryRoot(start = process.cwd()) {
  let candidate = path.resolve(start);

  for (;;) {
    if (
      (await pathExists(path.join(candidate, "course.config.json"))) &&
      (await pathExists(path.join(candidate, "AGENTS.md")))
    ) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    assert(
      parent !== candidate,
      "Raiz do repositório não encontrada.",
      "REPOSITORY_NOT_FOUND",
    );
    candidate = parent;
  }
}

function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  assert(
    relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `${label}: caminho fora da raiz do repositório.`,
  );
}

async function assertRealFile(target, label) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ContentError(`${label}: arquivo obrigatório ausente.`);
    }
    throw error;
  }
  assert(!info.isSymbolicLink(), `${label}: link simbólico não é permitido.`);
  assert(info.isFile(), `${label}: arquivo regular esperado.`);
  return info;
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
  assert(!info.isSymbolicLink(), `${label}: link simbólico não é permitido.`);
  assert(info.isDirectory(), `${label}: diretório real esperado.`);
  return info;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ContentError(`${label}: JSON inválido (${error.message}).`);
  }
}

function matchesJsonType(value, type) {
  if (type === "object") {
    return isPlainObject(value);
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "null") {
    return value === null;
  }
  return typeof value === type;
}

function validateAgainstSchema(value, schema, label, instancePath = "$") {
  assert(isPlainObject(schema), `${label}: schema inválido em ${instancePath}.`);

  if (Object.hasOwn(schema, "const")) {
    assert(
      Object.is(value, schema.const),
      `${label}: ${instancePath} deve ser ${JSON.stringify(schema.const)}.`,
    );
  }

  if (schema.type !== undefined) {
    const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(
      accepted.some((type) => matchesJsonType(value, type)),
      `${label}: tipo inválido em ${instancePath}; esperado ${accepted.join(" ou ")}.`,
    );
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined) {
      assert(
        value.length >= schema.minLength,
        `${label}: texto curto demais em ${instancePath}.`,
      );
    }
    if (schema.pattern !== undefined) {
      let expression;
      try {
        expression = new RegExp(schema.pattern, "u");
      } catch (error) {
        throw new ContentError(
          `${label}: pattern inválido em ${instancePath} (${error.message}).`,
          "INVALID_SCHEMA",
        );
      }
      assert(
        expression.test(value),
        `${label}: formato inválido em ${instancePath}.`,
      );
    }
    if (schema.format === "uri") {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new ContentError(`${label}: URI inválida em ${instancePath}.`);
      }
      assert(
        parsed.protocol !== "",
        `${label}: URI absoluta esperada em ${instancePath}.`,
      );
    }
  }

  if (typeof value === "number" && schema.exclusiveMinimum !== undefined) {
    assert(
      value > schema.exclusiveMinimum,
      `${label}: ${instancePath} deve ser maior que ${schema.exclusiveMinimum}.`,
    );
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      validateAgainstSchema(item, schema.items, label, `${instancePath}/${index}`);
    });
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const required of schema.required ?? []) {
      assert(
        Object.hasOwn(value, required),
        `${label}: campo obrigatório ausente em ${instancePath}/${required}.`,
      );
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert(
          Object.hasOwn(properties, key),
          `${label}: campo desconhecido em ${instancePath}/${key}.`,
        );
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateAgainstSchema(
          value[key],
          childSchema,
          label,
          `${instancePath}/${key}`,
        );
      }
    }
  }
}

function validateSchemaDocument(schema, label, expectedId) {
  assert(isPlainObject(schema), `${label}: objeto esperado.`, "INVALID_SCHEMA");
  assert(
    schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${label}: use JSON Schema Draft 2020-12.`,
    "INVALID_SCHEMA",
  );
  assert(schema.$id === expectedId, `${label}: $id deve ser ${expectedId}.`);
  assert(schema.type === "object", `${label}: a raiz deve usar type object.`);
  assert(
    isPlainObject(schema.properties),
    `${label}: properties deve ser um objeto.`,
  );
  assert(Array.isArray(schema.required), `${label}: required deve ser uma lista.`);
}

export async function readCourseConfiguration(root) {
  const configPath = path.join(root, "course.config.json");
  const schemaPath = path.join(root, "course.config.schema.json");
  await assertRealFile(configPath, "course.config.json");
  await assertRealFile(schemaPath, "course.config.schema.json");

  const schema = parseJson(
    await readFile(schemaPath, "utf8"),
    "course.config.schema.json",
  );
  validateSchemaDocument(
    schema,
    "course.config.schema.json",
    "course.config.schema.json",
  );

  const config = parseJson(
    await readFile(configPath, "utf8"),
    "course.config.json",
  );
  validateAgainstSchema(config, schema, "course.config.json");
  assert(
    config.$schema === "./course.config.schema.json",
    "course.config.json: $schema deve ser ./course.config.schema.json.",
  );
  assert(
    config.repository.url ===
      `https://github.com/${config.repository.owner}/${config.repository.name}`,
    "course.config.json: repository.url diverge de owner/name.",
  );
  assert(
    typeof config.slides.templateRepository === "string" &&
      config.slides.templateRepository.trim() ===
        config.slides.templateRepository &&
      config.slides.templateRepository !== "" &&
      !config.slides.templateRepository.startsWith("-") &&
      !/[\0\r\n]/u.test(config.slides.templateRepository),
    "course.config.json: slides.templateRepository é inválido.",
  );
  return { config, schema };
}

async function readScheduleSchema(root) {
  const schemaPath = path.join(root, "schedule.schema.json");
  await assertRealFile(schemaPath, "schedule.schema.json");
  const schema = parseJson(
    await readFile(schemaPath, "utf8"),
    "schedule.schema.json",
  );
  validateSchemaDocument(schema, "schedule.schema.json", "schedule.schema.json");
  return schema;
}

function isValidCalendarDate(value) {
  if (value === "") {
    return true;
  }
  const [day, month, year] = value.split("/").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateSchedule(schedule, semester, label) {
  assert(
    schedule.$schema === "../schedule.schema.json",
    `${label}: $schema deve ser ../schedule.schema.json.`,
  );
  assert(schedule.semester === semester, `${label}: semester deve ser ${semester}.`);
  assert(
    typeof schedule.source.tab === "string" &&
      schedule.source.tab.trim() !== "",
    `${label}: source.tab não pode estar vazio.`,
  );

  schedule.entries.forEach((entry, index) => {
    const entryLabel = `${label}/entries/${index}`;
    for (const field of SCHEDULE_FIELDS) {
      assert(
        typeof entry[field] === "string" && !/[\r\n]/u.test(entry[field]),
        `${entryLabel}/${field}: texto sem quebra de linha esperado.`,
      );
    }
    assert(
      DATE_PATTERN.test(entry.date) && isValidCalendarDate(entry.date),
      `${entryLabel}/date: use uma data real em dd/mm/aaaa ou deixe vazio.`,
    );
    assert(
      entry.id === "" || LESSON_PATTERN.test(entry.id),
      `${entryLabel}/id: use aula-NN ou deixe vazio.`,
    );
    assert(
      entry.id === "" || entry.topic.trim() !== "",
      `${entryLabel}/topic: tópico obrigatório quando ID estiver preenchido.`,
    );
  });
}

function normalizeHeadingText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function scanHeadings(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headings = [];
  let fence = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { character: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
      return;
    }
    if (fence !== null) {
      return;
    }
    const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
    if (match) {
      headings.push({
        index,
        level: match[1].length,
        text: match[2],
      });
    }
  });
  return { headings, lines };
}

function extractUniqueSection(markdown, headingName, label) {
  const { headings, lines } = scanHeadings(markdown);
  const wanted = normalizeHeadingText(headingName);
  const matches = headings.filter(
    (heading) => normalizeHeadingText(heading.text) === wanted,
  );
  assert(matches.length === 1, `${label}: deve haver uma única seção ${headingName}.`);
  const heading = matches[0];
  const next = headings.find(
    (candidate) =>
      candidate.index > heading.index && candidate.level <= heading.level,
  );
  return lines.slice(heading.index + 1, next?.index ?? lines.length).join("\n");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeMarkdownCell(value) {
  return escapeHtml(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function escapeMarkdownLinkText(value) {
  return escapeMarkdownCell(value).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function renderScheduleTable(schedule, lessons) {
  const lines = [
    "| Dia | Data | Módulo | Tópico |",
    "|---|---|---|---|",
  ];
  for (const entry of schedule.entries) {
    const topic =
      entry.id !== "" && lessons.has(entry.id)
        ? `[${escapeMarkdownLinkText(entry.topic)}](${entry.id}/)`
        : escapeMarkdownCell(entry.topic);
    lines.push(
      `| ${escapeMarkdownCell(entry.day)} | ${escapeMarkdownCell(entry.date)} | ` +
        `${escapeMarkdownCell(entry.module)} | ${topic} |`,
    );
  }
  return lines.join("\n");
}

function normalizeSectionBody(value) {
  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim();
}

function assertReadmeMetadata(readme, config, label, semester) {
  const expectedHeading =
    semester === undefined
      ? `# ${config.course.name} (${config.course.acronym})`
      : `# ${config.course.name} (${config.course.acronym}) — ${semester.replace(".", "/")}`;
  assert(
    readme.replaceAll("\r\n", "\n").split("\n")[0].trim() === expectedHeading,
    `${label}: título deve ser "${expectedHeading}".`,
  );

  for (const [field, value] of [
    ["instituição", config.course.institution.name],
    ["campus", config.course.institution.campus],
    ["curso", config.course.program],
    ["código", config.course.code],
    ["disciplina", config.course.name],
    ["modalidade", config.course.modality],
    ["carga horária", `${config.course.workloadHours}h`],
    ["professor", config.course.instructor.name],
    ["URL da instituição", config.course.institution.url],
    ["URL do professor", config.course.instructor.url],
  ]) {
    assert(readme.includes(String(value)), `${label}: ${field} diverge da configuração.`);
  }
}

function validateRootSemesterLinks(readme, semesters) {
  const section = extractUniqueSection(readme, "Turmas", "README.md");
  const links = [];
  const expression = /\[([^\]]+)\]\(([^)]+)\)/gu;
  for (const match of section.matchAll(expression)) {
    const targetMatch = match[2].match(/^([0-9]{4}\.[12])\/?$/u);
    assert(
      targetMatch !== null,
      `README.md/Turmas: link inesperado: ${match[2]}.`,
    );
    assert(
      match[1] === targetMatch[1].replace(".", "/"),
      `README.md/Turmas: rótulo incorreto para ${targetMatch[1]}.`,
    );
    links.push(targetMatch[1]);
  }
  assert(
    links.length === new Set(links).size,
    "README.md/Turmas: semestre duplicado.",
  );
  const expected = [...semesters].sort();
  const actual = [...links].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `README.md/Turmas: esperado ${expected.join(", ") || "(nenhum)"}; ` +
      `encontrado ${actual.join(", ") || "(nenhum)"}.`,
  );
}

async function assertNoSymlinksOrInfrastructure(directory, root) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const relative = path.relative(root, target);
    const info = await lstat(target);
    assert(!info.isSymbolicLink(), `${relative}: link simbólico não é permitido.`);
    assert(
      !FORBIDDEN_CONTENT_NAMES.has(entry.name),
      `${relative}: infraestrutura não pode fazer parte do conteúdo.`,
    );
    if (info.isDirectory()) {
      await assertNoSymlinksOrInfrastructure(target, root);
    }
  }
}

async function validateSemesterAssets(root, semester) {
  const directory = path.join(root, semester, "assets");
  if (!(await pathExists(directory))) {
    return;
  }
  await assertRealDirectory(directory, `${semester}/assets`);

  async function walk(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const target = path.join(parent, entry.name);
      const relative = path.relative(root, target);
      const info = await lstat(target);
      assert(!info.isSymbolicLink(), `${relative}: link simbólico não é permitido.`);
      assert(
        !entry.name.startsWith(".") &&
          !FORBIDDEN_PUBLIC_ASSET_NAMES.has(entry.name),
        `${relative}: arquivo não permitido nos ativos publicados.`,
      );
      if (info.isDirectory()) {
        await walk(target);
      } else {
        assert(info.isFile(), `${relative}: arquivo regular esperado.`);
      }
    }
  }

  await walk(directory);
}

async function discoverSemesters(root) {
  const semesters = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (SEMESTER_PATTERN.test(entry.name)) {
      await assertRealDirectory(path.join(root, entry.name), entry.name);
      semesters.push(entry.name);
    } else if (SEMESTER_LIKE_PATTERN.test(entry.name)) {
      throw new ContentError(
        `${entry.name}: nome semelhante a semestre, mas fora do padrão AAAA.1/AAAA.2.`,
      );
    }
  }
  return semesters.sort((left, right) => right.localeCompare(left, "pt-BR"));
}

async function discoverLessons(semesterDirectory, semester) {
  const lessons = new Set();
  for (const entry of await readdir(semesterDirectory, { withFileTypes: true })) {
    if (LESSON_PATTERN.test(entry.name)) {
      await assertRealDirectory(
        path.join(semesterDirectory, entry.name),
        `${semester}/${entry.name}`,
      );
      lessons.add(entry.name);
    } else if (LESSON_LIKE_PATTERN.test(entry.name)) {
      throw new ContentError(
        `${semester}/${entry.name}: use exatamente aula-NN.`,
      );
    }
  }
  return lessons;
}

async function validateSlideStructure(root, semester, lesson, revision) {
  const lessonDirectory = path.join(root, semester, lesson);
  const slidesDirectory = path.join(lessonDirectory, "slides");
  await assertRealDirectory(slidesDirectory, `${semester}/${lesson}/slides`);

  const lessonReadme = path.join(lessonDirectory, "README.md");
  if (await pathExists(lessonReadme)) {
    await assertRealFile(lessonReadme, `${semester}/${lesson}/README.md`);
  }

  for (const name of REQUIRED_SLIDE_FILES) {
    await assertRealFile(
      path.join(slidesDirectory, name),
      `${semester}/${lesson}/slides/${name}`,
    );
  }
  for (const name of REQUIRED_SLIDE_DIRECTORIES) {
    await assertRealDirectory(
      path.join(slidesDirectory, name),
      `${semester}/${lesson}/slides/${name}`,
    );
  }

  for (const entry of await readdir(slidesDirectory, { withFileTypes: true })) {
    assert(
      !FORBIDDEN_SLIDE_ROOT_NAMES.has(entry.name),
      `${semester}/${lesson}/slides/${entry.name}: arquivo de infraestrutura do template não deve ser copiado.`,
    );
  }

  const recordedRevision = (
    await readFile(path.join(slidesDirectory, ".slidev-template-revision"), "utf8")
  ).trim();
  assert(
    /^[0-9a-f]{40}$/u.test(recordedRevision),
    `${semester}/${lesson}/slides/.slidev-template-revision: SHA completo esperado.`,
  );
  assert(
    recordedRevision === revision,
    `${semester}/${lesson}/slides/.slidev-template-revision: esperado ${revision}.`,
  );

  for (const name of ["academic.config.ts", "slides.md", "style.css"]) {
    const content = await readFile(path.join(slidesDirectory, name), "utf8");
    assert(
      content.trim() !== "",
      `${semester}/${lesson}/slides/${name}: arquivo vazio.`,
    );
  }
  const expectedViteConfig = await readFile(
    path.join(root, "site", "templates", "slidev.vite.config.ts"),
    "utf8",
  );
  const actualViteConfig = await readFile(
    path.join(slidesDirectory, "vite.config.ts"),
    "utf8",
  );
  assert(
    actualViteConfig === expectedViteConfig,
    `${semester}/${lesson}/slides/vite.config.ts: configuração local desatualizada.`,
  );
  const slides = await readFile(path.join(slidesDirectory, "slides.md"), "utf8");
  assert(
    /^---[ \t]*\r?\n/u.test(slides),
    `${semester}/${lesson}/slides/slides.md: headmatter YAML ausente.`,
  );
}

function parseDotenvValue(rawValue) {
  const value = rawValue.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function validateOptionalEnv(root, currentSemester, currentTab) {
  const envPath = path.join(root, ".env");
  if (!(await pathExists(envPath))) {
    return;
  }
  await assertRealFile(envPath, ".env");
  const selected = new Map();
  const relevant = new Set(["SEMESTER", "TAB"]);
  const text = await readFile(envPath, "utf8");

  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const match = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/u);
    if (!match || !relevant.has(match[1])) {
      continue;
    }
    assert(
      !selected.has(match[1]),
      `.env: ${match[1]} duplicada na linha ${index + 1}.`,
    );
    selected.set(match[1], parseDotenvValue(match[2]));
  }

  for (const name of relevant) {
    assert(
      selected.has(name) && selected.get(name) !== "",
      `.env: ${name} ausente ou vazia.`,
    );
  }
  assert(
    selected.get("SEMESTER") === currentSemester,
    ".env: SEMESTER diverge de course.config.json/site.currentSemester.",
  );
  assert(
    selected.get("TAB") === currentTab,
    ".env: TAB diverge do schedule.json vigente.",
  );
}

async function inspectGitIndex(root, semesters) {
  const gitDirectory = path.join(root, ".git");
  if (!(await pathExists(gitDirectory))) {
    return;
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "--stage", "-z"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    throw new ContentError(`Não foi possível inspecionar o índice Git: ${error.message}.`);
  }

  const semesterSet = new Set(semesters);
  for (const record of stdout.split("\0")) {
    if (record === "") {
      continue;
    }
    const match = record.match(/^([0-9]{6}) [0-9a-f]+ [0-3]\t([\s\S]+)$/u);
    assert(match !== null, "Saída inesperada de git ls-files --stage.");
    const [firstSegment] = match[2].split("/");
    if (semesterSet.has(firstSegment) && match[1] === "160000") {
      throw new ContentError(
        `${match[2]}: gitlink/submódulo não é permitido; versione os arquivos diretamente.`,
      );
    }
    if (match[2] === ".env") {
      throw new ContentError(".env está versionado; remova-o do índice Git.");
    }
  }
}

async function validateSemester(root, semester, scheduleSchema, config) {
  const directory = path.join(root, semester);
  await assertNoSymlinksOrInfrastructure(directory, root);
  await validateSemesterAssets(root, semester);
  const readmePath = path.join(directory, "README.md");
  const schedulePath = path.join(directory, "schedule.json");
  await assertRealFile(readmePath, `${semester}/README.md`);
  await assertRealFile(schedulePath, `${semester}/schedule.json`);

  const schedule = parseJson(
    await readFile(schedulePath, "utf8"),
    `${semester}/schedule.json`,
  );
  validateAgainstSchema(schedule, scheduleSchema, `${semester}/schedule.json`);
  validateSchedule(schedule, semester, `${semester}/schedule.json`);

  const lessons = await discoverLessons(directory, semester);
  const referenced = new Set(
    schedule.entries.filter((entry) => entry.id !== "").map((entry) => entry.id),
  );
  const unreferenced = [...lessons].filter((lesson) => !referenced.has(lesson));
  assert(
    unreferenced.length === 0,
    `${semester}: aulas sem referência no cronograma: ${unreferenced.join(", ")}.`,
  );

  const readme = await readFile(readmePath, "utf8");
  assertReadmeMetadata(readme, config, `${semester}/README.md`, semester);
  const cronograma = extractUniqueSection(
    readme,
    "Cronograma",
    `${semester}/README.md`,
  );
  const expectedTable = renderScheduleTable(schedule, lessons);
  assert(
    normalizeSectionBody(cronograma) === expectedTable,
    `${semester}/README.md: Cronograma desatualizado; execute scripts/sync-schedule-links.mjs.`,
  );

  for (const lesson of [...lessons].sort()) {
    await validateSlideStructure(
      root,
      semester,
      lesson,
      config.slides.templateRevision,
    );
  }

  const missing = [...referenced].filter((lesson) => !lessons.has(lesson)).sort();
  return {
    semester,
    tab: schedule.source.tab,
    lessons: lessons.size,
    records: schedule.entries.length,
    missing,
  };
}

export async function validateContent(options = {}) {
  const root = options.root
    ? path.resolve(options.root)
    : await findRepositoryRoot(process.cwd());
  assertInside(root, path.join(root, "course.config.json"), "Configuração");

  const [{ config }, scheduleSchema] = await Promise.all([
    readCourseConfiguration(root),
    readScheduleSchema(root),
  ]);
  const rootReadmePath = path.join(root, "README.md");
  await assertRealFile(rootReadmePath, "README.md");
  const semesters = await discoverSemesters(root);
  assert(semesters.length > 0, "Nenhum diretório de semestre foi encontrado.");
  assert(
    semesters.includes(config.site.currentSemester),
    `Semestre vigente ${config.site.currentSemester} não existe.`,
  );

  const rootReadme = await readFile(rootReadmePath, "utf8");
  assertReadmeMetadata(rootReadme, config, "README.md");
  validateRootSemesterLinks(rootReadme, semesters);
  await inspectGitIndex(root, semesters);

  const results = [];
  for (const semester of semesters) {
    results.push(
      await validateSemester(root, semester, scheduleSchema, config),
    );
  }
  const current = results.find(
    (result) => result.semester === config.site.currentSemester,
  );
  await validateOptionalEnv(root, current.semester, current.tab);

  return {
    root,
    currentSemester: config.site.currentSemester,
    semesters: results,
    semesterCount: results.length,
    lessonCount: results.reduce((total, result) => total + result.lessons, 0),
    recordCount: results.reduce((total, result) => total + result.records, 0),
    missing: results.flatMap((result) =>
      result.missing.map((lesson) => `${result.semester}/${lesson}`),
    ),
  };
}

function parseArguments(argv) {
  const options = { root: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--root") {
      index += 1;
      assert(index < argv.length, "--root exige um caminho.");
      options.root = argv[index];
    } else {
      throw new ContentError(`Argumento desconhecido: ${argument}.`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Uso: node scripts/check-content.mjs [--root CAMINHO]",
      "",
      "Valida configuração, schemas, READMEs, cronogramas, aulas e slides.",
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
  const result = await validateContent(options);
  process.stdout.write(
    `Conteúdo válido: ${result.semesterCount} semestre(s), ` +
      `${result.lessonCount} aula(s), ${result.recordCount} registro(s).\n`,
  );
  if (result.missing.length > 0) {
    process.stdout.write(
      `Aviso: aulas planejadas ainda sem pasta: ${result.missing.join(", ")}.\n`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    const prefix = error instanceof ContentError ? "Conteúdo inválido" : "Erro";
    process.stderr.write(`${prefix}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
