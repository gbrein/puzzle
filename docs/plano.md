# puzzle — gerador open-source de quebra-cabeças imprimíveis a partir de fotos

## Estado atual (2026-08-17)

**M0 a M5 fechados.** 151 testes verdes, typecheck limpo (`npm run typecheck`), e o app roda no
navegador: foto → recorte → cores → `.3mf`, com preview 2D da cor resolvida ao vivo e preview 3D
do relevo. A moldura com pé de 30° e o auto plate split estão ligados no `generatePuzzle`, e o
writer do 3MF deixou de ser single-plate — cada placa sai com seus objetos e suas trocas.

O seletor de cor é por **cor, não por nome de rolo**: grade de amostras ordenada por matiz, cada
uma mostrando a rampa daquele filamento empilhado em 1/2/4/8 camadas. A gama da paleta
(`paletteSpan`) aparece **enquanto** se escolhe, com o corte em 40 — não mais depois de gerar.

A próxima rodada está em [`plano-ui.md`](plano-ui.md) §4: sugestão de cores pela foto, mapa de
montagem visível, teste de folga imprimível, wizard de calibração de TD, salvar/carregar.

**Próxima ação — M4, a interface web:** upload + crop, seletor de quantas/quais cores, sliders,
preview 2D e 3D, deploy no GitHub Pages. O núcleo é livre de DOM, então a UI entra por cima sem
refatorar nada. O seletor de cores é o controle central: `stats.paletteSpan` alimenta o aviso de
"essas cores não alcançam essa foto".

**M4 e M5 estão sendo tocados em paralelo por três agentes.** A divisão de posse de arquivos e os
contratos entre as lanes estão em [`contratos-m4.md`](contratos-m4.md) — leia antes de editar
qualquer coisa em `src/ui`, `src/preview`, `src/worker`, `src/mesh/frame.ts` ou `src/jigsaw/plates.ts`.

**A UI é vanilla TS + DOM, não React** (decisão de 2026-08-17, contra o que este plano dizia
antes): a interface é upload/crop/sliders/preview, não tem estado que justifique o framework e as
dependências são contadas.

Pendências que não são código:

- 🔒 Abrir um `.3mf` gerado no Bambu Studio / Orca — nenhum teste cobre "o slicer aceita".
- 🔒 Imprimir o teste de encaixe — o kerf default (0,4mm) veio de leitura, não de medição.
- 🔧 Reduzir o RSS da geração — 320MB numa placa de 180mm (era 775MB). Pesado pra aba de navegador.

> A trilha completa (o que mudou e quando) está no vault: `projetos/puzzle/log.md` e
> `projetos/puzzle/roadmap.md` em `github.com/gbrein/vault`.

## Contexto

