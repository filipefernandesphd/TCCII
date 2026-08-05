# Instruções de uso do repositório

Este documento explica como o professor organizará e publicará os materiais de
uma disciplina. Este repositório é a base reutilizável e inclui uma instância
mínima de exemplo. Em cada repositório criado a partir dela, os dados acadêmicos
públicos ficam em `course.config.json`, nos READMEs e nos slides, enquanto a
automação funciona da mesma forma para qualquer disciplina.

## Estado atual

O repositório possui sincronização de cronograma, validação de conteúdo,
gerador estático, build separado dos decks Slidev, preview local, criação de
aulas e workflow do GitHub Pages. Os comandos documentados abaixo são contratos
ativos do `package.json`.

O Pages está configurado para usar GitHub Actions. O workflow valida pushes e
pull requests de qualquer branch, mas publica somente a branch padrão. Para um
push aparecer na aba `Actions`, o commit enviado precisa conter
`.github/workflows/pages.yml`; adicionar o arquivo apenas ao diretório de
trabalho não aciona retroativamente commits anteriores.

## Como o site funciona

O endereço de um repositório de projeto segue normalmente este formato:

```text
https://<conta>.github.io/<repositorio>/
```

Decisões do projeto:

| Tema                | Funcionamento                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Página inicial     | É gerada a partir do`README.md` raiz.                                                        |
| Página do semestre | Combina a prosa de`AAAA.S/README.md` com o cronograma canônico de `AAAA.S/schedule.json`.  |
| Página da aula     | É gerada pela estrutura de`AAAA.S/aula-NN/`.                                                 |
| Slides              | Abrem dentro do GitHub Pages.                                                                   |
| Ativos do semestre  | A pasta opcional`AAAA.S/assets/` é publicada no mesmo caminho para uso pelos slides.         |
| Outros materiais    | Abrem no GitHub, na mesma revisão do site.                                                     |
| HTML                | Fica apenas no artefato`_site/`; não é editado ou commitado.                                |
| Branches            | Toda branch é verificada; somente a branch padrão publica.                                    |
| Semestre vigente    | Localmente vem de`SEMESTER`; no build vem de `course.config.json`, e ambos devem coincidir. |
| Links do cronograma | São recalculados no build conforme o`ID` e as pastas `aula-*` existentes.                  |

Essa política evita que uma branch de rascunho, prova ou gabarito substitua o
único site público do repositório. Uma alteração aparece para os estudantes
depois de ser integrada na branch padrão.

## Como reutilizar a base para outra disciplina

Ao criar outro repositório a partir desta base:

1. mantenha a estrutura, os scripts, o workflow, as skills e os templates;
2. preencha `course.config.json` com disciplina, instituição, curso, professor,
   repositório, semestre vigente e revisão do template;
3. ajuste os READMEs para a apresentação textual da nova disciplina;
4. remova da seção `Turmas` os semestres que não pertencem à nova instância;
5. crie o primeiro diretório de semestre, seu README e seu `schedule.json`;
6. configure o `.env` local com semestre, planilha e aba;
7. edite `academic.config.ts` e `slides.md` em cada apresentação;
8. configure o GitHub Pages no novo repositório.

Não altere scripts ou workflows apenas para trocar de disciplina. Se algum
nome, código, proprietário, repositório ou semestre estiver fixado na
automação, isso é um defeito de reutilização.

## Estrutura de conteúdo

```text
.
├── course.config.json
├── course.config.schema.json
├── schedule.schema.json
├── README.md
├── 2026.2/
│   ├── README.md
│   ├── schedule.json
│   ├── assets/
│   ├── aula-00/
│   │   ├── README.md
│   │   ├── slides/
│   │   ├── atividades/
│   │   └── materiais_de_apoio/
│   └── aula-01/
├── 2026.1/
└── 2025.2/
```

Use:

- semestre no formato `AAAA.1` ou `AAAA.2`;
- aula no formato `aula-NN`, incluindo `aula-00`;
- sempre uma pasta chamada exatamente `slides`;
- nomes simples, sem espaços, para novas pastas.

