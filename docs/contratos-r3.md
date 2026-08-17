# Contratos — rodada 3: consertar a cor e a interface

> Mesmas regras das rodadas anteriores: mesmo checkout, posse de arquivo é lei, **ninguém commita**,
> `npm test` e `npm run typecheck` verdes no fim, português do Brasil, `ponytail:` em corte deliberado.

## Por que esta rodada existe

O Guilherme testou com uma foto real (um cachorro preto sobre madeira). Resultado: **o cachorro
saiu como uma mancha preta chapada** — sumiram o focinho, o peito e o modelado do pelo — e o `.3mf`
gerado abriu no slicer **com uma cor só**. Medido, não achado:

| | |
|---|---|
| Alcance da paleta (L\*) | 16,1 → 92,5 |
| A foto vai de | 0,0 a 83,3 (p1..p99) |
| Pixels mais escuros que o filamento mais escuro | **36,4%** |
| Pixels colapsados num único nível da paleta | **21,3%** |

E o achado que muda a estratégia: aplicando um tone map experimental, o **ΔE piorou (13,8 → 17,8)
enquanto a imagem melhorou muito** — focinho, peito e pelo voltaram a ler. **A métrica que a busca
otimiza está premiando o resultado errado.**

## Posse de arquivos

| Lane | Escopo | Arquivos |
|---|---|---|
| **A** | Layout e densidade da interface | `src/ui/main.ts`, `src/ui/foto.ts`, `src/style.css` |
| **B** | Seletor de cor e acabamento visual | `src/ui/filamentos.ts`, `src/ui/paleta.ts`, `src/ui/filamentos.css` |
| **C** | Motor de cor e o `.3mf` colorido | `src/color/**`, `src/generate.ts`, `src/export/threemf.ts` + testes |

`package.json`, `vite.config.ts`, `index.html`, `docs/**` seguem do orquestrador. Nenhuma
dependência nova. Foto de teste em `public/cachorro.jpg` (ignorada pelo git) — use para conferir.

## Lane C — motor de cor (a mais importante)

### 1. Tone mapping: mapear a foto para o que os filamentos alcançam

O `solveHeights` faz casamento **absoluto**: acha a entrada da paleta mais próxima da cor alvo.
Quando a foto é mais escura que o filamento mais escuro — 36% dos pixels, no teste — tudo colapsa
no mesmo nível e vira mancha. É o que o HueForge resolve com o mapeamento de luminância.

Crie `src/color/tone.ts` com a transformação, aplicada **antes** de `solveHeights` e **antes** da
pontuação da busca. Default: os percentis 1 e 99 da foto viram os extremos de L\* da paleta.

**Faça em Lab, e NÃO volte para RGB no laço.** Converta a imagem uma vez para Lab, e o tone map
vira uma transformação afim em L — barata o bastante para rodar por candidato dentro da busca.
Voltar para RGB a cada candidato mata o desempenho e não acrescenta nada, porque `deltaE` já
trabalha em Lab.

Exponha como controle (`toneMap?: 'auto' | 'off'` ou os percentis), não como constante escondida.

**Avalie também a crominância**: o experimento remapeou só o L e a madeira perdeu o tom quente.
Escalar a croma para a faixa alcançável pela paleta pode recuperar isso — meça antes de decidir, e
se ficar de fora, registre o porquê num `ponytail:`.

### 2. A métrica da busca

Com o tone map aplicado ao alvo **antes** de pontuar, o ΔE volta a medir o que interessa (o alvo
passa a estar dentro do alcance). Comece por aí — é a correção mais barata e provavelmente
suficiente. Se ainda assim a busca escolher planos de baixo contraste, considere acrescentar um
termo de contraste/estrutura ao `scorePlan`, mas **meça antes**: a nota atual do `scorePlan`
explica em detalhe por que ela é vizinho-mais-próximo e não dithering, e essa justificativa
continua valendo.

Verificação obrigatória, com a foto real: a fração de pixels no nível mais populoso tem que cair
bem abaixo dos 21,3% de hoje, e o número de níveis usados subir. Reporte os dois números.

### 3. O `.3mf` que sai com uma cor só

Confirmado: `swapMode: 'manual'` (o default de hoje) declara **um** `filament_colour` e transforma
troca em pausa; `'ams'` declara a paleta inteira e usa `ToolChange`. O `manual` existe por um
motivo real (numa P1S sem AMS o `ToolChange` é descartado em silêncio) e **continua existindo** —
mas como escolha explícita, não como default silencioso que contradiz a promessa do produto.

**Decisão do Guilherme: o default passa a ser `'ams'`.** Mude em `generate.ts`, e garanta que a
prévia do slicer saia colorida. Não apague o modo manual nem a explicação dele.

### 4. Quantas cores realmente entram

`maxSwaps` limita o número de faixas: com o default 3, no máximo 4 filamentos entram, por mais que
a pessoa escolha 8. Hoje isso acontece em silêncio. Exponha no resultado quais filamentos o plano
de fato usou, para a interface poder avisar. O `plan.schedule` já tem a informação — dê um nome a
ela em `stats` ou num campo do resultado, e **documente o nome aqui** para as lanes A e B usarem.

## Lane A — layout e densidade

Quatro reclamações diretas do Guilherme. Estas duas são suas:

1. **O recorte toma a tela toda.** O canvas da foto ocupa a coluna esquerda inteira e empurra cores
   e controles para baixo da dobra. Depois de aplicar o recorte, a foto deve virar uma miniatura
   com um botão "ajustar recorte"; o recorte grande só aparece enquanto se recorta. E a dropzone
   não deve continuar ocupando espaço depois que já existe foto.
2. **Preview pequeno e longe.** A prévia é o produto — hoje as estatísticas ocupam mais área que
   ela. Deixe o quadro da prévia grande e fixo, e recolha as estatísticas (um resumo de uma linha
   com o essencial, o resto atrás de um "detalhes").

Cuide também da densidade geral: espaçamento, hierarquia, e o fato de tudo hoje ter o mesmo peso.
Não invente dependência nem framework — DOM direto, como o resto.

## Lane B — seletor de cor e acabamento

As outras duas reclamações:

3. **Escolher cor é ruim.** Amostras pequenas, muito scroll, difícil comparar, e o catálogo mistura
   o rolo que a pessoa tem com o que ela não tem. Amostras maiores, separação clara entre "meus
   rolos" e catálogo, e uma forma de comparar duas escolhas sem perder a seleção. Mantenha a rampa
   de TD por amostra (é o diferencial) e a ordenação por matiz — mas note que a ordenação por matiz
   pura joga os neutros em posições arbitrárias, porque preto e branco não têm matiz definido;
   agrupe os de baixa croma à parte.
4. **Visual geral parece protótipo.** Tipografia, espaçamento, cor da própria interface, estados de
   foco e hover. Trabalhe dentro de `filamentos.css` (a lane A tem o `style.css` global) e alinhe
   com o que ela estiver fazendo lá — se precisarem de um token comum, peça ao orquestrador.

Não quebre `montarFilamentos({container, estado, aoMudar})` nem `montarPaleta(container, estado,
opts)`: o `main.ts` chama pelas duas assinaturas e é da lane A.

**Regra herdada, não a quebre de novo:** toda mutação do estado em `filamentos.ts` passa por
`mudou()`, que faz `render()` **e** `aoMudar()`. Chamar `aoMudar()` direto é um bug que já foi
corrigido duas vezes (ver `docs/achados.md`).