O [TanskyLab](https://makerworld.com/en/crowdfunding/332-tanskylab-custom-photo-puzzle-generator)
vende (crowdfunding, 518% financiado) um gerador web que transforma qualquer foto num
quebra-cabeça imprimível: o usuário sobe a imagem, corta, escolhe tamanho e filamentos, e baixa
**um único `.3mf` de projeto** que abre no Bambu Studio já com as trocas de cor embutidas — sem
CAD, sem HueForge, sem swap manual. É pago, fechado e com plano mensal.

Este projeto é a versão open-source disso. O que não existe hoje em aberto é justamente a
**junção**: [Kromacut](https://github.com/vycdev/Kromacut) (AGPL-3.0, é app e não biblioteca) já
faz "imagem → camadas de cor → STL/3MF"; [AutoForge](https://github.com/hvoss-techfak/AutoForge)
faz o otimizador de alturas em PyTorch; [Draradech/jigsaw](https://github.com/Draradech/jigsaw)
tem a matemática das peças em bezier. Ninguém junta relevo colorido + corte jigsaw + 3MF de
projeto pronto pra fatiar.

**Resultado esperado:** um site estático, gratuito, sem servidor, onde qualquer pessoa sobe uma
foto e baixa um `.3mf` que fatia e imprime.

## Decisões travadas

| | |
|---|---|
| **Stack** | TypeScript + Vite, 100% client-side. Zero servidor, zero custo, a foto nunca sai da máquina. Deploy no GitHub Pages. |
| **Modelo de cor** | Translúcido tipo HueForge — Beer-Lambert com *transmission distance* por filamento. |
| **Repo / licença** | Repo próprio `gbrein/puzzle` no GitHub, **MIT**. Código vive em `repos/puzzle` (fora do git do vault). |
| **Escopo v1** | Núcleo (foto → peças → 3MF) + preview visual + moldura com suporte 30° + auto plate split. |

## A ideia que simplifica tudo

Duas observações da pesquisa que enxugam o projeto:

**1. Geometria e cor são ortogonais.** Em qualquer modelo (opaco por bandas ou translúcido),
o objeto final é a mesma coisa: uma **pilha monótona de camadas**, onde a camada `i` é impressa
em toda região com `altura(pixel) >= i`, e a troca de filamento acontece num Z global. Isso
significa que a malha é sempre auto-sustentada (nada de balanço) e que o motor de geometria é
escrito **uma vez** — o modelo de cor é só quem decide o mapa de alturas e o cronograma de trocas.

**2. O modelo do HueForge vira uma tabela de L+1 cores.** Com `transmissão = 10^(-espessura/TD)`
e um cronograma de filamentos fixo, a cor visível de um pixel depende **só da sua altura**.
Compõe-se de baixo pra cima uma única vez:

```
C[0] = cor da base (opaca)
C[i] = cor_do_filamento(i) * (1 - T_i) + C[i-1] * T_i,   T_i = 10^(-altura_camada / TD_i)
```

Isso dá uma paleta de `L+1` cores. O mapa de alturas é então "para cada pixel, a altura cuja cor
tem menor ΔE contra o alvo" — O(W·H·L), instantâneo em JS. **Sem PyTorch, sem gradiente,
sem Gumbel softmax.** A busca por bom cronograma (qual filamento em cada faixa) é um loop
por cima disso, num Web Worker.

## Arquitetura

```
src/
  color/
    beer-lambert.ts   composite bottom-up → paleta altura→cor (a tabela acima)
    solver.ts         paleta → mapa de alturas (nearest ΔE) + busca do cronograma de trocas
    dither.ts         Floyd-Steinberg opcional sobre o índice de altura
  filaments/
    db.ts             filamento = { nome, hex, TD_mm }; seed com valores públicos
    calibrate.ts      wizard: imprime amostras em N espessuras → regressão → TD
  jigsaw/
    tabs.ts           curva bezier do encaixe (port da matemática do Draradech/jigsaw)
    grid.ts           grade adaptada ao aspect ratio da foto → polígono por peça
    kerf.ts           offset do polígono pela folga de encaixe (clipper2-js)
    plates.ts         auto plate split + mapa de montagem
  mesh/
    heightmap.ts      greedy meshing do mapa de alturas → caixas (poucos triângulos)
    extrude.ts        polígono 2D + faixa de Z → prisma (base da peça, paredes vetoriais)
    piece.ts          base vetorial + relevo raster recortado pela máscara da peça
    frame.ts          moldura + pé inclinado 30°
  export/
    stl.ts            fallback single-color
    threemf.ts        o zip do projeto (detalhe abaixo)
  ui/                 vanilla TS + DOM: upload, crop, sliders, preview
  preview/            three.js (3D) + canvas (preview 2D da cor resolvida)
  worker/             solver e meshing fora da thread principal
```

**Peça = base vetorial + relevo raster.** A silhueta da peça (que precisa de precisão pro
encaixe) sai do polígono bezier extrudado. O relevo colorido em cima sai do greedy meshing do
mapa de alturas, recortado pela máscara da peça **com 1 célula de inset** pra nunca ficar em
balanço sobre a base.

```ts
// ponytail: relevo recortado por máscara raster com inset de 1 célula — degrau de ~0.1mm
// na borda de cima da peça, invisível abaixo da resolução do bico. Se incomodar, trocar por
// clipping poligonal (marching squares na máscara + boolean com o polígono da peça).
```

**Dependências (todas permissivas):** `three` (MIT), `fflate` (MIT, zip do 3MF),
`clipper2-js` (Boost, offset + boolean 2D). Nada além disso.

## O `.3mf` de projeto

É o coração do produto e o que ninguém entrega em aberto. É um ZIP com:

```
[Content_Types].xml
_rels/.rels
3D/3dmodel.model                   malhas + build items (3MF core)
Metadata/project_settings.config   JSON: filament_colour[], filament_type[], printer_model
Metadata/model_settings.config     XML: placas, objeto→placa, <metadata key="extruder">
Metadata/custom_gcode_per_layer.xml  as trocas de filamento por Z
```

O arquivo que faz a mágica do "sem swap manual":

```xml
<custom_gcodes_per_layer>
  <plate>
    <plate_info id="1"/>
    <layer top_z="0.6" type="1" extruder="2" color="#FFFFFF" gcode="tool_change"/>
    <layer top_z="1.4" type="1" extruder="3" color="#0000FF" gcode="tool_change"/>
  </plate>
</custom_gcodes_per_layer>
```

Cuidados verificados: `filament_colour` (0-indexado) é a fonte de verdade da cor — o atributo
`color` do `<layer>` é decorativo; os slots em `model_settings.config` são 1-indexados; e
`printer_model` precisa bater com a máquina do usuário, então a UI oferece um seletor de preset
(X1C / P1S / A1 / genérico 0.4) e o genérico é o default.

**Rede de segurança:** todo download também gera um `.stl` simples e um `swaps.txt` com as
alturas de troca em texto. Se o 3MF não abrir na máquina de alguém, a pessoa ainda imprime.

## Marcos

- **M0 — Cadeia burra ponta a ponta.** Repo (Vite + TS + MIT), imagem → 1 cor → grade de peças
  retangulares → `.stl`. Prova o pipeline inteiro antes de qualquer sofisticação.
- **M1 — Geometria jigsaw de verdade.** Tabs bezier, grade adaptada ao aspect ratio, kerf.
  *Portão: imprimir uma grade 3×3 e as peças encaixarem.*
- **M2 — Motor de cor.** Beer-Lambert → paleta, solver de alturas, dither, busca de cronograma,
  base de filamentos + calibração de TD. Começa pelo solver opaco trivial (mesma malha) e o
  translúcido entra por cima como um solver alternativo.
- **M3 — Writer do 3MF de projeto.** Trocas por camada, presets de impressora, STL + swaps.txt
  de fallback. *Portão: abrir no OrcaSlicer/Bambu Studio e fatiar sem erro.*
- **M4 — UI web.** Upload, crop livre, tamanhos (100/140/180/210/250mm), contagem de peças,
  escolha de filamentos, preview 2D da cor resolvida + preview 3D em three.js. Deploy no GH Pages.
- **M5 — Extras.** Moldura + pé 30° em segunda placa, auto plate split com mapa de montagem.

## Verificação

Checagens automáticas (asserts, sem framework — `npm test` com o runner nativo do Node):

- `beer-lambert`: em `espessura = TD`, a transmissão tem que dar 0.1; paleta monótona.
- `jigsaw`: o polígono da peça fecha; a soma das áreas das peças = área da placa (± kerf); a aba
  da peça A é o espelho exato do encaixe da peça B na aresta compartilhada.
- `mesh`: malha de um caso pequeno é fechada (toda aresta com exatamente 2 faces).
- `3mf`: reabre o zip gerado, faz parse dos XMLs, e confere que os `top_z` das trocas batem com
  o cronograma que o solver produziu.

Ponta a ponta (manual, precisa do seu slicer/impressora):

1. Gerar um 4×4 de uma foto de teste.
2. Abrir o `.3mf` no OrcaSlicer ou Bambu Studio → as trocas aparecem nos Z esperados, fatia sem erro.
3. Imprimir o 3×3 do M1 e checar o encaixe físico antes de investir na cor.

## Riscos e cortes deliberados

- **Encaixe é calibração física, não matemática.** O kerf certo depende de impressora e
  filamento. Fica como parâmetro exposto na UI com default conservador (~0.15mm) e um "print de
  teste de folga" — não dá pra acertar no papel.
- **TD dos filamentos varia por marca e lote.** A base vem com valores públicos e um aviso de
  que são estimativa; o wizard de calibração é o caminho pra quem quer fidelidade.
- **Contagem de triângulos** em puzzles grandes (250mm, 100+ peças) pode inchar. Greedy meshing
  segura, mas o M0 já mede o tamanho do arquivo pra não descobrir tarde.
- **Fora do escopo v1** (backlog): magnetos, caixa de presente, reimpressão de peça perdida,
  estilos alternativos de peça, colagem de várias fotos, prep de foto por IA.

## No vault

Roadmap e log vivem em `gbrein/vault` → `projetos/puzzle/`. O código não entra no git do vault
(`repos/` é ignorado) — vive neste repo. Ao fechar uma unidade de trabalho, logue nos dois.
