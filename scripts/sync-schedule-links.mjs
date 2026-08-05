#!/usr/bin/env node

import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SEMESTER_PATTERN = /^[0-9]{4}\.[12]$/;
const LESSON_PATTERN = /^aula-[0-9]{2}$/;
const DATE_PATTERN = /^(?:|[0-9]{2}\/[0-9]{2}\/[0-9]{4})$/;
const SCHEDULE_FIELDS = ["day", "date", "module", "topic", "id"];

class ScheduleError extends Error {
  constructor(message, code = "INVALID_SCHEDULE") {
    super(message);
    this.name = "ScheduleError";
    this.code = code;
  }
}

function assert(condition, message, code) {
  if (!condition) {
    throw new ScheduleError(message, code);
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

function assertExactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);

  for (const key of required) {
    assert(keys.includes(key), `${label}: campo obrigatório ausente: ${key}.`);
  }

  for (const key of keys) {
    assert(allowed.has(key), `${label}: campo desconhecido: ${key}.`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ScheduleError(`${label}: JSON inválido (${error.message}).`);
  }
}

function nestedValue(value, pathParts, label) {
  let current = value;
  for (const part of pathParts) {
    assert(
      isPlainObject(current) && Object.hasOwn(current, part),
      `${label}: contrato obrigatório ausente em ${pathParts.join("/")}.`,
      "INVALID_SCHEMA",
    );
    current = current[part];
  }
  return current;
}

function compileSchemaPattern(schema, pathParts, label) {
  const pattern = nestedValue(schema, [...pathParts, "pattern"], label);
  assert(
    typeof pattern === "string",
    `${label}: pattern inválido em ${pathParts.join("/")}.`,
    "INVALID_SCHEMA",
  );
  try {
    return new RegExp(pattern, "u");
  } catch (error) {
    throw new ScheduleError(
      `${label}: pattern inválido em ${pathParts.join("/")} (${error.message}).`,
      "INVALID_SCHEMA",
    );
  }
}

function validateSchemaContracts(configSchema, scheduleSchema) {
  for (const [label, schema] of [
    ["course.config.schema.json", configSchema],
    ["schedule.schema.json", scheduleSchema],
  ]) {
    assert(isPlainObject(schema), `${label}: objeto esperado.`, "INVALID_SCHEMA");
    assert(
      schema.$schema === "https://json-schema.org/draft/2020-12/schema",
      `${label}: use JSON Schema Draft 2020-12.`,
      "INVALID_SCHEMA",
    );
    assert(schema.type === "object", `${label}: raiz deve ser object.`, "INVALID_SCHEMA");
  }

  assert(
    nestedValue(
      configSchema,
      ["properties", "schemaVersion", "const"],
      "course.config.schema.json",
    ) === 1,
    "course.config.schema.json: schemaVersion deve exigir 1.",
    "INVALID_SCHEMA",
  );
  assert(
    nestedValue(
      scheduleSchema,
      ["properties", "schemaVersion", "const"],
      "schedule.schema.json",
    ) === 1,
    "schedule.schema.json: schemaVersion deve exigir 1.",
    "INVALID_SCHEMA",
  );

  const configSemester = compileSchemaPattern(
    configSchema,
    ["properties", "site", "properties", "currentSemester"],
    "course.config.schema.json",
  );
  const scheduleSemester = compileSchemaPattern(
    scheduleSchema,
    ["properties", "semester"],
    "schedule.schema.json",
  );
  const scheduleDate = compileSchemaPattern(
    scheduleSchema,
    ["properties", "entries", "items", "properties", "date"],
    "schedule.schema.json",
  );
  const scheduleId = compileSchemaPattern(
    scheduleSchema,
    ["properties", "entries", "items", "properties", "id"],
    "schedule.schema.json",
  );

  assert(
    configSemester.test("2026.2") &&
      scheduleSemester.test("2026.2") &&
      !configSemester.test("2026.3") &&
      !scheduleSemester.test("2026.3"),
    "Schemas: contrato de semestre incompatível.",
    "INVALID_SCHEMA",
  );
  assert(
    scheduleDate.test("") &&
      scheduleDate.test("03/08/2026") &&
      !scheduleDate.test("2026-08-03"),
    "schedule.schema.json: contrato de data incompatível.",
    "INVALID_SCHEMA",
  );
  assert(
    scheduleId.test("") &&
      scheduleId.test("aula-00") &&
      !scheduleId.test("Aula 00") &&
      !scheduleId.test("aula-00/"),
    "schedule.schema.json: contrato de ID incompatível.",
    "INVALID_SCHEMA",
  );
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
    const acceptedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(
      acceptedTypes.some((type) => matchesJsonType(value, type)),
      `${label}: tipo inválido em ${instancePath}; esperado ${acceptedTypes.join(" ou ")}.`,
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
      assert(
        new RegExp(schema.pattern, "u").test(value),
        `${label}: formato inválido em ${instancePath}.`,
      );
    }
    if (schema.format === "uri") {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new ScheduleError(`${label}: URI inválida em ${instancePath}.`);
      }
      assert(parsed.protocol !== "", `${label}: URI absoluta esperada em ${instancePath}.`);
    }
  }

  if (typeof value === "number" && schema.exclusiveMinimum !== undefined) {
    assert(
      value > schema.exclusiveMinimum,
      `${label}: ${instancePath} deve ser maior que ${schema.exclusiveMinimum}.`,
    );
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) =>
      validateAgainstSchema(item, schema.items, label, `${instancePath}/${index}`),
    );
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

