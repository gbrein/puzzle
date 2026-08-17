# Plano da interface (M4.1) — escolher cor, não nome de rolo

> Escrito depois do M4 subir e de rodar o app de verdade no navegador. As decisões abaixo saem de
> três coisas medidas, não de gosto. O `docs/plano.md` continua sendo o plano do projeto; este
> arquivo detalha só a interface e as funcionalidades que faltam.

## As três medições que mandam no desenho

Medido numa foto de 600×400 virando placa de 180mm (grade de 428×285 células, 3 filamentos):

| Etapa | Custo |
|---|---|
| `buildPalette` (paleta de L+1 cores) | **0 ms** |
| `solveHeights` + `renderHeightMap` | **7 ms** |
| `resizeBitmap` | 14 ms |
| `searchSchedule` (busca do cronograma) | **621 ms** |
| `generatePuzzle` completo (geometria + 3MF) | **1970 ms** |

Três conclusões, e cada uma vira uma decisão de interface:

1. **A paleta é de graça.** Dá para mostrar, enquanto a pessoa escolhe as cores, exatamente
   quais tons a pilha vai produzir — e o `paletteSpan` junto. Isso não precisa de worker, de
   debounce, de nada. Hoje esse número só aparece *depois* de 2 segundos de geração, quando o
   estrago já foi feito.
2. **O preview de cor custa 7 ms, não 2 segundos.** O que custa é a geometria. Então o preview 2D
   pode ser **ao vivo** a cada mexida de controle, e o botão "Gerar" fica só para a geometria e o
   `.3mf`. Isso não pede refatoração do núcleo: as funções já estão separadas assim.
3. **O gargalo do caminho de cor é a busca do cronograma (621 ms).** Enquanto a pessoa só mexe em
   tamanho, peças ou kerf, o resultado de cor **não muda** — não recalcule nada. Recalcule só
   quando mudarem os filamentos, as camadas ou a base.

## O problema real, visto no app rodando

Gerei um teste com preto → vermelho → branco sobre uma foto com um círculo azul. O círculo saiu
**cinza escuro**. Não é bug: a paleta de uma pilha de filamentos é uma *curva* no espaço de cor, e
o azul está fora dela. O `generate.ts` já explica isso e já expõe o `paletteSpan` para avisar.

O defeito é de interface: **o aviso chega tarde demais**. A pessoa escolhe às cegas, espera 2
segundos, e recebe uma imagem errada sem entender por quê. Consertar isso é o eixo deste plano.

## 1. Escolher cor, não nome de rolo

Hoje o seletor é uma lista de texto com "Prusament PLA Blend My Silverness" e um quadradinho de
cor de 12px. Quem está escolhendo quer **a cor**; a marca é detalhe de compra.

**Grade de amostras, ordenada por matiz.** Quadrados grandes de cor, ordenados por H e L (LCh),
não pela ordem do arquivo. Nome vira `title`/legenda secundária. Busca por texto continua, para
quem sabe qual rolo tem.

**Cada amostra mostra o TD, visualmente.** É o ponto que um seletor de cor comum erraria: dois
vermelhos com TD 0,3 e 3,3 se comportam de forma completamente diferente, e a cor sozinha esconde
justamente a propriedade que decide o resultado. Em vez de imprimir o número, desenhe a **rampa
real**: a cor daquele filamento empilhado em 1, 2, 4, 8 camadas sobre a base atual — que é
`buildPalette` rodando em 0 ms. A amostra passa a mostrar *como o material se comporta*, não só
como ele é. Nenhum concorrente fechado faz isso.

**Barra da paleta resultante, ao vivo.** Abaixo da seleção, as L+1 cores que a pilha atual produz,
na ordem, e o `paletteSpan` como um medidor com o corte em 40 marcado. Mexeu na ordem, a barra
muda na hora. É o mesmo número que hoje só aparece no fim.

**Botão "sugerir cores para esta foto".** Guloso sobre o catálogo: parte da cor que mais aparece,
e acrescenta o filamento que mais derruba o `imageError`, até `maxSwaps + 1`. Custa alguns
`searchSchedule`, então roda no worker com barra de progresso. **É sugestão, não automatismo** — o
`generate.ts` diz, com todas as letras, que as cores são escolha de quem usa. A sugestão preenche a
seleção e a pessoa mexe em cima; nunca gera sozinha.

**Rolo manual vira cor primeiro:** um `<input type="color">` + TD, com o nome opcional. O TD ganha
um link para o wizard de calibração (ver §4).

## 2. Tamanho e dificuldade

Hoje: `size` num select e `pieceCount` num slider de 4 a 120. Os dois são números crus, e a
combinação ruim (250mm com 8 peças, ou 100mm com 120) não é barrada nem avisada.

**Dificuldade é tamanho de peça, não contagem.** É o que a pessoa sente na mão, e é o que tem
limite físico: abaixo de um certo tamanho, o pescoço da aba fica com menos que dois ou três filetes
de extrusão e a peça quebra ao desencaixar. Então:

| Nível | Peça alvo | O que dizer |
|---|---|---|
| Fácil | ~35 mm | criança, montagem rápida |
| Médio | ~25 mm | padrão |
| Difícil | ~18 mm | |
| Insano | ~13 mm | avisar: peça frágil, encaixe exige kerf calibrado |

