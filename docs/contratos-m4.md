# Contratos M4/M5 — divisão de trabalho entre agentes

> Documento de coordenação de **uma rodada**. Três agentes trabalham no **mesmo checkout**
> (`C:/Users/gbrei/Ai/projetos/puzzle`, branch `main`), em paralelo. A única coisa que impede
> um pisar no outro é a tabela de posse abaixo. **Não edite arquivo que não é seu.**

## Posse de arquivos (regra dura)

| Lane | Agente | Arquivos que pode criar/editar |
|---|---|---|
| **A — App shell + UI** | OpenCode #1 | `src/ui/**`, `index.html`, `src/style.css` |
| **B — Preview + Worker** | OpenCode #2 | `src/preview/**`, `src/worker/**`, `src/generate.ts` (só a linha do `mesh`) |
| **C — M5 geometria** | Claude Code | `src/jigsaw/plates.ts`, `src/mesh/frame.ts` + os `*.test.ts` desses dois |

Fora da tabela, ninguém edita:

- `package.json` / `package-lock.json` → **do orquestrador**. Precisa de dependência nova? Pare e peça.
  Já instalados e disponíveis: `vite` (dev), `three`, `earcut`, `clipper-lib`, `fflate`.
- `vite.config.ts`, `tsconfig.json`, `docs/**`, `README.md`, `CLAUDE.md` → do orquestrador.
- `src/color/**`, `src/jigsaw/{grid,tabs,kerf,mask}.ts`, `src/mesh/{extrude,heightmap,mesh}.ts`,
  `src/export/**`, `src/puzzle.ts`, `src/cli.ts` → **congelados**. São M0–M3, testados. Achou bug?
  Não conserte: escreva em `docs/achados.md` (append, uma linha) e siga.

## Ninguém commita

Sem `git commit`, sem `git add`, sem `git stash`, sem trocar de branch. O orquestrador revisa e
commita no fim. Três agentes commitando no mesmo checkout produz histórico corrompido.

## Regras herdadas (valem para todos)

- Português do Brasil em código, comentários e nomes.
- `npm test` tem que continuar verde. Rode antes de se declarar pronto.
- Núcleo (tudo em `src/` fora `ui/`, `preview/`) roda sem DOM. Testes são asserts do runner do
  Node (`node --test`), um `*.test.ts` ao lado do módulo. Sem framework novo.
- Corte deliberado leva comentário `ponytail:` nomeando o teto e o caminho de upgrade.
- Node ≥ 22.18, type stripping nativo. Imports relativos levam a extensão `.ts`.

## A API do núcleo (já existe, não mexa)

```ts
import { generatePuzzle, type GenerateOptions, type GenerateResult } from '../generate.ts'

generatePuzzle({
  image,            // Bitmap { width, height, data: Uint8ClampedArray }  ← RGBA, igual ao ImageData
  filaments,        // Filament[] { id, name, hex, td, estimated? }       ← ESCOLHA do usuário
  size, pieceCount, kerf, seed,
  layers, layerHeight, baseThickness, maxSwaps, dither,
  extrusionWidth, cellSize, swapMode, printerModel,
}): GenerateResult
```

`GenerateResult` = `{ threemf: Uint8Array, stl: Uint8Array, swaps: string, plan, palette, preview: Bitmap, stats }`.

`stats` = `{ cols, rows, pieces, width, height, cells, triangles, meshMB, swaps, deltaE, totalHeightMm, paletteSpan }`.

Catálogo de filamentos: `import { FILAMENTS } from '../filaments/db.ts'`.

## Contrato entre a lane A e a lane B

A lane A **não** chama `generatePuzzle` direto (travaria a aba). Chama o worker da lane B.
Este é o contrato — a lane B implementa, a lane A consome. Assinaturas exatas, sem negociar:

```ts
// src/worker/client.ts  (lane B escreve, lane A importa)
export interface Progresso { etapa: string; pct: number }

/** Roda generatePuzzle num Web Worker. `onProgresso` é opcional. */
export function gerarNoWorker(
  opts: GenerateOptions,
  onProgresso?: (p: Progresso) => void,
): Promise<GenerateResult>

/** Cancela a geração em curso, se houver. */
export function cancelar(): void
```

```ts
// src/preview/preview2d.ts  (lane B escreve, lane A importa)
/** Desenha o Bitmap `preview` (a cor resolvida) no canvas, escalando por nearest. */
export function desenharPreview2D(canvas: HTMLCanvasElement, preview: Bitmap): void

// src/preview/preview3d.ts  (lane B escreve, lane A importa)
export interface Visualizador3D {
  mostrar(mesh: Mesh): void
  redimensionar(): void
  destruir(): void
}
/** Cria a cena three.js (orbit, luz, fundo). Chame `destruir` ao trocar de resultado. */
export function criarVisualizador3D(container: HTMLElement): Visualizador3D
```

Para o preview 3D a lane B expõe a malha: **acrescenta `mesh: Mesh` ao `GenerateResult`** em
`src/generate.ts` (o objeto `mesh` já existe na função, é só devolvê-lo no return e declarar o
campo na interface). Uma linha em cada lugar — é a única edição autorizada fora de `preview/` e
`worker/`. Não parseie o STL de volta.

**Enquanto a lane B não entregou:** a lane A escreve contra essas assinaturas e stuba localmente
em `src/ui/` (um `gerarNoWorker` que chama `generatePuzzle` síncrono serve). Ao final a lane A
troca o import do stub pelo módulo real e apaga o stub.

## Lane A — App shell + UI (OpenCode #1)

Objetivo: `npm run dev` abre um app onde a pessoa sobe uma foto, escolhe cores e baixa o `.3mf`.

