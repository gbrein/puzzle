# puzzle

Gerador open-source de quebra-cabeças imprimíveis em 3D a partir de fotos, com cor em camadas.

Sobe uma foto, escolhe o tamanho, a quantidade de peças e os filamentos — e baixa **um `.3mf` de
projeto** que abre no slicer já com as trocas de cor embutidas. Sem CAD, sem swap manual.

Roda 100% no navegador: nenhuma foto sai da sua máquina.

## Estado

Em construção. O que já funciona:

- [x] **M0** — cadeia ponta a ponta: grade → peças → malha fechada → STL
- [ ] **M1** — encaixe jigsaw de verdade (abas em bezier)
- [ ] **M2** — motor de cor (Beer-Lambert com *transmission distance* por filamento)
- [ ] **M3** — escrita do `.3mf` de projeto com trocas por camada
- [ ] **M4** — interface web + preview 3D
- [ ] **M5** — moldura com pé 30° e divisão automática em placas

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

## Desenvolvimento

```bash
npm install
npm test                                              # asserts, sem framework
node src/cli.ts --size 180 --aspect 1.5 --pieces 12 --out puzzle.stl
```

O CLI é ferramenta de desenvolvimento — serve pra inspecionar a geometria sem abrir o navegador.
O núcleo em `src/` não depende de DOM, então roda igual nos testes do Node e no app.

```
src/
  geom/     tipos e primitivas de polígono
  jigsaw/   grade, arestas compartilhadas, folga de encaixe
  mesh/     extrusão e checagem de malha fechada
  export/   STL (e, no M3, o 3MF de projeto)
```

**Por que as peças encaixam:** duas peças vizinhas usam literalmente a *mesma* polilinha de
aresta, uma delas invertida. O encaixe é exato por construção; a folga vem depois, de um offset
de distância constante.

## Dependências

`earcut` (ISC) para triangulação e `clipper-lib` (Boost) para offset de polígono. Só isso.

> A porta TypeScript do Clipper2 (`clipper2-js`) foi testada e descartada: o offset dela devolve
> geometria errada até para um quadrado.

## Prior art

- [TanskyLab](https://tanskylab.com/) — o gerador fechado que inspirou o projeto
- [Kromacut](https://github.com/vycdev/Kromacut) (AGPL-3.0) — imagem → camadas de cor
- [AutoForge](https://github.com/hvoss-techfak/AutoForge) — otimizador de alturas em PyTorch
- [Draradech/jigsaw](https://github.com/Draradech/jigsaw) — matemática das abas em bezier

## Licença

MIT.
