#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "_site");
const SITE_DIR = path.join(ROOT, "site");
const SEMESTER_PATTERN = /^\d{4}\.[12]$/;
const LESSON_PATTERN = /^aula-\d{2}$/;
const INFRASTRUCTURE_NAMES = new Set([
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
const FORBIDDEN_PUBLIC_ASSET_NAMES = new Set([
  ...INFRASTRUCTURE_NAMES,
  ".env",
  ".git",
  ".gitignore",
]);

function fail(message) {
  throw new Error(message);
}

function codePointCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArguments(argv) {
  const options = {
    basePath:
      process.env.PAGES_BASE_PATH ??
      process.env.SITE_BASE_PATH ??
      "/",
    sha: process.env.GITHUB_SHA ?? process.env.SITE_COMMIT_SHA ?? "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--base" || argument === "--base-path") {
      options.basePath = argv[index + 1] ?? fail(`${argument} exige um valor.`);
      index += 1;
    } else if (argument === "--sha") {
      options.sha = argv[index + 1] ?? fail("--sha exige um valor.");
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Uso: node scripts/build-site.mjs [opções]",
          "",
          "Opções:",
          "  --base-path /caminho/  Base pública fornecida pelo GitHub Pages",
          "  --sha REVISAO          SHA usado nos links de materiais",
          "  -h, --help             Mostra esta ajuda",
          "",
          "Variáveis equivalentes: PAGES_BASE_PATH e GITHUB_SHA.",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      fail(`Argumento desconhecido: ${argument}`);
    }
  }

  return options;
}

function normalizeBasePath(value) {
  if (typeof value !== "string" || value.includes("\\") || /[?#\0]/u.test(value)) {
    fail("O caminho-base do Pages deve ser somente um caminho URL.");
  }

  const segments = value
    .trim()
    .split("/")
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail("O caminho-base do Pages não pode conter . ou ..");
  }

  return segments.length === 0
    ? "/"
    : `/${segments.map(encodeURIComponent).join("/")}/`;
}

function sitePath(basePath, ...segments) {
  const encoded = segments
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment));
  return `${basePath}${encoded.join("/")}${encoded.length > 0 ? "/" : ""}`;
}

function assetPath(basePath, ...segments) {
  return `${basePath}${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target, label) {
  let source;

  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    fail(`Não foi possível ler ${label} (${path.relative(ROOT, target)}): ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} contém JSON inválido: ${error.message}`);
  }
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} foi encerrado pelo sinal ${signal}.`
            : `${command} terminou com código ${code}.`,
        ),
      );
    });
  });
}

async function resolveGitSha(configuredSha) {
  if (configuredSha) {
    if (!/^[0-9a-f]{7,64}$/iu.test(configuredSha)) {
      fail("GITHUB_SHA/--sha não contém uma revisão Git hexadecimal válida.");
    }
    return configuredSha.toLowerCase();
  }

  let output = "";
  await new Promise((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errorOutput = "";

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(errorOutput.trim() || `git rev-parse terminou com código ${code}.`));
      }
    });
  });

  const sha = output.trim();
  if (!/^[0-9a-f]{7,64}$/iu.test(sha)) {
    fail("Não foi possível determinar uma revisão Git válida para os links.");
  }
  return sha.toLowerCase();
}

async function discoverDirectories(parent, pattern, label) {
  const entries = await readdir(parent, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    if (!pattern.test(entry.name)) {
      continue;
    }

    const target = path.join(parent, entry.name);
    const stats = await lstat(target);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(`${label} ${path.relative(ROOT, target)} deve ser um diretório real.`);
    }
    matches.push(entry.name);
  }

  return matches.sort(codePointCompare).reverse();
}

async function assertNoSymlinks(parent, displayPath = path.relative(ROOT, parent)) {
  const entries = await readdir(parent, { withFileTypes: true });

  for (const entry of entries) {
    const target = path.join(parent, entry.name);
    const relative = path.join(displayPath, entry.name);
    const stats = await lstat(target);

    if (stats.isSymbolicLink()) {
      fail(`Link simbólico não permitido no conteúdo publicado: ${relative}`);
    }
    if (stats.isDirectory()) {
      await assertNoSymlinks(target, relative);
    }
  }
}