1. **Upload + crop.** `<input type="file">` + drag-and-drop. `createImageBitmap` → canvas →
   `getImageData` → `Bitmap`. Crop livre com proporção arrastável (retângulo sobre o canvas,
   sem lib). Reamostragem final fica com o núcleo — a UI só entrega o recorte.
2. **Controles.** Tamanho (100/140/180/210/250mm), contagem de peças, `layers`, `layerHeight`,
   `baseThickness`, `maxSwaps`, `kerf`, `dither`, preset de impressora (genérico 0.4 é o default),
   `swapMode` (manual/ams).
3. **Seletor de filamentos** — é o controle central. Lista de `FILAMENTS` com amostra da cor,
   multi-seleção ordenável, e entrada manual (hex + TD) para rolo fora do catálogo. Marque com
   um aviso os que têm `estimated: true`.
4. **Aviso de gama.** Depois de gerar, se `stats.paletteSpan < 40`, mostre em destaque: as cores
   escolhidas não alcançam essa foto — aumente as camadas ou escolha cores mais contrastantes.
   O número vem pronto, não recalcule.
5. **Downloads.** `.3mf` (principal), `.stl` e `swaps.txt` (rede de segurança). `Blob` + `URL.createObjectURL`,
   revogue depois.
6. **Estado e erros.** Spinner durante a geração (é ~2,5s para 30 peças), `stats` visíveis
   (peças, triângulos, MB, ΔE, altura total, nº de trocas), e mensagem legível quando
   `generatePuzzle` lançar (ele valida as entradas e joga `Error` com texto em português).

CSS à mão em `src/style.css`. Sem framework de UI, sem componente de biblioteca. Vanilla TS +
DOM direto — o `docs/plano.md` dizia React, foi decidido contra: a UI não tem estado que justifique.

## Lane B — Preview 2D/3D + Worker (OpenCode #2)

1. **Worker.** `src/worker/gerar.worker.ts` + `src/worker/client.ts` com o contrato acima.
   `new Worker(new URL('./gerar.worker.ts', import.meta.url), { type: 'module' })`.
   Transfira os buffers de volta (`postMessage(res, [transferíveis])`) — copiar 5MB por valor
   custa caro. Erro do worker vira `reject` com a mensagem original, não "erro desconhecido".
2. **Progresso.** `generatePuzzle` hoje não reporta progresso. Não reescreva o núcleo para isso:
   emita etapas grossas em volta das chamadas que o worker já faz, ou etapas fixas. Se ficar
   caro, entregue só `{ etapa, pct }` com pct em degraus e um `ponytail:` explicando o teto.
3. **Preview 2D.** Canvas com `putImageData` do `result.preview` (é RGBA, cabe direto num
   `ImageData`), escalado por nearest — é a cor que vai sair impressa, borrar mente.
4. **Preview 3D.** three.js: `BufferGeometry` a partir de `mesh.positions`/`mesh.indices`
   (já é Float32Array/Uint32Array indexado — use direto, sem converter), `computeVertexNormals`,
   OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), luz ambiente + direcional,
   câmera enquadrando o bounding box. `destruir` libera geometria, material e o renderer
   (`renderer.dispose()`), senão trocar de resultado vaza GPU.
5. **RSS.** A geração come ~320MB numa placa de 180mm. Rodar no worker já tira isso da thread
   principal — se der para baixar mais sem tocar no núcleo congelado, ótimo; se não, anote em
   `docs/achados.md` e siga. Não refatore `src/mesh/**`.

## Lane C — M5 geometria (Claude Code)

Núcleo puro, sem DOM, com testes. É o marco M5 do `docs/plano.md`.

1. **`src/mesh/frame.ts` — moldura com pé 30°.** Uma moldura que recebe a placa montada
   (largura × altura em mm) e devolve uma `Mesh` fechada: aro em volta do quebra-cabeça, com
   rebaixo onde as peças assentam, mais um pé traseiro inclinado a 30° para o conjunto ficar de
   pé na mesa. Parâmetros expostos: largura do aro, profundidade do rebaixo, folga contra a
   placa, ângulo do pé. Ela imprime deitada, sem suporte — o pé é parte da geometria, não um
   apêndice em balanço.
2. **`src/jigsaw/plates.ts` — auto plate split.** Recebe as peças (`PuzzlePiece[]`, cada uma com
   `ring` e `mesh`) e o tamanho útil da mesa (default: 256×256mm do X1C; exponha como parâmetro)
   e distribui em placas: bin packing simples por bounding box, com espaçamento configurável.
   Devolve as placas, a transformação aplicada a cada peça e um **mapa de montagem** (que peça
   original está em que placa/posição) — quem imprime precisa saber remontar.
3. **Testes** (`frame.test.ts`, `plates.test.ts`), asserts do runner do Node:
   - a malha da moldura é fechada (toda aresta com exatamente 2 faces — use `findOpenEdges`
     de `src/mesh/mesh.ts`, é o que os testes de M0 já usam);
   - o pé sai no ângulo pedido (cheque a normal ou a razão altura/avanço);
   - nenhuma peça cai fora da mesa útil, e nenhum par de bounding boxes se sobrepõe;
   - toda peça de entrada aparece exatamente uma vez no mapa de montagem.
4. **Não integre no `generatePuzzle`.** A lane B mexe nesse arquivo. Entregue os dois módulos
   com API limpa e testada; a fiação vem numa rodada seguinte.

## Ao terminar

Rode `npm test` (e, se for lane A ou B, `npm run build` também), escreva um resumo curto do que
entregou e do que ficou de fora, e **pare** — sem commitar. O orquestrador revisa, integra e commita.
