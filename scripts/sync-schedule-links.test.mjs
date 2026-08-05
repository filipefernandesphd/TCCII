import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { synchronizeScheduleLinks } from "./sync-schedule-links.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "schedule-links-"));
  const semester = path.join(root, "2026.2");
  await mkdir(semester);
  for (const schemaName of [
    "course.config.schema.json",
    "schedule.schema.json",
  ]) {
    await writeFile(
      path.join(root, schemaName),
      await readFile(path.join(repositoryRoot, schemaName), "utf8"),
    );
  }
  await writeFile(
    path.join(root, "course.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      course: {
        name: "Disciplina",
        acronym: "D",
        code: "COD",
        program: "Curso",
        institution: {
          name: "Instituição",
          campus: "Campus",
          url: "https://example.com",
        },
        modality: "Presencial",
        workloadHours: 60,
        instructor: {
          name: "Docente",
          url: "https://example.com/docente",
        },
      },
      repository: {
        provider: "github",
        owner: "example",
        name: "course",
        url: "https://github.com/example/course",
      },
      site: {
        currentSemester: "2026.2",
        locale: "pt-BR",
        timezone: "America/Sao_Paulo",
      },
      slides: {
        templateRepository:
          "git@github.com:filipefernandesphd/my-slidev-template.git",
        templateRevision: "0123456789abcdef0123456789abcdef01234567",
      },
    }),
  );
  await writeFile(
    path.join(semester, "schedule.json"),
    JSON.stringify({
      schemaVersion: 1,
      semester: "2026.2",
      source: { tab: "Program" },
      entries: [
        {
          day: "Segunda",
          date: "03/08/2026",
          module: "M1",
          topic: "Introdução",
          id: "aula-01",
        },
        {
          day: "Quarta",
          date: "05/08/2026",
          module: "M1",
          topic: "Prática [guiada]",
          id: "aula-01",
        },
        {
          day: "Segunda",
          date: "10/08/2026",
          module: "",
          topic: "Conteúdo futuro",
          id: "aula-02",
        },
        {
          day: "Quarta",
          date: "12/08/2026",
          module: "",
          topic: "Feriado",
          id: "",
        },
      ],
    }),
  );
  await writeFile(
    path.join(semester, "README.md"),
    "# Disciplina — 2026/2\n\n## Cronograma\n\nTabela antiga.\n\n## Observações\n\nPreservar.\n",
  );
  await mkdir(path.join(semester, "aula-01"));
  return { root, semester };
}

test("links only exact, existing, direct lesson directories", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const first = await synchronizeScheduleLinks({ root: fixture.root });
  assert.equal(first.records, 4);
  assert.equal(first.links, 2);
  assert.deepEqual(first.missing, ["aula-02"]);
  assert.equal(first.changed, true);

  const readme = await readFile(path.join(fixture.semester, "README.md"), "utf8");
  assert.match(readme, /\[Introdução\]\(aula-01\/\)/u);
  assert.match(readme, /\[Prática \\\[guiada\\\]\]\(aula-01\/\)/u);
  assert.match(readme, /\| Conteúdo futuro \|/u);
  assert.doesNotMatch(readme, /\[Conteúdo futuro\]/u);
  assert.match(readme, /\| Feriado \|/u);
  assert.match(readme, /## Observações\n\nPreservar\./u);

  const second = await synchronizeScheduleLinks({
    root: fixture.root,
    write: false,
  });
  assert.equal(second.changed, false);

  await mkdir(path.join(fixture.semester, "aula-02"));
  const afterLessonCreation = await synchronizeScheduleLinks({
    root: fixture.root,
    write: false,
  });
  assert.equal(afterLessonCreation.changed, true);
});

test("rejects a symbolic link named as a lesson", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await symlink(path.join(fixture.semester, "aula-01"), path.join(fixture.semester, "aula-02"));

  await assert.rejects(
    synchronizeScheduleLinks({ root: fixture.root, write: false }),
    /link simbólico não pode representar uma aula/u,
  );
});

test("rejects a regular file named as a lesson", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(path.join(fixture.semester, "aula-02"), "not a directory");

  await assert.rejects(
    synchronizeScheduleLinks({ root: fixture.root, write: false }),
    /nome de uma aula deve ser um diretório/u,
  );
});

test("compares TAB from .env literally", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(
    path.join(fixture.root, ".env"),
    [
      "SEMESTER=2026.2",
      "ANALYTICAL_PROGRAM=https://example.com/private-sheet",
      "TAB=program",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    synchronizeScheduleLinks({ root: fixture.root, write: false }),
    /TAB diverge/u,
  );
});

test("requires the versioned schema contracts", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await rm(path.join(fixture.root, "schedule.schema.json"));

  await assert.rejects(
    synchronizeScheduleLinks({ root: fixture.root, write: false }),
    /ENOENT/u,
  );
});