async function assertPublishableAssets(
  parent,
  displayPath = path.relative(ROOT, parent),
) {
  const entries = await readdir(parent, { withFileTypes: true });

  for (const entry of entries) {
    const target = path.join(parent, entry.name);
    const relative = path.join(displayPath, entry.name);
    const stats = await lstat(target);

    if (stats.isSymbolicLink()) {
      fail(`Link simbólico não permitido nos ativos publicados: ${relative}`);
    }
    if (entry.name.startsWith(".") || FORBIDDEN_PUBLIC_ASSET_NAMES.has(entry.name)) {
      fail(`Arquivo não permitido nos ativos publicados: ${relative}`);
    }
    if (stats.isDirectory()) {
      await assertPublishableAssets(target, relative);
    } else if (!stats.isFile()) {
      fail(`Ativo publicado deve ser arquivo regular ou diretório: ${relative}`);
    }
  }
}

async function publishSemesterAssets(semester) {
  const source = path.join(ROOT, semester, "assets");
  if (!(await pathExists(source))) {
    return;
  }

  const stats = await lstat(source);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(`${semester}/assets deve ser um diretório real.`);
  }

  await assertPublishableAssets(source);
  await cp(source, path.join(OUTPUT_DIR, semester, "assets"), {
    recursive: true,
    force: false,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripMarkdown(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .trim();
}

function sanitizeHref(rawHref) {
  let href = rawHref.trim();
  if (href.startsWith("<") && href.endsWith(">")) {
    href = href.slice(1, -1).trim();
  }

  const schemeProbe = href.replace(/[\u0000-\u0020]+/gu, "").toLowerCase();
  if (
    href === "" ||
    href.startsWith("//") ||
    (/^[a-z][a-z0-9+.-]*:/iu.test(schemeProbe) &&
      !/^(https?|mailto):/iu.test(schemeProbe))
  ) {
    return "#";
  }

  return href;
}

function parseLinkDestination(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(<[^>]+>|\S+?)(?:\s+["']([^"']*)["'])?$/u);
  if (!match) {
    return null;
  }
  return { href: sanitizeHref(match[1]), title: match[2] ?? "" };
}

function renderInline(source) {
  let output = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      output += escapeHtml(source[index + 1]);
      index += 2;
      continue;
    }

    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end !== -1) {
        output += `<code>${escapeHtml(source.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }

    const isImage = source.startsWith("![", index);
    if (isImage || source[index] === "[") {
      const labelStart = index + (isImage ? 2 : 1);
      const labelEnd = source.indexOf("](", labelStart);
      if (labelEnd !== -1) {
        const destinationEnd = source.indexOf(")", labelEnd + 2);
        if (destinationEnd !== -1) {
          const destination = parseLinkDestination(
            source.slice(labelEnd + 2, destinationEnd),
          );
          if (destination) {
            const label = source.slice(labelStart, labelEnd);
            const title = destination.title
              ? ` title="${escapeHtml(destination.title)}"`
              : "";
            if (isImage) {
              output += `<img src="${escapeHtml(destination.href)}" alt="${escapeHtml(
                stripMarkdown(label),
              )}" loading="lazy"${title}>`;
            } else {
              output += `<a href="${escapeHtml(destination.href)}"${title}>${renderInline(
                label,
              )}</a>`;
            }
            index = destinationEnd + 1;
            continue;
          }
        }
      }
    }

    if (source[index] === "<") {
      const end = source.indexOf(">", index + 1);
      if (end !== -1) {
        const candidate = source.slice(index + 1, end);
        if (/^(https?:\/\/|mailto:)[^\s]+$/iu.test(candidate)) {
          const href = sanitizeHref(candidate);
          output += `<a href="${escapeHtml(href)}">${escapeHtml(candidate)}</a>`;
          index = end + 1;
          continue;
        }
      }
    }

    const delimiter = source.startsWith("**", index)
      ? "**"
      : source.startsWith("__", index)
        ? "__"
        : source.startsWith("~~", index)
          ? "~~"
          : source[index] === "*" || source[index] === "_"
            ? source[index]
            : "";
    if (delimiter) {
      const end = source.indexOf(delimiter, index + delimiter.length);
      if (end > index + delimiter.length) {
        const tag = delimiter === "~~" ? "del" : delimiter.length === 2 ? "strong" : "em";
        output += `<${tag}>${renderInline(
          source.slice(index + delimiter.length, end),
        )}</${tag}>`;
        index = end + delimiter.length;
        continue;
      }
    }

    if (source[index] === "\n") {
      output += "<br>\n";
      index += 1;
      continue;
    }

    output += escapeHtml(source[index]);
    index += 1;
  }

  return output;
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith("|")) {
    value = value.slice(1);
  }
  if (value.endsWith("|") && !value.endsWith("\\|")) {
    value = value.slice(0, -1);
  }

  const cells = [];
  let current = "";
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

