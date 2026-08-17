# Achados

Coisas notadas de passagem que **não** cabiam na tarefa de quem notou — bug no núcleo congelado,
número suspeito, atrito. Uma linha por achado, append no fim, com a data e o arquivo. Não conserte
o que não é seu: registre aqui e siga.

- **2026-08-17** — `package.json`: o script de teste usava aspas simples no glob (`'src/**/*.test.ts'`),
  que o shell do Windows não expande — `npm test` rodava **0 testes e saía verde**. Trocado por aspas
  duplas. Se voltar a aparecer 0 teste, é isso.
- **2026-08-17** — `src/ui/filamentos.ts`: o painel mutava o estado e chamava só o callback de fora,
  sem redesenhar — clicar numa amostra não mudava nada na tela. Corrigido, **e a reescrita seguinte
  reintroduziu o mesmo bug**. Se você for mexer neste arquivo: toda mutação (`selecionar`, `mover`,
  cadastrar rolo manual) passa por `mudou()`, que faz `render()` **e** `aoMudar()`. Chamar
  `aoMudar()` direto é o bug voltando.
- **2026-08-17** — `src/ui/filamentos.ts`: a lista ordenada por matiz era calculada uma vez na
  partida, com `manuais` ainda vazio — rolo cadastrado à mão nunca aparecia na grade. Virou função,
  recalculada a cada render.
