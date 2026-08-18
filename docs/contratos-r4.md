# Contratos — rodada 4: inventário de rolos e paleta sugerida por foto

> Mesmas regras: mesmo checkout, posse de arquivo é lei, **ninguém commita**, `npm test` e
> `npm run typecheck` verdes, português do Brasil, `ponytail:` em corte deliberado. Servidor de dev
> **já rodando** em `http://localhost:5173` — não suba outro e não mate esse. Foto de teste em
> `public/cachorro.jpg`.

## O que muda no produto

Hoje a pessoa escolhe manualmente uma lista ordenada dentro do catálogo inteiro, e o motor só
decide ordem e alturas entre o que ela escolheu. O Guilherme pediu outro modelo, e é o certo:

> *"Estes são os rolos que eu tenho. Me diga quantas cores esta foto pede e quais delas usar."*

Decisões dele, já tomadas:

1. **O inventário é a fonte principal.** A pessoa cadastra uma vez os rolos que possui e eles ficam
   salvos no navegador. O catálogo passa a ser a forma de *popular* o inventário, não a lista de
   escolha por foto.
2. **A sugestão é automática ao subir a foto, e totalmente editável.** A paleta já vem preenchida,
   com o motivo do número de cores; trocar, remover e reordenar continua livre.

Isso **não** contradiz o "as cores são ESCOLHA DE QUEM USA" que está escrito no `generate.ts`: a
plataforma não inventa cor nenhuma, ela escolhe dentro do que a pessoa declarou ter, e a escolha
continua editável. Atualize aquele comentário para dizer isso.

## Posse de arquivos

| Lane | Escopo | Arquivos |
|---|---|---|
| **C** | Motor de sugestão | `src/color/suggest.ts` (novo) + teste, `src/color/schedule.ts`, `src/generate.ts` |
| **B** | Inventário "meus rolos" | `src/ui/inventario.ts` (novo), `src/ui/filamentos.ts`, `src/ui/filamentos.css` |
| **A** | Paleta da foto e fiação | `src/ui/paleta.ts`, `src/ui/main.ts`, `src/style.css` |

## Lane C — o motor (`src/color/suggest.ts`)

```ts
export interface SuggestOptions {
  layerHeight: number
  baseLayers: number
  layers: number
  /** Teto de cores a considerar na curva. Default 6. */
  maxColors?: number
  seed?: number
}

export interface PassoSugestao {
  /** Quantas cores, base incluída. */
  n: number
  /** As cores desse passo, base primeiro. */
  filaments: Filament[]
  /** Erro médio (ΔE) que essas n cores alcançam. */
  error: number
}

export interface Sugestao {
  /** Erro para 1, 2, … maxColors cores. É o que a interface desenha e explica. */
  curve: PassoSugestao[]
  /** Número recomendado — o joelho da curva. */
  recommended: number
  /** A paleta recomendada, base primeiro. */
  filaments: Filament[]
}

export function suggestPalette(image: Bitmap, pool: Filament[], o: SuggestOptions): Sugestao
```

**Algoritmo: guloso, não força bruta.** Com 12 rolos, escolher 4 dá 495 combinações e um
`searchSchedule` de 621 ms cada — inviável. Mas pontuar UM conjunto com `scorePlan` na imagem já
amostrada custa fração de milissegundo. Então: comece pela melhor cor sozinha, e a cada passo
acrescente o rolo que mais derruba o erro. São ~`pool.length × maxColors` avaliações, não
combinatória. Use um plano provisório de **faixas uniformes** para pontuar (é o mesmo que a barra
de paleta da interface faz); o cronograma de verdade sai depois, do `searchSchedule`.

### A armadilha que vai fazer você recomendar a paleta errada

O tone map da rodada 3 mapeia a foto **para a faixa que a paleta alcança**. Se você recalcular o
tone map para cada conjunto candidato, cada candidato passa a ser medido contra um alvo diferente —
e aí **três cinzas quase iguais ganham a disputa**: eles espremem a foto inteira na sua faixa
minúscula, reproduzem esse alvo achatado quase perfeitamente e pontuam ΔE baixíssimo, enquanto
destroem a imagem. É a mesma classe de erro que já nos mordeu uma vez (a busca preferindo o plano
de menor contraste porque o ΔE premiava isso).

