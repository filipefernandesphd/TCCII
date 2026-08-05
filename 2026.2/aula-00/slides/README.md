# Template acadêmico para Slidev

Template reutilizável de apresentações acadêmicas construído com
[Slidev](https://sli.dev/) e a variante Minimal do
[Tahta](https://github.com/zcag/tahta). A identidade visual usa uma base clara e
editorial com a paleta `#5BC0BE`, `#0B132B`, `#1C2541` e `#3A506B`.

Os dados institucionais têm uma única fonte de verdade. A capa lê título, curso,
disciplina e professor do arquivo `academic.config.ts`; o mesmo arquivo alimenta
o rodapé de todos os demais slides.

## Requisitos

- Node.js `22.18+` ou `24.11+`;
- npm, incluído na instalação do Node.js.

## Instalação

```bash
git clone <URL_DO_REPOSITORIO>
cd my-slidev-templates
npm install
```

Para iniciar o ambiente de edição:

```bash
npm run dev
```

O Slidev abre a apresentação no navegador e recarrega as mudanças
automaticamente.

## Uso

### 1. Configure a apresentação

Edite somente o objeto exportado em `academic.config.ts`:

```ts
export const academicConfig = {
  courseName: 'Nome do curso',
  subjectName: 'Nome da disciplina',
  subjectAcronym: 'SIGLA',
  subjectCode: 'COD-0000',
  professorName: 'Prof. Nome do Professor',
  professorContact: 'professor@instituicao.br',
  presentationTitle: 'Título da apresentação',
}
```

| Campo | Conteúdo |
|---|---|
| `courseName` | Nome do curso |
| `subjectName` | Nome completo da disciplina |
| `subjectAcronym` | Sigla exibida na capa e no rodapé |
| `subjectCode` | Código institucional da disciplina |
| `professorName` | Nome do professor |
| `professorContact` | E-mail ou outro contato |
| `presentationTitle` | Título da capa e do rodapé |

Não repita esses valores em `slides.md`: a capa e o rodapé importam a
configuração automaticamente.

### 2. Escreva os slides

Edite `slides.md`. O primeiro slide já usa o layout obrigatório
`academic-cover`. Separe os demais slides com `---` e escolha um layout do Tahta
no frontmatter:

```md
---
layout: default
kicker: Conceito central
title: Título do slide
---

- Primeiro ponto
- Segundo ponto
```

O arquivo demonstrativo inclui exemplos de seção, conteúdo padrão, duas colunas,
estatísticas, citação e encerramento. O catálogo completo de layouts está na
[documentação do Tahta](https://github.com/zcag/tahta#layouts).

### 3. Gerencie referências e citações

O template usa
[`slidev-addon-citations`](https://github.com/aeudes/slidev-addon-citations)
para carregar referências BibTeX. O arquivo padrão é
`public/biblio/references.bib`.

Adicione ou cole nesse arquivo uma entrada com uma chave única:

```bibtex
@article{Sobrenome2026Assunto,
  author  = {Sobrenome, Nome},
  title   = {Título do artigo},
  journal = {Nome do periódico},
  year    = {2026}
}
```

A chave vem logo após o tipo da entrada. No exemplo, ela é
`Sobrenome2026Assunto` e deve ser escrita exatamente da mesma forma em
`slides.md`. Para inserir uma citação no texto, use a sintaxe Markdown:

```md
Esta afirmação tem uma fonte [@Sobrenome2026Assunto].
```

O componente Vue do addon produz o mesmo resultado:

```md
Esta afirmação tem uma fonte <Cite bref="Sobrenome2026Assunto" />.
```

Para listar as referências carregadas dentro de qualquer layout, use:

```md
<BiblioList />
```

Também é possível dedicar um slide à bibliografia com o layout do addon:

```md
---
layout: biblio
---

# Referências
```

O headmatter de `slides.md` já ativa o addon e aponta para o arquivo padrão:

```yaml
addons:
  - slidev-addon-citations
biblio:
  filename: references.bib
  show_full_bib: true
  show_id: false
```

`show_full_bib: true` faz a bibliografia mostrar todas as entradas carregadas,
inclusive quando o slide é aberto diretamente. Defina-o como `false` para listar
somente as referências processadas durante a navegação pela apresentação.
`show_id: false` oculta a chave BibTeX na lista final.

Para trocar o nome, coloque o novo arquivo em `public/biblio/` e altere
`biblio.filename`. Para carregar vários arquivos dessa pasta, use uma lista:

```yaml
biblio:
  filename:
    - references.bib
    - leituras-complementares.bib
```

`references.bib` continua sendo o padrão do template. Cada chave deve ser única
entre todos os arquivos carregados.

### 4. Escolha a proporção

A apresentação usa `4:3` por padrão. A proporção é configurada no headmatter de
`slides.md`:

```yaml
aspectRatio: 4/3
```

Para usar o formato widescreen, troque somente essa linha:

```yaml
aspectRatio: 16/9
```

### 5. Gere os artefatos

```bash
# Build estático em dist/
npm run build

# Exportação da apresentação
npm run export
```

O comando de exportação pode solicitar a instalação do navegador do Playwright
na primeira execução. Consulte a
[documentação de exportação do Slidev](https://sli.dev/guide/exporting) para
opções de PDF, PPTX e PNG.

## Estrutura do projeto

```text
.
├── academic.config.ts        # fonte única dos dados acadêmicos
├── components/
│   └── AcademicFooter.vue    # rodapé global, exceto na capa
├── layouts/
│   └── academic-cover.vue    # layout obrigatório do primeiro slide
├── public/
│   └── biblio/
│       └── references.bib    # referências BibTeX da apresentação
├── setup/
│   └── transformers.ts       # converte [@chave] para o componente do addon
├── global-top.vue            # monta o rodapé sobre os layouts do tema
├── slides.md                 # conteúdo da apresentação
├── style.css                 # tokens da paleta e estilos locais
├── prompts/                  # prompts usados para criar o template
├── skills/                   # instruções contextuais para agentes de IA
├── AGENTS.md                 # regras de colaboração para agentes
└── package.json              # scripts e dependências
```

## Personalização visual

As cores ficam centralizadas como tokens no início de `style.css`. Altere esses
tokens para criar outra identidade sem procurar valores espalhados pelo projeto.
O restante dos estilos remapeia os tokens semânticos do Tahta para preservar
tipografia, espaçamento e componentes da variante Minimal. Elementos originalmente
pretos nessa variante usam o mesmo azul-marinho `#0B132B` do título da capa.

O rodapé nativo do Tahta é ocultado para evitar duplicação. O componente
`AcademicFooter.vue` mostra, à esquerda, o título, a sigla e o professor; à
direita, mostra o slide atual e o total. O componente usa a navegação do Slidev e
não é renderizado no slide 1.

## Manutenção

Antes de atualizar dependências:

```bash
npm outdated
```

Depois de uma atualização, execute:

```bash
npm install
npm run build
```

As dependências `@citation-js/*` estão fixadas em `0.7.21` por compatibilidade
entre `slidev-addon-citations@0.0.13`, o navegador e a versão atual do Slidev.
Antes de remover essas resoluções de `package.json`, atualize o addon e valide
novamente uma citação e a bibliografia no navegador.

Revise visualmente pelo menos a capa, um slide de conteúdo e o encerramento.
Confirme que o slide 1 continua sem rodapé, que os demais exibem uma única
numeração e que conteúdo longo não alcança a área reservada ao rodapé.

Artefatos locais como `node_modules/` e `dist/` já estão ignorados pelo Git.

## Créditos

Este projeto usa [Slidev](https://sli.dev/) e
[slidev-theme-tahta](https://github.com/zcag/tahta), distribuído sob licença MIT
por Cagdas Salur. Consulte as licenças das dependências antes de redistribuir uma
versão modificada.