`aula-oo` usa letras e está incorreto. O formato certo é `aula-00`.

## Configuração pública da disciplina

O arquivo versionado `course.config.json` concentra os dados públicos que
mudam entre disciplinas:

- instituição, campus, curso, nome, sigla e código da disciplina;
- modalidade, carga horária e professor;
- owner, nome e URL pública do repositório;
- semestre vigente, locale e fuso;
- repositório fixo e revisão do template Slidev.

Ele é validado por `course.config.schema.json`. Ao clonar esta base, altere a
configuração, não os scripts. Não coloque nesse arquivo a URL da planilha,
tokens ou credenciais. Branch padrão, SHA e caminho-base do Pages continuam
sendo obtidos do ambiente do GitHub.

## Configuração inicial no GitHub

Esta etapa é feita uma vez em cada repositório criado a partir da base.

1. Abra `Settings` → `Pages`.
2. Em `Build and deployment`, selecione `GitHub Actions`.
3. Abra `Settings` → `Environments` → `github-pages`.
4. Restrinja a implantação à branch padrão do repositório.
5. Proteja a branch padrão e exija revisão para mudanças no workflow, se
   possível.
6. Confirme que GitHub Actions está habilitado no repositório.
7. Execute o workflow manualmente uma vez pela aba `Actions`.
8. Use a URL informada pelo job de deploy; não tente deduzi-la pelo nome da
   disciplina.

## Preparação local

O template atual exige Node `22.18+` ou `24.11+` e usa npm:

```bash
npm ci
npm run check
npm run build
```

- `npm ci` instala exatamente as versões do lockfile.
- `npm run check` valida a estrutura sem publicar.
- `npm run build` gera o site completo em `_site/`.

Não edite nada dentro de `_site/` ou de uma pasta `dist/`. Esses diretórios são
temporários e serão recriados.

### Configurar o semestre vigente

Crie o arquivo local a partir do exemplo:

```bash
cp .env.example .env
```

Preencha:

```dotenv
SEMESTER=2026.2
ANALYTICAL_PROGRAM=https://endereco-da-planilha
TAB=Program
```

- `SEMESTER` usa exatamente `AAAA.1` ou `AAAA.2`.
- `SEMESTER` deve coincidir com
  `course.config.json/site.currentSemester`.
- `ANALYTICAL_PROGRAM` aponta para a planilha do mesmo semestre.
- `TAB` é o nome exato da aba, incluindo caixa, acentos e espaços.
- `.env` é local e nunca deve ser commitado.
- `.env.example` é versionado e não contém uma URL privada.
- o site não lê a planilha durante o deploy; a skill atualiza o JSON canônico
  e sua projeção no README, que depois passam por revisão e commit.

Ao iniciar outro período, altere `SEMESTER`, `ANALYTICAL_PROGRAM`, `TAB` e
`course.config.json/site.currentSemester` antes de sincronizar o cronograma.

## Como iniciar um semestre

Exemplo para `2026.2`:

1. Defina `SEMESTER=2026.2` no `.env`.
2. Crie o diretório `2026.2/`.
3. Crie `2026.2/README.md`.
4. Crie `2026.2/schedule.json` conforme `schedule.schema.json`.
5. Copie para esse README os mesmos dados básicos da disciplina presentes no
   README raiz.
6. Identifique claramente o semestre.
7. Adicione uma seção `Cronograma`.
8. Adicione a turma à seção `Turmas` do README raiz:

```markdown
- [2026/2](2026.2/)
```

9. Execute `node scripts/sync-schedule-links.mjs`.
10. Execute `npm run check`.

Modelo mínimo do cronograma:

```markdown
## Cronograma

| Dia | Data | Módulo | Tópico |
|---|---|---|---|
| Segunda | 03/08/2026 | Apresentação | [Plano da disciplina](aula-00/) |
```

Não crie `2026.2/index.html` manualmente. O build o produzirá a partir do
README e do cronograma canônico.

## Como criar uma aula

Use:

