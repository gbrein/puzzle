# Contratos — rodada 2 (cor ao vivo, dificuldade, moldura e placas)

> Mesmas regras da rodada 1 (`contratos-m4.md`): mesmo checkout, posse de arquivo é lei, **ninguém
> commita**, `npm test` e `npm run typecheck` verdes no fim, tudo em português do Brasil, corte
> deliberado leva comentário `ponytail:`. O que muda é a divisão abaixo.

## Posse de arquivos

| Lane | Escopo | Arquivos |
|---|---|---|
| **A** | Seletor de cor + paleta ao vivo | `src/ui/filamentos.ts`, `src/ui/paleta.ts` (novo), `src/ui/filamentos.css` (novo) |
| **B** | Dificuldade, consequências e preview ao vivo | `src/ui/main.ts`, `src/ui/dificuldade.ts` (novo), `src/style.css` |
| **C** | Moldura, placas e 3MF multi-placa | `src/generate.ts`, `src/export/threemf.ts` + teste, `src/jigsaw/plates.ts`, `src/mesh/frame.ts` |

`package.json`, `vite.config.ts`, `index.html`, `docs/**` seguem sendo do orquestrador. Nenhuma
dependência nova. Restante do núcleo M0–M3 continua congelado (a lane C tem o `threemf.ts`
destravado **só para o suporte a múltiplas placas**, nada além).

CSS: cada lane no seu arquivo. A lane A importa `./filamentos.css` do próprio `filamentos.ts`
(o Vite resolve); a lane B fica com o `style.css` global. Assim ninguém edita o CSS do outro.

## Contrato A → B (a lane B consome)

```ts
// src/ui/paleta.ts — lane A escreve, lane B pode usar
/** Barra com as L+1 cores que a pilha atual produz + o medidor de gama. */
export function montarPaleta(container: HTMLElement, estado: Filament[], opts: {
  layers: number; layerHeight: number; baseLayers: number
}): void
```