**Regra:** faça o tone map UMA vez, usando a faixa alcançável pelo **inventário inteiro**, e pontue
todos os candidatos contra esse mesmo alvo. Assim uma paleta curta perde por não alcançar o alvo,
que é o comportamento correto. Escreva isso como comentário no código — quem mexer depois vai ser
tentado a "otimizar" recalculando por candidato.

### Joelho da curva

Recomende o menor `n` a partir do qual o ganho marginal deixa de compensar. Escolha um critério
explícito (ganho absoluto de ΔE abaixo de um limiar, ou fração do ganho total já obtido),
**documente o número escolhido e por que**, e lembre que cada cor a mais é um slot de AMS ou uma
pausa manual — o custo não é só de cálculo.

### `maxSwaps` tem que acompanhar

Bug atual: `maxSwaps` limita as faixas, então com o default 3 no máximo 4 filamentos entram por
mais que a pessoa escolha 8, **em silêncio**. Com paleta sugerida de `n` cores, `maxSwaps` precisa
ser pelo menos `n - 1`. Trate isso no `generate.ts`: ou derive o default de `filaments.length`, ou
avise. Não deixe a pessoa escolher 6 cores e imprimir 4 sem saber.

## Lane B — inventário (`src/ui/inventario.ts`)

```ts
/** Os rolos que a pessoa TEM. Persistido em localStorage. */
export function lerInventario(): Filament[]
export function salvarInventario(rolos: Filament[]): void
/** Monta a interface de gerenciar o inventário. `aoMudar` avisa quem depende. */
export function montarInventario(opts: {
  container: HTMLElement
  aoMudar: (rolos: Filament[]) => void
}): void
```

- Cadastrar a partir do catálogo (buscar, clicar, entra no inventário) **e** à mão (`<input
  type="color">` + TD + nome).
- Remover, editar o TD (é o número que a pessoa calibra), e um "selecionar todos" que joga o
  inventário inteiro como pool da sugestão.
- Exportar/importar o inventário em JSON — quem calibrou 12 rolos não pode perder isso ao limpar o
  navegador.
- Inventário vazio na primeira visita: ofereça um ponto de partida (ex.: preto, branco e uma cor)
  em vez de uma tela vazia, deixando claro que é sugestão inicial.
- O `filamentos.ts` passa a mostrar **o inventário** como grade principal; o catálogo vira um
  "adicionar rolo" que alimenta o inventário. Mantenha a rampa de TD por amostra e o agrupamento
  dos neutros — os dois estão certos.
- **Regra que já foi quebrada duas vezes:** toda mutação passa por `mudou()`, que faz `render()`
  **e** `aoMudar()`. Ver `docs/achados.md`.

## Lane A — a paleta da foto (`src/ui/paleta.ts` + fiação)

- A paleta desta foto vira **slots**: `n` posições, base primeiro, cada uma mostrando a cor e
  aceitando troca por outro rolo do inventário.
- Ao subir/recortar a foto, chame o motor da lane C e **preencha os slots com a sugestão**,
  mostrando o número recomendado e o porquê ("4 cores: a quinta melhora o erro em menos de 1 ΔE e
  custa mais uma troca").
- Desenhe a **curva** de erro por número de cores — é o que deixa a recomendação verificável em vez
  de mágica. Deixe mudar o número de cores e recalcular.
- Mantenha a barra da paleta resultante e o medidor de gama que já existem, e a honestidade de que
  a prévia usa divisão uniforme enquanto o cronograma final sai na geração.
- A sugestão roda no worker se passar de uns 100 ms — meça antes de decidir; ela é muito mais
  barata que a geração.

**Enquanto a lane C não entregar**, programe contra a assinatura acima e deixe os slots manuais
funcionando. Não invente número recomendado na interface.