```bash
npm run aula:nova -- 2026.2 aula-01
```

O comando:

- recusar semestre ou aula com nome inválido;
- recusar uma pasta que já existe;
- criar `2026.2/aula-01/slides/`;
- copiar os arquivos operacionais do template Slidev;
- adicionar a configuração local que serve os ativos compartilhados no preview;
- registrar a revisão do template;
- não copiar um repositório Git aninhado.

O template obrigatório é:

```text
git@github.com:filipefernandesphd/my-slidev-template.git
```

O script sempre clona esse endereço por SSH em uma área temporária, faz
checkout do SHA declarado em `course.config.json/slides/templateRevision` e
copia somente os arquivos operacionais. O clone completo e seu `.git` nunca
entram na pasta da aula. A revisão atualmente fixada é
`1db486dba3cdb9dcae70fdfa806a5627eabf05ae`.

Depois:

1. Edite `slides/academic.config.ts`.
2. Preencha curso, disciplina, código, professor, contato e título.
3. Substitua os slides demonstrativos em `slides/slides.md`.
4. Atualize também o `title` no início de `slides.md`.
5. Preserve o tema Tahta, a variante `minimal`, `mdc: true`,
   `routerMode: hash` e o layout `academic-cover`.
6. Crie `aula-NN/README.md` se quiser uma introdução na página da aula.
7. Adicione as demais pastas de materiais ao lado de `slides/`.

Não copie `package.json`, `package-lock.json`, `node_modules`, `dist`, `.git`,
prompts, skills ou `AGENTS.md` do template para a aula. As dependências serão
mantidas uma única vez na raiz deste repositório.

## Como ligar o cronograma à aula

Não edite o link manualmente. Na planilha, associe o registro pelo `ID`:

```text
Tópico: Classes e objetos
ID: aula-01
```

Depois da importação, `schedule.json` preserva esse ID. O comando:

```bash
node scripts/sync-schedule-links.mjs
```

enumera as pastas do semestre e produz:

```markdown
| Segunda | 03/08/2026 | Fundamentos | [Classes e objetos](aula-01/) |
```

O link só aparece se `aula-01/` for um diretório direto, real e com esse nome
exato. Enquanto a pasta não existir, o tópico permanece como texto. Um ID
vazio representa feriado, recesso ou evento sem aula. O mesmo ID pode aparecer
em várias linhas, e todas são preservadas e recebem a mesma decisão de link.

No build do site, execute o sincronizador antes de renderizar. Assim, adicionar
uma pasta `aula-*` em qualquer push atualiza os links do artefato sem consultar
novamente a planilha.

## Atualização por planilha

Use a skill `skills/update-cronogram/SKILL.md` para sincronizar o semestre
indicado no `.env`. Em um agente compatível, peça:

```text
Use $update-cronogram para atualizar o cronograma do semestre vigente.
```

Antes de executar, confirme:

- `.env` contém `SEMESTER`, `ANALYTICAL_PROGRAM` e `TAB`;
- `SEMESTER` coincide com
  `course.config.json/site.currentSemester`;
- `<SEMESTER>/README.md` já existe;
- o título ou metadado da planilha, quando informar um semestre, coincide com
  `SEMESTER`;
- existe exatamente uma aba com nome literal igual a `TAB`;
- a planilha contém `Dia`, `Módulo`, `Tópico`, o cabeçalho literal `ID` e uma
  coluna `Data`; esta última também pode ser a única coluna sem título cujos
  valores sejam todos datas inequívocas;
- cada `ID` não vazio usa exatamente `aula-NN`;
- `ID` fica vazio em feriados, recessos e eventos sem página.

A coluna `ID` associa a linha à pasta:

```text
Tópico: Classes e objetos
ID: aula-01
Resultado: [Classes e objetos](aula-01/)
```

A tabela final continua com somente quatro colunas. A skill grava os registros
em `<SEMESTER>/schedule.json`, incluindo IDs repetidos sem deduplicá-los, e
regenera somente a seção `Cronograma` do README do mesmo semestre. Ela não
modifica o README raiz. Quando a pasta de uma aula ainda não existe, o tópico
permanece sem link; o próximo build ou sincronização cria o link depois que a
pasta for adicionada.