function parseLocalSelection(text) {
  const selected = new Map();
  const relevant = new Set(["SEMESTER", "TAB"]);

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
      `.env: variável ${match[1]} duplicada na linha ${index + 1}.`,
      "INVALID_ENV",
    );
    selected.set(match[1], parseDotenvValue(match[2]));
  }

  for (const name of relevant) {
    assert(
      selected.has(name) && selected.get(name) !== "",
      `.env: variável ${name} ausente ou vazia.`,
      "INVALID_ENV",
    );
  }

  return Object.fromEntries(selected);
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

async function assertRegularFile(target, label) {
  const info = await lstat(target);
  assert(!info.isSymbolicLink(), `${label}: links simbólicos não são aceitos.`);
  assert(info.isFile(), `${label}: arquivo regular esperado.`);
  return info;
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

async function findRepositoryRoot(start) {
  let candidate = path.resolve(start);

  for (;;) {
    if (await pathExists(path.join(candidate, "course.config.json"))) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    assert(
      parent !== candidate,
      "course.config.json não foi encontrado a partir do diretório atual.",
      "CONFIG_NOT_FOUND",
    );
    candidate = parent;
  }
}

function validateConfig(config) {
  assert(isPlainObject(config), "course.config.json: objeto esperado.");
  assertExactKeys(
    config,
    ["schemaVersion", "course", "repository", "site", "slides"],
    ["$schema"],
    "course.config.json",
  );
  assert(config.schemaVersion === 1, "course.config.json: schemaVersion deve ser 1.");
  assert(isPlainObject(config.course), "course.config.json: course deve ser um objeto.");
  assertExactKeys(
    config.course,
    [
      "name",
      "acronym",
      "code",
      "program",
      "institution",
      "modality",
      "workloadHours",
      "instructor",
    ],
    [],
    "course.config.json/course",
  );
  for (const field of ["name", "acronym", "code", "program", "modality"]) {
    assert(
      typeof config.course[field] === "string" && config.course[field] !== "",
      `course.config.json/course/${field}: texto não vazio esperado.`,
    );
  }
  assert(
    typeof config.course.workloadHours === "number" &&
      Number.isFinite(config.course.workloadHours) &&
      config.course.workloadHours > 0,
    "course.config.json/course/workloadHours: número positivo esperado.",
  );
  assert(
    isPlainObject(config.course.institution),
    "course.config.json/course/institution: objeto esperado.",
  );
  assertExactKeys(
    config.course.institution,
    ["name", "campus", "url"],
    [],
    "course.config.json/course/institution",
  );
  assert(
    isPlainObject(config.course.instructor),
    "course.config.json/course/instructor: objeto esperado.",
  );
  assertExactKeys(
    config.course.instructor,
    ["name", "url"],
    [],
    "course.config.json/course/instructor",
  );
  for (const [label, value] of [
    ["course/institution/name", config.course.institution.name],
    ["course/institution/campus", config.course.institution.campus],
    ["course/instructor/name", config.course.instructor.name],
  ]) {
    assert(
      typeof value === "string" && value !== "",
      `course.config.json/${label}: texto não vazio esperado.`,
    );
  }
  for (const [label, value] of [
    ["course/institution/url", config.course.institution.url],
    ["course/instructor/url", config.course.instructor.url],
  ]) {
    assert(
      typeof value === "string" && /^https:\/\//u.test(value),
      `course.config.json/${label}: URL HTTPS esperada.`,
    );
  }

  assert(
    isPlainObject(config.repository),
    "course.config.json: repository deve ser um objeto.",
  );
  assertExactKeys(
    config.repository,
    ["provider", "owner", "name", "url"],
    [],
    "course.config.json/repository",
  );
  assert(
    config.repository.provider === "github",
    "course.config.json/repository/provider: use github.",
  );
  assert(
    typeof config.repository.owner === "string" &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(
        config.repository.owner,
      ),
    "course.config.json/repository/owner: conta GitHub inválida.",
  );
  assert(
    typeof config.repository.name === "string" &&
      /^[A-Za-z0-9._-]+$/u.test(config.repository.name),
    "course.config.json/repository/name: repositório inválido.",
  );
  const expectedRepositoryUrl =
    `https://github.com/${config.repository.owner}/${config.repository.name}`;
  assert(
    config.repository.url === expectedRepositoryUrl,
    `course.config.json/repository/url: use ${expectedRepositoryUrl}.`,
  );

  assert(isPlainObject(config.site), "course.config.json: site deve ser um objeto.");
  assertExactKeys(
    config.site,
    ["currentSemester", "locale", "timezone"],
    [],
    "course.config.json/site",
  );
  assert(
    typeof config.site.currentSemester === "string" &&
      SEMESTER_PATTERN.test(config.site.currentSemester),
    "course.config.json: site.currentSemester deve usar AAAA.1 ou AAAA.2.",
  );
  assert(
    typeof config.site.locale === "string" &&
      /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(config.site.locale),
    "course.config.json/site/locale: locale inválido.",
  );
  assert(
    typeof config.site.timezone === "string" && config.site.timezone !== "",
    "course.config.json/site/timezone: texto não vazio esperado.",
  );

  assert(isPlainObject(config.slides), "course.config.json: slides deve ser um objeto.");
  assertExactKeys(
    config.slides,
    ["templateRepository", "templateRevision"],
    [],
    "course.config.json/slides",
  );
  assert(
    typeof config.slides.templateRepository === "string" &&
      config.slides.templateRepository !== "",
    "course.config.json/slides/templateRepository: texto não vazio esperado.",
  );
  assert(
    typeof config.slides.templateRevision === "string" &&
      /^[0-9a-f]{40}$/u.test(config.slides.templateRevision),
    "course.config.json/slides/templateRevision: SHA Git completo esperado.",
  );
  return config.site.currentSemester;
}

function validateSchedule(schedule, semester) {
  assert(isPlainObject(schedule), "schedule.json: objeto esperado.");
  assertExactKeys(
    schedule,
    ["schemaVersion", "semester", "source", "entries"],
    ["$schema"],
    "schedule.json",
  );
  assert(schedule.schemaVersion === 1, "schedule.json: schemaVersion deve ser 1.");
  assert(schedule.semester === semester, "schedule.json: semester diverge da configuração.");
  assert(isPlainObject(schedule.source), "schedule.json: source deve ser um objeto.");
  assertExactKeys(schedule.source, ["tab"], [], "schedule.json/source");
  assert(
    typeof schedule.source.tab === "string" && schedule.source.tab !== "",
    "schedule.json: source.tab deve ser texto não vazio.",
  );
  assert(Array.isArray(schedule.entries), "schedule.json: entries deve ser uma lista.");

  schedule.entries.forEach((entry, index) => {
    const label = `schedule.json/entries/${index}`;
    assert(isPlainObject(entry), `${label}: objeto esperado.`);
    assertExactKeys(entry, SCHEDULE_FIELDS, [], label);

    for (const field of SCHEDULE_FIELDS) {
      assert(typeof entry[field] === "string", `${label}/${field}: texto esperado.`);
      assert(
        !/[\r\n]/u.test(entry[field]),
        `${label}/${field}: quebras de linha não são aceitas.`,
      );
    }

    assert(
      DATE_PATTERN.test(entry.date) && isValidCalendarDate(entry.date),
      `${label}/date: use uma data real em dd/mm/aaaa ou deixe vazio.`,
    );
    assert(
      entry.id === "" || LESSON_PATTERN.test(entry.id),
      `${label}/id: use aula-NN ou deixe vazio.`,
    );
    assert(
      entry.id === "" || entry.topic.trim() !== "",
      `${label}/topic: tópico obrigatório quando ID estiver preenchido.`,
    );
  });
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

async function discoverLessonDirectories(semesterDirectory) {
  const entries = await readdir(semesterDirectory, { withFileTypes: true });
  const lessons = new Set();

  for (const entry of entries) {
    if (!LESSON_PATTERN.test(entry.name)) {
      continue;
    }

    const target = path.join(semesterDirectory, entry.name);
    const info = await lstat(target);
    assert(
      !info.isSymbolicLink(),
      `${entry.name}: link simbólico não pode representar uma aula.`,
    );
    assert(info.isDirectory(), `${entry.name}: o nome de uma aula deve ser um diretório.`);
    lessons.add(entry.name);
  }

  return lessons;
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

function renderTable(schedule, lessons) {
  const lines = [
    "| Dia | Data | Módulo | Tópico |",
    "|---|---|---|---|",
  ];
  const missing = new Set();
  let links = 0;
  let rowsWithEmptyFields = 0;

  for (const entry of schedule.entries) {
    const day = escapeMarkdownCell(entry.day);
    const date = escapeMarkdownCell(entry.date);
    const module = escapeMarkdownCell(entry.module);
    let topic = escapeMarkdownCell(entry.topic);

    if (SCHEDULE_FIELDS.some((field) => entry[field] === "")) {
      rowsWithEmptyFields += 1;
    }

    if (entry.id !== "" && lessons.has(entry.id)) {
      topic = `[${escapeMarkdownLinkText(entry.topic)}](${entry.id}/)`;
      links += 1;
    } else if (entry.id !== "") {
      missing.add(entry.id);
    }

    lines.push(`| ${day} | ${date} | ${module} | ${topic} |`);
  }

  return {
    table: lines.join("\n"),
    links,
    missing: [...missing].sort(),
    rowsWithEmptyFields,
  };
}

function normalizeHeadingText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function scanHeadings(lines) {
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

    const headingMatch = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
    if (!headingMatch) {
      return;
    }

    headings.push({
      index,
      level: headingMatch[1].length,
      text: headingMatch[2],
    });
  });

  return headings;
}

function replaceCronograma(readme, table) {
  const newline = readme.includes("\r\n") ? "\r\n" : "\n";
  const normalized = readme.replaceAll("\r\n", "\n");
  const lines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  const headings = scanHeadings(lines);
  const matches = headings.filter(
    (heading) => normalizeHeadingText(heading.text) === "cronograma",
  );

  assert(matches.length <= 1, "README do semestre: seção Cronograma duplicada.");

  const tableLines = table.split("\n");
  let output;
  let action;

  if (matches.length === 0) {
    const prefix = lines.length === 1 && lines[0] === "" ? [] : lines;
    while (prefix.at(-1) === "") {
      prefix.pop();
    }
    output = [...prefix, "", "## Cronograma", "", ...tableLines];
    action = "created";
  } else {
    const current = matches[0];
    const next = headings.find(
      (heading) =>
        heading.index > current.index && heading.level <= current.level,
    );
    const sectionEnd = next?.index ?? lines.length;
    const suffix = lines.slice(sectionEnd);
    output = [
      ...lines.slice(0, current.index + 1),
      "",
      ...tableLines,
      ...(suffix.length > 0 ? [""] : []),
      ...suffix,
    ];
    action = "replaced";
  }

  return {
    content: `${output.join(newline)}${newline}`,
    action,
  };
}

async function writeAtomically(target, original, next, mode) {
  const parent = path.dirname(target);
  const temporaryDirectory = await mkdtemp(
    path.join(parent, `.${path.basename(target)}-`),
  );
  const temporaryFile = path.join(temporaryDirectory, path.basename(target));

  try {
    await writeFile(temporaryFile, next, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    await chmod(temporaryFile, mode);

    const current = await readFile(target, "utf8");
    assert(
      current === original,
      "README do semestre foi alterado durante a sincronização.",
      "CONCURRENT_CHANGE",
    );
    await rename(temporaryFile, target);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function validateOptionalLocalEnv(root, semester, tab) {
  const envPath = path.join(root, ".env");
  if (!(await pathExists(envPath))) {
    return;
  }

  await assertRegularFile(envPath, ".env");
  const local = parseLocalSelection(await readFile(envPath, "utf8"));
  assert(
    SEMESTER_PATTERN.test(local.SEMESTER),
    ".env: SEMESTER deve usar AAAA.1 ou AAAA.2.",
    "INVALID_ENV",
  );
  assert(
    local.SEMESTER === semester,
    ".env: SEMESTER diverge de course.config.json/site.currentSemester.",
    "INVALID_ENV",
  );
  assert(
    local.TAB === tab,
    ".env: TAB diverge de schedule.json/source.tab.",
    "INVALID_ENV",
  );
}

export async function synchronizeScheduleLinks(options = {}) {
  const root = options.root
    ? path.resolve(options.root)
    : await findRepositoryRoot(process.cwd());
  const write = options.write ?? true;
  const configPath = path.join(root, "course.config.json");
  const configSchemaPath = path.join(root, "course.config.schema.json");
  const scheduleSchemaPath = path.join(root, "schedule.schema.json");

  await assertRegularFile(configPath, "course.config.json");
  await assertRegularFile(configSchemaPath, "course.config.schema.json");
  await assertRegularFile(scheduleSchemaPath, "schedule.schema.json");
  const configSchema = parseJson(
    await readFile(configSchemaPath, "utf8"),
    "course.config.schema.json",
  );
  const scheduleSchema = parseJson(
    await readFile(scheduleSchemaPath, "utf8"),
    "schedule.schema.json",
  );
  validateSchemaContracts(configSchema, scheduleSchema);
  const config = parseJson(await readFile(configPath, "utf8"), "course.config.json");
  validateAgainstSchema(config, configSchema, "course.config.json");
  const semester = validateConfig(config);
  const semesterDirectory = path.join(root, semester);
  const schedulePath = path.join(semesterDirectory, "schedule.json");
  const readmePath = path.join(semesterDirectory, "README.md");

  assertInside(root, semesterDirectory, "Semestre");
  assertInside(root, schedulePath, "schedule.json");
  assertInside(root, readmePath, "README do semestre");

  const semesterInfo = await lstat(semesterDirectory);
  assert(
    semesterInfo.isDirectory() && !semesterInfo.isSymbolicLink(),
    `${semester}: diretório real esperado.`,
  );
  await assertRegularFile(schedulePath, `${semester}/schedule.json`);
  const readmeInfo = await assertRegularFile(readmePath, `${semester}/README.md`);

  const schedule = parseJson(
    await readFile(schedulePath, "utf8"),
    `${semester}/schedule.json`,
  );
  validateAgainstSchema(
    schedule,
    scheduleSchema,
    `${semester}/schedule.json`,
  );
  validateSchedule(schedule, semester);
  await validateOptionalLocalEnv(root, semester, schedule.source.tab);

  const lessons = await discoverLessonDirectories(semesterDirectory);
  const rendered = renderTable(schedule, lessons);
  const referenced = new Set(
    schedule.entries.filter((entry) => entry.id !== "").map((entry) => entry.id),
  );
  const filledIds = schedule.entries.filter((entry) => entry.id !== "").length;
  const unreferenced = [...lessons]
    .filter((lesson) => !referenced.has(lesson))
    .sort();
  const original = await readFile(readmePath, "utf8");
  const replacement = replaceCronograma(original, rendered.table);
  const changed = replacement.content !== original;

  if (write && changed) {
    await writeAtomically(
      readmePath,
      original,
      replacement.content,
      readmeInfo.mode,
    );
  }

  return {
    root,
    semester,
    tab: schedule.source.tab,
    records: schedule.entries.length,
    filledIds,
    distinctIds: referenced.size,
    repeatedIds: filledIds - referenced.size,
    links: rendered.links,
    missing: rendered.missing,
    unreferenced,
    rowsWithEmptyFields: rendered.rowsWithEmptyFields,
    action: replacement.action,
    changed,
    wrote: write && changed,
    readme: path.relative(root, readmePath),
  };
}

function parseArguments(argv) {
  const options = { check: false, root: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
    } else if (argument === "--root") {
      index += 1;
      assert(argv[index], "--root exige um caminho.", "INVALID_ARGUMENT");
      options.root = argv[index];
    } else if (argument.startsWith("--root=")) {
      options.root = argument.slice("--root=".length);
      assert(options.root !== "", "--root exige um caminho.", "INVALID_ARGUMENT");
    } else {
      throw new ScheduleError(`Argumento desconhecido: ${argument}.`, "INVALID_ARGUMENT");
    }
  }

  return options;
}

function printReport(result, check) {
  const mode = check ? "verificado" : result.wrote ? "atualizado" : "sem alterações";
  console.log(
    [
      `Cronograma ${mode}: ${result.readme}`,
      `Semestre: ${result.semester}`,
      `Aba: ${result.tab}`,
      `Registros: ${result.records}`,
      `IDs preenchidos: ${result.filledIds}`,
      `IDs distintos: ${result.distinctIds}`,
      `Repetições de ID: ${result.repeatedIds}`,
      `Links gerados: ${result.links}`,
      `Aulas planejadas sem pasta: ${result.missing.length}`,
      `Pastas de aula sem referência: ${result.unreferenced.length}`,
      `Linhas com campos vazios: ${result.rowsWithEmptyFields}`,
    ].join("\n"),
  );

  if (result.missing.length > 0) {
    console.warn(`Sem pasta: ${result.missing.join(", ")}`);
  }
  if (result.unreferenced.length > 0) {
    console.warn(`Sem referência: ${result.unreferenced.join(", ")}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await synchronizeScheduleLinks({
    root: options.root,
    write: !options.check,
  });
  printReport(result, options.check);

  if (options.check && result.changed) {
    throw new ScheduleError(
      `${result.readme} não corresponde ao cronograma e às pastas atuais. Execute o sincronizador sem --check.`,
      "OUT_OF_SYNC",
    );
  }
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    const message =
      error instanceof ScheduleError ? error.message : `Falha inesperada: ${error.message}`;
    console.error(message);
    process.exitCode = 1;
  });
}
