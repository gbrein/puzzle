# puzzle

Gerador open-source de quebra-cabeças imprimíveis em 3D a partir de fotos, com cor em camadas.

Sobe uma foto, escolhe o tamanho, a dificuldade e as cores dos filamentos — e baixa **um `.3mf` de
projeto** que abre no slicer já com as trocas de cor embutidas. Sem CAD, sem swap manual.

Roda 100% no navegador: nenhuma foto sai da sua máquina.

## Estado

A cadeia inteira funciona: sobe a foto, recorta, escolhe as cores e baixa o `.3mf`.

- [x] **M0** — cadeia ponta a ponta: grade → peças → malha fechada → STL
- [x] **M1** — encaixe jigsaw de verdade (abas em bezier)
- [x] **M2** — motor de cor (Beer-Lambert com *transmission distance* por filamento)
- [x] **M3** — escrita do `.3mf` de projeto com trocas por camada
- [x] **M4** — interface web: upload, recorte, seletor de cor, preview 2D ao vivo e 3D
- [x] **M5** — moldura com pé 30° e divisão automática em placas

**O que ainda não foi verificado na prática**, e é honesto dizer: ninguém abriu um `.3mf` gerado
num slicer de verdade, e a folga de encaixe (`kerf`, default 0,4mm) veio de leitura, não de
medição. Os dois são parâmetros expostos justamente porque dependem da sua impressora e do seu
filamento — trate como ponto de partida a calibrar, não como número acertado.

O plano completo (decisões, arquitetura e onde parei) está em [`docs/plano.md`](docs/plano.md);
o que vem a seguir na interface, em [`docs/plano-ui.md`](docs/plano-ui.md).

## Como as cores funcionam

Cada filamento tem uma *transmission distance* (TD): a espessura na qual ele deixa passar ~10%
da luz. Empilhando camadas, a cor que se vê é a composição de Beer-Lambert:

```
transmissão de uma camada:  T = 10^(-espessura / TD)
cor acumulada:              C[i] = cor_do_filamento(i)·(1 − T) + C[i−1]·T
```

Como as trocas de filamento acontecem em alturas globais, **a cor de um ponto depende só da sua
altura** — o que reduz o problema a uma paleta de `L+1` cores e um mapa de alturas. Sem
otimizador pesado.

O modelo também explica a geometria: a camada `i` é impressa em toda região com `altura >= i`,
então a peça é uma pilha monótona e nada fica em balanço.

## Escolher a cor, não o nome do rolo

O seletor é uma grade de amostras ordenada por matiz. Mas cor sozinha esconde o que decide o
resultado: **dois vermelhos com TD 0,3 e 3,3 se comportam de forma completamente diferente** — um
fecha a cor na primeira camada, o outro deixa a base aparecer por milímetros. Por isso cada
amostra mostra a *rampa* daquele filamento empilhado em 1, 2, 4 e 8 camadas sobre a base atual.
A amostra diz como o material se comporta, não só como ele é.

E como a paleta de uma pilha de filamentos é uma **curva** no espaço de cor, e não um volume, um
conjunto de rolos simplesmente não alcança certas fotos — um azul dentro de uma paleta
preto→vermelho→branco sai cinza, por mais camadas que se peça. A interface mostra a gama alcançada
**enquanto você escolhe**, com o corte em 40: abaixo disso, a foto sai enlameada. Isso custa 0 ms
de cálculo, então aparece na hora — não depois de gerar.

A gama é a maior distância ΔE entre **duas cores quaisquer** da paleta, e não entre a primeira e a
última: um cronograma que termina no mesmo filamento da base fecha o ciclo e daria ~0, mesmo tendo
passado longe no meio.

## Desenvolvimento

```bash
npm install
npm run dev                                           # o app em localhost:5173
npm test                                              # asserts, sem framework
npm run typecheck                                     # tsc --noEmit
npm run build                                         # bundle estático em dist/
node src/cli.ts --size 180 --aspect 1.5 --pieces 12 --out puzzle.stl
```

Precisa de **Node ≥ 22.18**: os testes rodam `.ts` direto, pelo type stripping nativo do Node —
sem build step e sem framework de teste. O Vite entra só para o app; o núcleo não passa por ele.

O CLI é ferramenta de desenvolvimento — serve pra inspecionar a geometria sem abrir o navegador.
O núcleo em `src/` não depende de DOM, então roda igual nos testes do Node e no app.

```
src/
  geom/      tipos e primitivas de polígono
  jigsaw/    grade, arestas compartilhadas, folga de encaixe, split em placas
  color/     Beer-Lambert, paleta, mapa de alturas, cronograma de trocas
  filaments/ catálogo com TD e calibração
  image/     reamostragem
  mesh/      extrusão, greedy meshing do relevo, moldura, malha fechada
  export/    STL e o 3MF de projeto (multi-placa)
  ui/        interface (vanilla TS + DOM, sem framework)
  preview/   canvas 2D da cor resolvida e cena three.js
  worker/    geração fora da thread principal
```

O caminho de cor mora em `color/resolve.ts` e tem **dois consumidores**: a geração completa e o
preview ao vivo. É uma função só de propósito — duas cópias divergiriam em silêncio, e prévia que
mostra uma cor e imprime outra é pior que prévia nenhuma.

**Por que as peças encaixam:** duas peças vizinhas usam literalmente a *mesma* polilinha de
aresta, uma delas invertida. O encaixe é exato por construção; a folga vem depois, de um offset
de distância constante.

## Dependências

Quatro, todas permissivas: `earcut` (ISC) para triangulação, `clipper-lib` (Boost) para offset de
polígono, `fflate` (MIT) para o zip do 3MF e `three` (MIT) para o preview 3D. Em desenvolvimento,
`vite` e `typescript`. Não há framework de UI nem de teste.

> A porta TypeScript do Clipper2 (`clipper2-js`) foi testada e descartada: o offset dela devolve
> geometria errada até para um quadrado.

## Prior art

- [TanskyLab](https://tanskylab.com/) — o gerador fechado que inspirou o projeto
- [Kromacut](https://github.com/vycdev/Kromacut) (AGPL-3.0) — imagem → camadas de cor
- [AutoForge](https://github.com/hvoss-techfak/AutoForge) — otimizador de alturas em PyTorch
- [Draradech/jigsaw](https://github.com/Draradech/jigsaw) — matemática das abas em bezier

## Licença

MIT.