`pieceCount` sai de `(largura × altura) / lado²` e aparece como consequência: *"Médio — 34 peças de
~25 mm"*. Quem quiser o número cru continua tendo o slider no avançado, mas com o **piso calculado**
a partir de `extrusionWidth`, não um 4 arbitrário.

**Tamanho mostra consequência.** Para cada tamanho, dizer o que ele implica:

- **quantas placas** a impressão vai precisar — o `layoutPlates` do M5 já calcula isso e ainda não
  está ligado em lugar nenhum;
- **quantos gramas de filamento**, de `signedVolume(mesh) × densidade` — a função já existe em
  `mesh.ts` e ninguém usa;
- uma referência física ("180 mm ≈ um porta-retrato").

Tempo de impressão **não** entra: quem estima isso é o slicer, e chutar seria inventar número.

## 3. A interface em si

Problemas vistos rodando: uma coluna só empilha foto + filamentos + impressão e obriga a rolar para
longe do preview; todo controle tem o mesmo peso visual (o `kerf`, que se calibra uma vez na vida,
fica do lado de "peças", que é a escolha criativa); o preview vazio é um retângulo preto; e nada
acontece até apertar Gerar.

- **Preview é o protagonista.** Coluna direita fixa (`position: sticky`), sempre visível. Controles
  à esquerda rolam por baixo dele.
- **Essencial × avançado.** Essencial: foto, cores, tamanho, dificuldade. Avançado (recolhido):
  `layerHeight`, `baseThickness`, `maxSwaps`, `kerf`, `extrusionWidth`, `dither`, preset de
  impressora, `swapMode`. Recolher não é esconder: é dizer o que importa.
- **Preview 2D ao vivo** (7 ms, §medições), com debounce só no caso que dispara `searchSchedule`.
  "Gerar" passa a significar "construir a geometria e o `.3mf`".
- **Estado vazio que ensina**, no lugar do retângulo preto: o que vai aparecer ali e o que falta
  fazer para aparecer.
- **Alternar 2D/3D** no mesmo quadro em vez de dois quadros empilhados, com o 2D em cima por
  default — é ele que mostra a decisão de cor.
- **Aviso de gama junto da escolha**, não no fim.

## 4. Funcionalidades que faltam

Em ordem de valor, não de esforço:

1. **Ligar a moldura e as placas (M5).** `buildFrame` e `layoutPlates` estão prontos, testados e
   **desconectados** — não aparecem no `generatePuzzle` nem na UI. É o maior valor por menor
   esforço que existe hoje no repo: uma opção "incluir moldura com pé" e o `.3mf` saindo já
   dividido em placas com o mapa de montagem.
2. **Mapa de montagem visível.** Com várias placas, quem imprime precisa saber qual peça vai onde.
   O `layoutPlates` já devolve `placement`; falta desenhar.
3. **Teste de folga imprimível.** O `CLAUDE.md` é explícito: o `kerf` de 0,4 mm veio de leitura,
   não de medição, e nenhum teste cobre "encaixou na mão". Um botão que gera um `.3mf` pequeno com
   pares de peças em 4 ou 5 kerfs diferentes resolve a calibração numa impressão só. É a pendência
   física nº 1 do projeto.
4. **Wizard de calibração de TD.** `fitTD` existe em `calibrate.ts`, com regressão e nível de
   confiança, e **nunca teve interface**. Gerar a peça de amostra em N espessuras, a pessoa imprime,
   mede e digita — sai o TD medido do rolo dela, no lugar da estimativa.
5. **Salvar e recarregar o projeto.** As configurações num JSON no `localStorage` + exportar/importar.
   Perder tudo ao recarregar a aba é atrito bobo.
6. **Comparar dois resultados** lado a lado (mesma foto, paletas diferentes). Cai direto na dúvida
   real de quem está escolhendo cor.

## Ordem sugerida

1. Paleta ao vivo + `paletteSpan` na hora de escolher + grade de amostras por matiz *(resolve o
   defeito central; custo baixo, tudo já medido em 0–7 ms)*
2. Dificuldade por tamanho de peça + consequências do tamanho *(usa `layoutPlates` e `signedVolume`,
   que já existem)*
3. Reorganização essencial × avançado + preview fixo + preview 2D ao vivo
4. Ligar moldura e placas no `generatePuzzle` e na UI
5. Sugestão de cores pela foto
6. Teste de folga e wizard de TD
7. Salvar/carregar e comparação

## O que este plano deliberadamente não faz

- **Não escolhe cor pela pessoa.** Sugere, e a pessoa aceita ou mexe. O núcleo diz isso em
  comentário e a interface tem que respeitar.
- **Não estima tempo de impressão.** É o slicer que sabe; número chutado vira reclamação.
- **Não adiciona framework.** Tudo aqui é DOM direto, como o resto da UI. `three` e `earcut` seguem
  sendo as únicas dependências de runtime.
- **Não mexe no núcleo M0–M3.** Toda funcionalidade acima usa função que já existe. As únicas
  adições ao núcleo são a fiação da moldura e das placas no `generatePuzzle`.