O JSON não contém a URL da planilha, timestamps, HTML, links nem estado de
existência das pastas. Depois da sincronização:

1. revise as datas, os textos e os links;
2. execute `node --test scripts/sync-schedule-links.test.mjs`;
3. execute `node scripts/sync-schedule-links.mjs --check`;
4. execute `npm run check`;
5. confira o diff;
6. faça commit de `schedule.json` e do README projetado.

Não exponha nem copie a URL da planilha para mensagens, READMEs ou logs. A
planilha nunca é consultada pelo workflow de deploy.

## Como adicionar materiais

Crie pastas ao lado de `slides/`:

```text
2026.2/aula-01/
├── slides/
├── atividades/
├── codigos/
└── materiais_de_apoio/
```

Na página pública:

- `slides` abre a apresentação no Pages;
- `atividades`, `codigos` e `materiais_de_apoio` abrem no GitHub;
- arquivos soltos também abrem no GitHub.

Não duplique esses materiais em `_site/`. Não coloque dados pessoais de
estudantes, respostas privadas, credenciais ou conteúdo sem licença adequada
em uma branch que será integrada à branch padrão.

### Ativos compartilhados pelos slides

Para compartilhar imagens e outros arquivos entre os decks de um semestre,
coloque-os na pasta opcional do semestre:

```text
2026.2/assets/qrcode-avaliacao.png
```

Em um deck localizado em `2026.2/aula-NN/slides/slides.md`, use:

```yaml
---
layout: image
side: right
image: ../../assets/qrcode-avaliacao.png
title: Avaliação
---
```

O build copia a pasta para `_site/2026.2/assets/`. Arquivos ocultos, links
simbólicos e arquivos de infraestrutura não são aceitos. Todo conteúdo dessa
pasta é público; não coloque nela avaliações, soluções, credenciais ou dados
pessoais. Como o caminho compartilhado pertence ao site completo, confira-o
com `npm run build` e `npm run preview`. O preview direto do Slidev também
serve esses arquivos; reinicie o servidor depois de adicionar ou atualizar
`slides/vite.config.ts`.

## Como revisar os slides localmente

Depois de `npm ci`, execute a partir da raiz:

```bash
npm run slidev -- 2026.2/aula-01/slides/slides.md --open
```

Revise pelo menos:

- capa;
- um slide comum;
- um slide com duas colunas ou mídia;
- encerramento;
- rodapé e numeração;
- navegação pelo teclado;
- título da aba do navegador.

Para revisar o site inteiro:

```bash
npm run build
npm run preview
```

O build de produção compilará cada deck separadamente, com o caminho completo
da aula e sem notas do apresentador.

## Fluxo de publicação

1. Crie uma branch de trabalho a partir da branch padrão.
2. Adicione ou altere os materiais.
3. Recalcule e valide o cronograma:

```bash
node scripts/sync-schedule-links.mjs
node scripts/sync-schedule-links.mjs --check
```

4. Execute:

```bash
npm ci
npm run check
npm run build
```

5. Revise `_site/` por meio de `npm run preview`.
6. Faça commit e push da branch.
7. Confira o build automático no GitHub Actions.
8. Abra um pull request para a branch padrão.
9. Faça o merge somente depois das verificações passarem.
10. Aguarde o job de deploy da branch padrão.
11. Abra a URL exibida pelo deploy e teste a página alterada.

Um push em outra branch valida o site, mas não modifica a página vista pelos
estudantes. Isso é intencional.

Branches antigas só recebem a verificação automática se já contiverem o
workflow. Crie novas branches a partir da branch padrão atualizada.

## Atualização controlada do template

Não atualize todas as aulas silenciosamente ao criar uma aula nova.

Para atualizar o template:

