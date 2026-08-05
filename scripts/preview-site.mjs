#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ROOT = path.join(ROOT, "_site");
const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {
    basePath: process.env.PAGES_BASE_PATH ?? process.env.SITE_BASE_PATH ?? "/",
    host: "127.0.0.1",
    port: 4173,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base" || argument === "--base-path") {
      options.basePath = argv[++index] ?? fail(`${argument} exige um valor.`);
    } else if (argument === "--host") {
      options.host = argv[++index] ?? fail("--host exige um valor.");
    } else if (argument === "--port") {
      options.port = Number(argv[++index] ?? fail("--port exige um valor."));
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Uso: node scripts/preview-site.mjs [--base-path /caminho/] [--host 127.0.0.1] [--port 4173]\n",
      );
      process.exit(0);
    } else {
      fail(`Argumento desconhecido: ${argument}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    fail("--port deve ser um inteiro entre 1 e 65535.");
  }
  if (
    typeof options.basePath !== "string" ||
    /[\\?#\0]/u.test(options.basePath) ||
    options.basePath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("O caminho-base deve ser um caminho URL válido.");
  }

  const segments = options.basePath.trim().split("/").filter(Boolean);
  options.basePath =
    segments.length === 0
      ? "/"
      : `/${segments.map(encodeURIComponent).join("/")}/`;
  return options;
}

async function serve() {
  const options = parseArguments(process.argv.slice(2));
  const siteRoot = await realpath(SITE_ROOT).catch(() => {
    fail("_site/ não existe. Execute o build antes do preview.");
  });

  const notFound = await readFile(path.join(siteRoot, "404.html")).catch(
    () => Buffer.from("404 — Página não encontrada", "utf8"),
  );

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://preview.local");
      if (options.basePath !== "/" && requestUrl.pathname === options.basePath.slice(0, -1)) {
        response.writeHead(308, { Location: `${options.basePath}${requestUrl.search}` });
        response.end();
        return;
      }
      if (!requestUrl.pathname.startsWith(options.basePath)) {
        response.writeHead(404, {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : notFound);
        return;
      }

      let relative;
      try {
        relative = decodeURIComponent(requestUrl.pathname.slice(options.basePath.length));
      } catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Endereço inválido.");
        return;
      }

      const requested = path.resolve(siteRoot, relative);
      if (requested !== siteRoot && !requested.startsWith(`${siteRoot}${path.sep}`)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Acesso negado.");
        return;
      }

      let target = requested;
      let stats = await lstat(target).catch(() => null);
      if (stats?.isSymbolicLink()) {
        stats = null;
      } else if (stats?.isDirectory()) {
        target = path.join(target, "index.html");
        stats = await lstat(target).catch(() => null);
      }

      if (!stats?.isFile()) {
        response.writeHead(404, {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(request.method === "HEAD" ? undefined : notFound);
        return;
      }

      const resolvedTarget = await realpath(target);
      if (!resolvedTarget.startsWith(`${siteRoot}${path.sep}`)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Acesso negado.");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": stats.size,
        "Content-Type":
          MIME_TYPES.get(path.extname(target).toLowerCase()) ??
          "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
      } else {
        createReadStream(target).pipe(response);
      }
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Erro interno: ${error.message}`);
    }
  });

  server.listen(options.port, options.host, () => {
    process.stdout.write(
      `Preview disponível em http://${options.host}:${options.port}${options.basePath}\n`,
    );
  });

  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

serve().catch((error) => {
  process.stderr.write(`Erro no preview: ${error.message}\n`);
  process.exitCode = 1;
});