function tableDelimiter(line) {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, "")))
  );
}

function tableAlignment(delimiter) {
  const compact = delimiter.replace(/\s+/gu, "");
  if (compact.startsWith(":") && compact.endsWith(":")) {
    return "center";
  }
  if (compact.endsWith(":")) {
    return "right";
  }
  return "left";
}

function startsBlock(lines, index) {
  const line = lines[index] ?? "";
  return (
    line.trim() === "" ||
    /^ {0,3}(#{1,6})\s+/u.test(line) ||
    /^ {0,3}(```|~~~)/u.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(line) ||
    /^ {0,3}>\s?/u.test(line) ||
    /^ {0,3}(?:[-+*]|\d+[.)])\s+/u.test(line) ||
    /^ {4}\S/u.test(line) ||
    (index + 1 < lines.length && line.includes("|") && tableDelimiter(lines[index + 1]))
  );
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const html = [];
  const usedIds = new Map();
  let index = 0;

  const headingId = (text) => {
    const base =
      stripMarkdown(text)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "secao";
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}(```|~~~)\s*([^\s`]*)\s*$/u);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].replace(/[^\w+-]/gu, "");
      const content = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker}`).test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
      html.push(`<pre><code${languageClass}>${escapeHtml(content.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      html.push(
        `<h${level} id="${escapeHtml(headingId(text))}">${renderInline(text)}</h${level}>`,
      );
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^ {0,3}>\s?/u.test(line)) {
      const quoted = [];
      while (index < lines.length && /^ {0,3}>\s?/u.test(lines[index])) {
        quoted.push(lines[index].replace(/^ {0,3}>\s?/u, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    if (
      index + 1 < lines.length &&
      line.includes("|") &&
      tableDelimiter(lines[index + 1])
    ) {
      const headers = splitTableRow(line);
      const delimiters = splitTableRow(lines[index + 1]);
      if (headers.length !== delimiters.length) {
        fail("Tabela Markdown com quantidade diferente de cabeçalhos e alinhamentos.");
      }
      const alignments = delimiters.map(tableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
        const cells = splitTableRow(lines[index]);
        while (cells.length < headers.length) {
          cells.push("");
        }
        rows.push(cells.slice(0, headers.length));
        index += 1;
      }
      const headerHtml = headers
        .map(
          (cell, cellIndex) =>
            `<th scope="col" class="align-${alignments[cellIndex]}">${renderInline(cell)}</th>`,
        )
        .join("");
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, cellIndex) =>
                  `<td class="align-${alignments[cellIndex]}">${renderInline(cell)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("\n");
      html.push(
        `<div class="table-scroll" tabindex="0"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
      );
      continue;
    }

    const listItem = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/u);
    if (listItem) {
      const ordered = /^\d/u.test(listItem[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/u);
        if (!item || /^\d/u.test(item[1]) !== ordered) {
          break;
        }
        items.push(item[2]);
        index += 1;
      }
      html.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^ {4}\S/u.test(line)) {
      const content = [];
      while (index < lines.length && (/^ {4}/u.test(lines[index]) || lines[index] === "")) {
        content.push(lines[index].replace(/^ {4}/u, ""));
        index += 1;
      }
      html.push(`<pre><code>${escapeHtml(content.join("\n"))}</code></pre>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return html.join("\n");
}

function extractTitle(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+)$/mu);
  return heading ? stripMarkdown(heading[1].replace(/\s+#+\s*$/u, "")) : fallback;
}

function renderBreadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Navegação estrutural"><ol>${items
    .map((item, index) => {
      const content =
        index === items.length - 1
          ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
          : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
      return `<li>${content}</li>`;
    })
    .join("")}</ol></nav>`;
}

function renderPage({
  basePath,
  body,
  breadcrumbs,
  config,
  description,
  sha,
  title,
}) {
  const locale = config.site?.locale || "pt-BR";
  const courseName = config.course.name;
  const repositoryUrl = config.repository.url.replace(/\/+$/u, "");
  const revisionUrl = `${repositoryUrl}/commit/${encodeURIComponent(sha)}`;

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)} · ${escapeHtml(courseName)}</title>
  <link rel="stylesheet" href="${escapeHtml(assetPath(basePath, "assets", "site.css"))}">
</head>
<body>
  <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
  <header class="site-header">
    <div class="shell">
      <a class="site-title" href="${escapeHtml(basePath)}">${escapeHtml(
        config.course.acronym || courseName,
      )}</a>
      <span class="site-context">${escapeHtml(config.course.program)}</span>
    </div>
  </header>
  <div class="shell">
    ${renderBreadcrumbs(breadcrumbs)}
    <main id="conteudo" class="content">
      ${body}
    </main>
  </div>
  <footer class="site-footer">
    <div class="shell">
      <span>${escapeHtml(config.course.institution.name)}</span>
      <span aria-hidden="true"> · </span>
      <a href="${escapeHtml(revisionUrl)}">revisão ${escapeHtml(sha.slice(0, 12))}</a>
    </div>
  </footer>
</body>
</html>
`;
}

function githubContentUrl(config, sha, kind, relativeSegments) {
  const repositoryUrl = config.repository.url.replace(/\/+$/u, "");
  const encodedPath = relativeSegments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${repositoryUrl}/${kind}/${encodeURIComponent(sha)}/${encodedPath}`;
}

function humanizeName(name) {
  const known = {
    atividades: "Atividades",
    codigos: "Códigos",
    materiais_de_apoio: "Materiais de apoio",
    slides: "Slides",
  };
  if (known[name]) {
    return known[name];
  }

  const words = name.replace(/[_-]+/gu, " ").trim();
  return words ? `${words[0].toLocaleUpperCase("pt-BR")}${words.slice(1)}` : name;
}

function isInfrastructure(name) {
  return name.startsWith(".") || INFRASTRUCTURE_NAMES.has(name);
}

async function lessonResources(config, sha, basePath, semester, lesson) {
  const lessonDir = path.join(ROOT, semester, lesson);
  const entries = await readdir(lessonDir, { withFileTypes: true });
  const resources = [];

  for (const entry of entries.sort((left, right) => codePointCompare(left.name, right.name))) {
    const target = path.join(lessonDir, entry.name);
    const stats = await lstat(target);

    if (stats.isSymbolicLink()) {
      fail(`Link simbólico não permitido na aula: ${semester}/${lesson}/${entry.name}`);
    }
    if (isInfrastructure(entry.name)) {
      continue;
    }

    if (entry.name === "slides") {
      if (!stats.isDirectory()) {
        fail(`${semester}/${lesson}/slides deve ser um diretório real.`);
      }
      resources.unshift({
        href: sitePath(basePath, semester, lesson, "slides"),
        kind: "Apresentação",
        label: "Slides",
      });
      continue;
    }

    resources.push({
      href: githubContentUrl(
        config,
        sha,
        stats.isDirectory() ? "tree" : "blob",
        [semester, lesson, entry.name],
      ),
      kind: stats.isDirectory() ? "Pasta no GitHub" : "Arquivo no GitHub",
      label: humanizeName(entry.name),
    });
  }

  return resources;
}

function renderResources(resources) {
  const items = resources
    .map(
      (resource) => `<li>
  <a href="${escapeHtml(resource.href)}">
    <span>${escapeHtml(resource.label)}</span>
    <small>${escapeHtml(resource.kind)}</small>
  </a>
</li>`,
    )
    .join("\n");

  return `<section class="resources" aria-labelledby="materiais">
<h2 id="materiais">Materiais</h2>
<ul class="resource-list">
${items}
</ul>
</section>`;
}

async function writePage(relativeDirectory, html) {
  const directory = path.join(OUTPUT_DIR, relativeDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html, "utf8");
}

async function slidevBinary() {
  const executable = process.platform === "win32" ? "slidev.cmd" : "slidev";
  const target = path.join(ROOT, "node_modules", ".bin", executable);
  if (!(await pathExists(target))) {
    fail(
      "Slidev não está instalado na raiz. Execute npm ci antes de construir o site.",
    );
  }
  return target;
}

async function normalizeSlidevHashRoutes(outputDirectory, publicBase) {
  const baseWithoutTrailingSlash = publicBase.slice(0, -1);
  const generatedRoutePrefix =
    "return`" + baseWithoutTrailingSlash + "/${";
  const normalizedRoutePrefix = "return`/${";
  const files = await listFiles(outputDirectory);
  let replacements = 0;

  for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
    const source = await readFile(file, "utf8");
    const occurrences = source.split(generatedRoutePrefix).length - 1;
    if (occurrences === 0) {
      continue;
    }

    replacements += occurrences;
    await writeFile(
      file,
      source.replaceAll(generatedRoutePrefix, normalizedRoutePrefix),
      "utf8",
    );
  }

  if (replacements !== 1) {
    fail(
      "O build Slidev não contém exatamente um construtor de rota " +
        `compatível com hash (encontrados: ${replacements}).`,
    );
  }
}

async function compileSlides(basePath, semesters) {
  const binary = await slidevBinary();

  for (const semester of semesters) {
    const lessons = await discoverDirectories(
      path.join(ROOT, semester),
      LESSON_PATTERN,
      "A aula",
    );

    for (const lesson of lessons.sort(codePointCompare)) {
      const slidesDir = path.join(ROOT, semester, lesson, "slides");
      let stats;
      try {
        stats = await lstat(slidesDir);
      } catch {
        fail(`A aula ${semester}/${lesson} não contém a pasta obrigatória slides/.`);
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        fail(`${semester}/${lesson}/slides deve ser um diretório real.`);
      }
      await assertNoSymlinks(slidesDir);

      const source = path.join(slidesDir, "slides.md");
      if (!(await pathExists(source))) {
        fail(`A apresentação ${semester}/${lesson}/slides/slides.md não existe.`);
      }

      const sourceCache = path.join(slidesDir, "node_modules");
      if (await pathExists(sourceCache)) {
        fail(
          `${semester}/${lesson}/slides/node_modules não deve existir; ` +
            "as dependências e caches pertencem somente à raiz.",
        );
      }

      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-site-slidev-"));
      const temporaryOutput = path.join(temporaryRoot, "dist");
      const publicBase = sitePath(basePath, semester, lesson, "slides");
      process.stdout.write(`Compilando ${semester}/${lesson}/slides…\n`);

      try {
        await run(
          binary,
          [
            "build",
            path.relative(ROOT, source),
            "--base",
            publicBase,
            "--out",
            temporaryOutput,
            "--router-mode",
            "hash",
            "--without-notes",
          ],
          { cwd: ROOT },
        );
        await normalizeSlidevHashRoutes(temporaryOutput, publicBase);
        await assertNoSymlinks(temporaryOutput, `${semester}/${lesson}/slides (build)`);
        const destination = path.join(OUTPUT_DIR, semester, lesson, "slides");
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(temporaryOutput, destination, { recursive: true, force: false });
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
        // Slidev cria este cache ao lado de slides.md mesmo quando --out aponta
        // para uma área temporária. Ele nunca deve permanecer no conteúdo.
        await rm(sourceCache, { recursive: true, force: true });
      }
    }
  }
}

async function listFiles(parent) {
  const files = [];
  const entries = await readdir(parent, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => codePointCompare(left.name, right.name))) {
    const target = path.join(parent, entry.name);
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) {
      fail(`O artefato contém link simbólico: ${path.relative(OUTPUT_DIR, target)}`);
    }
    if (stats.isDirectory()) {
      files.push(...(await listFiles(target)));
    } else if (stats.isFile()) {
      files.push(target);
    }
  }
  return files;
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function validateInternalLinks(basePath) {
  const files = await listFiles(OUTPUT_DIR);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const failures = [];

  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, "utf8");
    const attributes = html.matchAll(/\b(?:href|src)=["']([^"']+)["']/giu);

    for (const match of attributes) {
      const raw = decodeHtmlAttribute(match[1]);
      if (
        raw === "" ||
        raw.startsWith("#") ||
        raw.startsWith("//") ||
        /^(?:data|https?|mailto|tel):/iu.test(raw)
      ) {
        continue;
      }

      const withoutFragment = raw.split("#", 1)[0].split("?", 1)[0];
      let target;
      if (withoutFragment.startsWith("/")) {
        if (!withoutFragment.startsWith(basePath)) {
          failures.push(
            `${path.relative(OUTPUT_DIR, htmlFile)} -> ${raw} (fora do caminho-base)`,
          );
          continue;
        }
        target = path.join(
          OUTPUT_DIR,
          ...withoutFragment.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent),
        );
      } else {
        target = path.resolve(path.dirname(htmlFile), decodeURIComponent(withoutFragment));
      }

      const outputRoot = `${path.resolve(OUTPUT_DIR)}${path.sep}`;
      const resolved = path.resolve(target);
      if (resolved !== path.resolve(OUTPUT_DIR) && !resolved.startsWith(outputRoot)) {
        failures.push(`${path.relative(OUTPUT_DIR, htmlFile)} -> ${raw} (escapa do artefato)`);
        continue;
      }

      let candidate = resolved;
      if (withoutFragment.endsWith("/") || (await pathExists(candidate)) && (await lstat(candidate)).isDirectory()) {
        candidate = path.join(candidate, "index.html");
      }
      if (!(await pathExists(candidate))) {
        failures.push(`${path.relative(OUTPUT_DIR, htmlFile)} -> ${raw}`);
      }
    }
  }

  if (failures.length > 0) {
    fail(`Links internos inválidos:\n- ${failures.join("\n- ")}`);
  }
}

