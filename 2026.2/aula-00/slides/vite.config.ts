import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, UserConfig } from "vite";

const SLIDES_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SEMESTER_ASSETS_DIRECTORY = path.resolve(SLIDES_DIRECTORY, "../../assets");
const PUBLIC_ASSETS_PREFIX = "/assets/";

function sharedSemesterAssets(): Plugin {
  return {
    name: "course-shared-semester-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        let url: URL;
        try {
          url = new URL(request.url, "http://localhost");
        } catch {
          response.statusCode = 400;
          response.end("Invalid URL");
          return;
        }

        let pathname: string;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          response.statusCode = 400;
          response.end("Invalid URL encoding");
          return;
        }

        if (!pathname.startsWith(PUBLIC_ASSETS_PREFIX)) {
          next();
          return;
        }

        const relative = pathname.slice(PUBLIC_ASSETS_PREFIX.length);
        const target = path.resolve(SEMESTER_ASSETS_DIRECTORY, relative);
        const insideAssets = target.startsWith(
          `${SEMESTER_ASSETS_DIRECTORY}${path.sep}`,
        );

        if (!insideAssets || relative.includes("\0")) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }

        let realTarget: string;
        try {
          const realAssetsDirectory = realpathSync(SEMESTER_ASSETS_DIRECTORY);
          realTarget = realpathSync(target);
          if (
            lstatSync(target).isSymbolicLink() ||
            !realTarget.startsWith(`${realAssetsDirectory}${path.sep}`) ||
            !statSync(realTarget).isFile()
          ) {
            next();
            return;
          }
        } catch {
          next();
          return;
        }

        const fileUrl = realTarget.split(path.sep).join("/");
        request.url = `/@fs/${fileUrl}${url.search}`;
        next();
      });
    },
  };
}

export default {
  plugins: [sharedSemesterAssets()],
} satisfies UserConfig;