**A honestidade desta barra importa mais que a fluidez.** `buildPalette` custa 0 ms, mas ele
precisa de um `LayerPlan`, e quem escolhe o cronograma de verdade é o `searchSchedule` — que custa
621 ms e só roda na geração. Então a barra ao vivo monta um plano com **divisão uniforme** dos
filamentos escolhidos e precisa dizer isso na tela ("prévia — o cronograma final é escolhido ao
gerar"), com um `ponytail:` no código nomeando o teto e o upgrade (refinar pelo worker quando ocioso).
Barra que finge ser o resultado final é pior que barra nenhuma.

## Contrato C → B (a lane B consome; a lane C implementa)

```ts
// src/generate.ts — lane C
GenerateOptions += {
  /** Inclui a moldura com pé de 30° como objeto extra. */
  frame?: boolean
  /** Mesa útil, em mm. Default 256×256 (X1C). */
  bedWidth?: number
  bedHeight?: number
}

GenerateResult.stats += {
  /** Quantas placas a impressão vai precisar. */
  plates: number
  /** Massa estimada de filamento, em gramas: signedVolume(mesh) × 1,24 g/cm³ (PLA). */
  grams: number
}
GenerateResult += {
  /** Mapa de montagem: peça original → placa e posição. */
  placement: PlacedPiece[]
}
```

Enquanto a lane C não entregar, a lane B trata `plates`/`grams`/`placement` como opcionais e só
mostra quando vierem. **Não estime placas nem gramas antes de gerar** — o número exato sai da
geração; número chutado na tela vira reclamação.

## Lane A — seletor de cor

O defeito que você está consertando: hoje a pessoa escolhe filamento lendo nome de marca numa lista
de texto, e só descobre que as cores escolhidas não alcançam a foto **depois** de 2 segundos de
geração. Veja `docs/plano-ui.md` §1.

1. **Grade de amostras ordenada por matiz.** Quadrados grandes de cor, ordenados por H e L (converta
   com `rgbToLab` de `src/color/space.ts`; matiz = `atan2(b, a)`). O nome vira legenda secundária e
   `title`. Mantenha uma busca por texto para quem sabe o rolo que tem.
2. **Cada amostra mostra o TD visualmente**, não como número solto: desenhe a rampa daquele
   filamento empilhado em 1/2/4/8 camadas sobre a base atual, com `buildPalette` (custa 0 ms). É o
   ponto central — dois vermelhos com TD 0,3 e 3,3 se comportam de forma completamente diferente, e
   só a cor esconde justamente a propriedade que decide o resultado.
3. **`paleta.ts`**: a barra das L+1 cores da seleção atual + medidor de `paletteSpan` com o corte em
   40 marcado, e o texto do aviso quando ficar abaixo. Calcule o span como o `generate.ts` calcula
   (maior ΔE entre duas entradas quaisquer da paleta, não primeira contra última — cronograma que
   volta pro filamento da base fecharia o ciclo e daria ~0).
4. Mantenha o que já funciona: ordem do cronograma com ↑↓, remover, rolo manual. No rolo manual
   troque a entrada de hex por `<input type="color">` + campo de TD.
5. Não quebre `montarFilamentos({container, estado, aoMudar})` — a lane B chama por essa assinatura.

## Lane B — dificuldade, consequências e preview ao vivo

Veja `docs/plano-ui.md` §2 e §3.

1. **`dificuldade.ts`**: Fácil ~35 mm · Médio ~25 mm · Difícil ~18 mm · Insano ~13 mm (lado alvo da
   peça). `pieceCount = round((largura × altura) / lado²)` e a tela mostra a consequência: "Médio —
   34 peças de ~25 mm". O slider cru de peças vai para o avançado, com **piso calculado** a partir
   de `extrusionWidth` em vez do 4 arbitrário de hoje: peça pequena demais deixa o pescoço da aba
   com menos de dois ou três filetes de extrusão e ela quebra ao desencaixar. Avise no "Insano".
2. **Essencial × avançado.** Essencial: foto, cores, tamanho, dificuldade. Avançado recolhido:
   `layerHeight`, `baseThickness`, `maxSwaps`, `kerf`, `extrusionWidth`, `dither`, preset de
   impressora, `swapMode`. `kerf` se calibra uma vez na vida e hoje tem o mesmo peso visual que a
   escolha criativa.
3. **Preview 2D ao vivo.** Medido: `solveHeights` + `renderHeightMap` custam 7 ms e `searchSchedule`
   custa 621 ms. Então: mexeu em tamanho, peças ou kerf, **o resultado de cor não muda — não
   recalcule nada**; mexeu em filamento, camadas ou base, recalcule com debounce, pelo worker.
   "Gerar" passa a significar só geometria + `.3mf`.
4. **Preview protagonista**: coluna direita `position: sticky`, sempre visível; 2D e 3D alternando no
   mesmo quadro, 2D por default. Estado vazio que diz o que vai aparecer ali e o que falta fazer —
   hoje é um retângulo preto.
5. Quando os campos novos vierem da lane C, mostre `plates` e `grams` nos stats.

## Lane C — moldura, placas e 3MF multi-placa

Você é a única lane que mexe no núcleo. `buildFrame` e `layoutPlates` já existem, testados, e estão
**desligados** — não aparecem em lugar nenhum.

1. **`frame?: boolean` no `generatePuzzle`**: quando ligado, `buildFrame` entra como objeto extra,
   dimensionado pela placa montada (`puzzle.width`/`puzzle.height`).
2. **`layoutPlates` aplicado de verdade**: as peças saem posicionadas na mesa, e `placement` vai no
   resultado. `stats.plates` e `stats.grams` conforme o contrato acima (`signedVolume` já existe em
   `mesh.ts`; PLA = 1,24 g/cm³).
3. **O trabalho de verdade: o `threemf.ts` é single-plate hardcoded.** Hoje ele escreve
   `plater_id` fixo em 1 e um `<plate_info id="1"/>` só. Múltiplas placas exigem estender o writer:
   uma entrada por placa em `Metadata/model_settings.config`, o mapeamento objeto→placa, e um bloco
   `<plate>` por placa no `custom_gcode_per_layer.xml` com as trocas repetidas em cada uma.
   **Não invente o formato**: o `docs/plano.md` §"O `.3mf` de projeto" tem os cuidados já
   verificados (cor vem de `filament_colour` 0-indexado, slots em `model_settings` são 1-indexados),
   e o `threemf.test.ts` já reabre o zip e faz parse — estenda esse teste para conferir que cada
   placa tem o bloco dela e que os `top_z` das trocas continuam batendo com o cronograma.
4. Se o multi-placa se mostrar mais fundo do que cabe nesta rodada, **entregue 1 e 2 completos e
   pare**, dizendo exatamente onde travou — melhor isso que um 3MF que o slicer recusa.