async function auditArtifact(semesters) {
  const topLevelAllowed = new Set([
    ".nojekyll",
    "404.html",
    "assets",
    "index.html",
    ...semesters,
  ]);
  const topEntries = await readdir(OUTPUT_DIR);
  const unexpectedTopLevel = topEntries.filter((entry) => !topLevelAllowed.has(entry));
  if (unexpectedTopLevel.length > 0) {
    fail(`Conteúdo inesperado na raiz do artefato: ${unexpectedTopLevel.join(", ")}`);
  }

  for (const semester of semesters) {
    const semesterDir = path.join(OUTPUT_DIR, semester);
    const lessons = await discoverDirectories(
      path.join(ROOT, semester),
      LESSON_PATTERN,
      "A aula",
    );
    const allowed = new Set(["index.html", ...lessons]);
    if (await pathExists(path.join(ROOT, semester, "assets"))) {
      allowed.add("assets");
    }
    const unexpected = (await readdir(semesterDir)).filter((entry) => !allowed.has(entry));
    if (unexpected.length > 0) {
      fail(`Conteúdo não autorizado em _site/${semester}: ${unexpected.join(", ")}`);
    }

    for (const lesson of lessons) {
      const lessonOutput = path.join(semesterDir, lesson);
      const lessonAllowed = new Set(["index.html", "slides"]);
      const unexpectedLesson = (await readdir(lessonOutput)).filter(
        (entry) => !lessonAllowed.has(entry),
      );
      if (unexpectedLesson.length > 0) {
        fail(
          `Material comum foi copiado para _site/${semester}/${lesson}: ${unexpectedLesson.join(", ")}`,
        );
      }
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const basePath = normalizeBasePath(options.basePath);
  const config = await readJson(path.join(ROOT, "course.config.json"), "course.config.json");
  const sha = await resolveGitSha(options.sha);

  if (
    !config?.course?.name ||
    !config?.course?.program ||
    !config?.course?.institution?.name ||
    !config?.repository?.url
  ) {
    fail("course.config.json não contém os metadados exigidos pelo gerador.");
  }

  const outputRealParent = await realpath(path.dirname(OUTPUT_DIR));
  if (OUTPUT_DIR === ROOT || !OUTPUT_DIR.startsWith(`${outputRealParent}${path.sep}`)) {
    fail("Diretório de saída inseguro.");
  }

  process.stdout.write("Verificando a projeção do cronograma…\n");
  await run(process.execPath, [path.join(SCRIPT_DIR, "sync-schedule-links.mjs"), "--check"]);

  const semesters = await discoverDirectories(ROOT, SEMESTER_PATTERN, "O semestre");
  if (semesters.length === 0) {
    fail("Nenhum diretório de semestre válido foi encontrado.");
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUTPUT_DIR, "assets"), { recursive: true });
  await cp(path.join(SITE_DIR, "assets", "site.css"), path.join(OUTPUT_DIR, "assets", "site.css"));
  await writeFile(path.join(OUTPUT_DIR, ".nojekyll"), "", "utf8");

  const rootReadme = await readFile(path.join(ROOT, "README.md"), "utf8");
  await writePage(
    "",
    renderPage({
      basePath,
      body: `<article class="markdown">${renderMarkdown(rootReadme)}</article>`,
      breadcrumbs: [{ label: "Início", href: basePath }],
      config,
      description: `${config.course.name} — materiais da disciplina`,
      sha,
      title: extractTitle(rootReadme, config.course.name),
    }),
  );

  for (const semester of semesters) {
    const semesterDir = path.join(ROOT, semester);
    const semesterReadmePath = path.join(semesterDir, "README.md");
    if (!(await pathExists(semesterReadmePath))) {
      fail(`O semestre ${semester} não contém README.md.`);
    }
    const semesterReadme = await readFile(semesterReadmePath, "utf8");
    const semesterLabel = semester.replace(".", "/");
    await writePage(
      semester,
      renderPage({
        basePath,
        body: `<article class="markdown">${renderMarkdown(semesterReadme)}</article>`,
        breadcrumbs: [
          { label: "Início", href: basePath },
          { label: semesterLabel, href: sitePath(basePath, semester) },
        ],
        config,
        description: `${config.course.name} — semestre ${semesterLabel}`,
        sha,
        title: extractTitle(semesterReadme, `${config.course.name} — ${semesterLabel}`),
      }),
    );
    await publishSemesterAssets(semester);

    const lessons = await discoverDirectories(semesterDir, LESSON_PATTERN, "A aula");
    for (const lesson of lessons.sort(codePointCompare)) {
      const lessonDir = path.join(semesterDir, lesson);
      const lessonReadmePath = path.join(lessonDir, "README.md");
      const lessonLabel = `Aula ${lesson.slice(-2)}`;
      let introduction = "";
      let title = lessonLabel;

      if (await pathExists(lessonReadmePath)) {
        const stats = await lstat(lessonReadmePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          fail(`${semester}/${lesson}/README.md deve ser um arquivo real.`);
        }
        const lessonReadme = await readFile(lessonReadmePath, "utf8");
        title = extractTitle(lessonReadme, lessonLabel);
        introduction = `<article class="markdown">${renderMarkdown(lessonReadme)}</article>`;
      } else {
        introduction = `<h1>${escapeHtml(lessonLabel)}</h1>`;
      }

      const resources = await lessonResources(config, sha, basePath, semester, lesson);
      if (!resources.some((resource) => resource.label === "Slides")) {
        fail(`A aula ${semester}/${lesson} não contém a pasta obrigatória slides/.`);
      }

      await writePage(
        path.join(semester, lesson),
        renderPage({
          basePath,
          body: `${introduction}\n${renderResources(resources)}`,
          breadcrumbs: [
            { label: "Início", href: basePath },
            { label: semesterLabel, href: sitePath(basePath, semester) },
            { label: lessonLabel, href: sitePath(basePath, semester, lesson) },
          ],
          config,
          description: `${config.course.name} — ${lessonLabel}, ${semesterLabel}`,
          sha,
          title,
        }),
      );
    }
  }

  const notFoundBody = `<section class="not-found">
<p class="eyebrow">Erro 404</p>
<h1>Página não encontrada</h1>
<p>O endereço solicitado não existe neste site.</p>
<p><a class="button" href="${escapeHtml(basePath)}">Voltar ao início</a></p>
</section>`;
  await writeFile(
    path.join(OUTPUT_DIR, "404.html"),
    renderPage({
      basePath,
      body: notFoundBody,
      breadcrumbs: [
        { label: "Início", href: basePath },
        { label: "Página não encontrada", href: assetPath(basePath, "404.html") },
      ],
      config,
      description: "Página não encontrada",
      sha,
      title: "Página não encontrada",
    }),
    "utf8",
  );

  await compileSlides(basePath, semesters);
  await auditArtifact(semesters);
  await validateInternalLinks(basePath);
  process.stdout.write(
    `Site gerado em ${path.relative(ROOT, OUTPUT_DIR)}/ para a base ${basePath}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Erro ao gerar o site: ${error.message}\n`);
  process.exitCode = 1;
});
