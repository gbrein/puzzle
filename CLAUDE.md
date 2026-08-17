# CLAUDE.md — puzzle

Gerador de quebra-cabeças imprimíveis a partir de fotos, 100% no navegador. Leia o `README.md`
(o que é, como as cores funcionam) e o `docs/plano.md` (decisões travadas, arquitetura, marcos)
antes de mexer. **Onde parei** está em `docs/plano.md` → "Estado atual".

Idioma de tudo — código, commits, comentários, respostas: **português do Brasil.**

## Rodar

```bash
npm install
npm test                                              # asserts, sem framework
node src/cli.ts --size 180 --aspect 1.5 --pieces 12 --out puzzle.stl
```

Precisa de **Node ≥ 22.18** — os testes rodam `.ts` direto com o type stripping nativo
(`node --test 'src/**/*.test.ts'`). Sem build step, sem tsc, sem jest/vitest.

## Regras que não se negociam

- **Núcleo livre de DOM.** Tudo em `src/` (fora `ui/`, `preview/`) roda igual no Node e no
  navegador. É isso que deixa o CLI e os testes existirem.
- **Testes são asserts do runner do Node.** Nada de framework novo. Um `*.test.ts` ao lado do
  módulo que ele testa.
- **Dependências permissivas e contadas.** Hoje: `earcut` (ISC), `clipper-lib` (Boost),
  `fflate` (MIT). Adicionar uma é decisão, não conveniência. `clipper2-js` já foi testado e
  descartado (offset errado até pra um quadrado).
- **Encaixe é por construção.** Peças vizinhas usam literalmente a *mesma* polilinha de aresta,
  uma invertida. Nunca gere as duas arestas separadamente "que dá no mesmo" — não dá.
- **Peça = base vetorial + relevo raster.** Silhueta do polígono bezier extrudado; relevo do
  greedy meshing recortado pela máscara com 1 célula de inset (pra nada ficar em balanço).
- **Cortes deliberados levam comentário `ponytail:`** nomeando o teto e o caminho de upgrade.

## Calibração é física, não matemática

`kerf` (0,4mm) e o `TD` dos filamentos são **defaults de leitura, não de medição**. Nenhum teste
cobre "encaixou na mão" nem "o slicer aceitou o `.3mf`". Trate esses números como knobs expostos,
nunca como constantes acertadas.

## Vault (segundo cérebro)

O roadmap e o log vivem fora deste repo, em `gbrein/vault` → `projetos/puzzle/`. Ao fechar uma
unidade de trabalho aqui, **logue lá também** — o repo guarda o código, o vault guarda a trilha.
Se o vault não estiver clonado nesta máquina, siga só o `docs/plano.md` e avise.
