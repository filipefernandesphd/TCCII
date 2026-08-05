---
theme: slidev-theme-tahta
title: Template acadêmico Slidev
aspectRatio: 4/3
info: |
  Apresentação demonstrativa do template acadêmico.
themeConfig:
  variant: minimal
addons:
  - slidev-addon-citations
biblio:
  filename: references.bib
  show_full_bib: true
  show_id: false
mdc: true
routerMode: hash
layout: academic-cover
---

---
layout: section
index: "01"
kicker: Roteiro
title: Uma narrativa clara começa pela estrutura
---

---
layout: default
kicker: Conceito central
title: Conteúdo que deixa a ideia principal respirar
---

- Use uma mensagem central por slide
- Transforme detalhes em evidências visuais ou exemplos
- Mantenha a hierarquia tipográfica consistente
- Termine cada seção com uma conclusão acionável

---
layout: two-cols
kicker: Organização
title: Teoria e prática, lado a lado
---

### Fundamentos

- Apresente o conceito
- Delimite o problema
- Explique o método

::right::

### Aplicação

- Mostre um exemplo
- Discuta o resultado
- Relacione com a disciplina

---
layout: stats
kicker: Evidências
title: Números ganham força quando contam uma história
stats:
  - { value: 3, label: ideias essenciais }
  - { value: 15, unit: min, label: para apresentar }
  - { value: 1, label: conclusão memorável }
---

---
layout: default
kicker: Referências
title: Evidências acompanham a narrativa
---

Reduzir informações concorrentes ajuda a administrar a carga cognitiva durante
a aprendizagem [@Sweller1988CognitiveLoad].

- Mantenha a fonte próxima da afirmação que ela sustenta
- Use no slide a mesma chave definida no arquivo BibTeX
- Reúna ao final as obras relevantes para a apresentação

---
layout: quote
quote: Uma boa apresentação reduz a distância entre uma ideia complexa e quem precisa compreendê-la.
author: Princípio do template
---

---
layout: default
kicker: Fontes
title: Referências
---

<BiblioList />

---
layout: end
kicker: Encerramento
title: Obrigado
subtitle: Perguntas e discussão
---