1. registre o novo SHA do template;
2. revise as diferenças;
3. atualize as dependências e o lockfile raiz em tarefa separada;
4. aplique somente as mudanças necessárias aos decks existentes;
5. gere todos os slides;
6. revise visualmente amostras de semestres diferentes;
7. faça um pull request dedicado.

## Problemas comuns

### O site ainda não existe

Confira se o workflow chegou à branch padrão, se `GitHub Actions` está
selecionado em `Settings` → `Pages` e se o job de deploy terminou.

### Nada apareceu na aba Actions depois do push

Confirme no GitHub, e não apenas no diretório local, que a revisão enviada
contém `.github/workflows/pages.yml`. O GitHub não executa um workflow que não
existe no commit do push. Depois de integrar e enviar esse arquivo, novos
pushes passam a ser validados; somente a branch padrão faz deploy.

### A alteração passou no build, mas não apareceu

Confira se o commit já chegou à branch padrão e se o job de deploy terminou.
Builds de outras branches não publicam.

### Os slides abrem, mas imagens ou estilos retornam 404

O deck provavelmente foi construído com `--base` incorreto. A base precisa
incluir repositório, semestre, aula e `slides`, começando e terminando com `/`.

### O primeiro slide abre, mas avançar mostra o 404 interno

O build deve manter a base absoluta dos ativos e normalizar o construtor de
rotas internas no artefato. Execute `npm run build` novamente e teste o botão
“próximo” e a tecla de seta; não contorne o problema trocando o deck para
roteamento `history`.

### O tópico não abre a aula

Confira três condições:

- o registro em `schedule.json` possui o `id` exato;
- a pasta é filha direta do semestre e usa o mesmo nome `aula-NN`;
- a pasta é um diretório real, não arquivo nem link simbólico.

Depois execute:

```bash
node scripts/sync-schedule-links.mjs
node scripts/sync-schedule-links.mjs --check
```

### Um material comum abriu no Pages

Isso indica erro no gerador, exceto quando o arquivo está na pasta explícita
`AAAA.S/assets/`. Slides e ativos compartilhados do semestre abrem no Pages;
os demais recursos devem apontar para `github.com/.../tree/<sha>/...` ou
`github.com/.../blob/<sha>/...`.

### O workflow não executou em uma branch antiga

O GitHub usa o workflow presente naquela própria revisão. Atualize a branch a
partir da branch padrão antes de continuar.

## Checklist antes do merge

- [ ] O README raiz lista todos os semestres existentes.
- [ ] `SEMESTER` no `.env` aponta para o semestre que está sendo atualizado.
- [ ] `SEMESTER` coincide com `course.config.json/site.currentSemester`.
- [ ] `TAB` usa o nome literal da aba importada.
- [ ] `course.config.json` e `schedule.json` validam contra seus schemas.
- [ ] O README do semestre contém os dados básicos e um único cronograma.
- [ ] O cronograma tem exatamente quatro colunas.
- [ ] IDs preenchidos usam `aula-NN` e repetições foram preservadas.
- [ ] Cada tópico de aula aponta para a pasta correta.
- [ ] `node scripts/sync-schedule-links.mjs --check` passou.
- [ ] Toda aula contém `slides/`.
- [ ] `academic.config.ts` e o título de `slides.md` foram atualizados.
- [ ] Os arquivos em `AAAA.S/assets/` são públicos e aparecem no mesmo caminho em `_site/`.
- [ ] Atividades e materiais não foram copiados para `_site/`.
- [ ] Nenhuma nota do professor foi publicada.
- [ ] Não há `.env`, credencial ou dado pessoal no commit.
- [ ] `npm run check` passou.
- [ ] `npm run build` passou.
- [ ] O preview foi revisado em tela larga e estreita.
- [ ] O pull request foi integrado na branch padrão.
- [ ] O deploy terminou e a URL pública foi testada.

## Referências

- [GitHub Pages com workflows personalizados](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Configuração da fonte de publicação](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Build e hospedagem do Slidev](https://sli.dev/guide/hosting)
- [Template Slidev acadêmico](https://github.com/filipefernandesphd/my-slidev-template)
