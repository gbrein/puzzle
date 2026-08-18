import type { Bitmap, Filament, LayerPlan } from './types.ts'
import { scorePlan } from './schedule.ts'
import { resizeBitmap } from '../image/resize.ts'

/**
 * "Estes são os rolos que eu tenho. Me diga quantas cores esta foto pede e
 * quais delas usar." O inventário (`pool`) é a fonte — esta função sugere um
 * subconjunto ordenado e a curva de erro que justifica o tamanho escolhido,
 * mas a sugestão é só o ponto de partida: continua editável (trocar, remover,
 * reordenar) igual antes.
 */
export interface SuggestOptions {
  layerHeight: number
  baseLayers: number
  layers: number
  /** Teto de cores a considerar na curva. Default 6. */
  maxColors?: number
  // ponytail: aceito por simetria com ScheduleOptions e porque o algoritmo é
  // guloso — sem sorteio, então não há nada pra semear hoje. Fica reservado
  // pra caso um dia o desempate ganhar aleatoriedade (empate exato de ΔE é
  // resolvido pela ordem do pool, determinístico independente do seed).
  seed?: number
}

export interface PassoSugestao {
  /** Quantas cores, base incluída. */
  n: number
  /** As cores desse passo, base primeiro. */
  filaments: Filament[]
  /**
   * ΔE deste passo contra a foto CRUA (sem tone map), com um plano
   * PROVISÓRIO de bandas uniformes — não é o ΔE que a peça vai ter impressa.
   *
   * **Não é qualidade absoluta.** É comparável ENTRE os passos desta mesma
   * curva (a mesma foto, o mesmo `o`, o mesmo alvo) — é pra isso que existe:
   * decidir se a próxima cor compensa. Não é comparável entre fotos, entre
   * pools diferentes, nem contra `GenerateResult.stats.deltaE` da geração de
   * verdade: aquele usa o alvo com tone map (a faixa que a paleta ESCOLHIDA
   * alcança) e o cronograma real do `searchSchedule` (bandas desiguais, não
   * uniformes) — os dois números medem coisas diferentes e não devem
   * aparecer lado a lado como se fossem a mesma escala. Se a interface
   * mostrar este valor, mostre como "menor é melhor, dentro desta curva", não
   * como um placar do resultado final.
   */
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

/** Mesmo teto de `schedule.ts`: pontuar a foto inteira centenas de vezes travaria a aba. */
const SAMPLE_MAX = 64

function sampleDown(img: Bitmap): Bitmap {
  const maior = Math.max(img.width, img.height)
  if (maior <= SAMPLE_MAX) return img
  const escala = SAMPLE_MAX / maior
  return resizeBitmap(img, Math.max(1, Math.round(img.width * escala)), Math.max(1, Math.round(img.height * escala)))
}

/**
 * Espalha `layers` camadas em bandas contíguas de tamanho igual, uma por
 * filamento (o primeiro é a base) — plano PROVISÓRIO só para pontuar
 * candidatos rápido durante a busca gulosa. `searchSchedule` é quem decide o
 * cronograma de verdade (cortes desiguais, faixa mais funda onde compensa)
 * depois que a paleta já foi escolhida — a mesma divisão uniforme que a barra
 * de paleta ao vivo da interface usa.
 */
function uniformPlan(filaments: Filament[], o: { layerHeight: number; baseLayers: number; layers: number }): LayerPlan {
  const k = filaments.length
  const schedule: Filament[] = []
  for (let i = 0; i < k; i++) {
    const fim = Math.round(((i + 1) * o.layers) / k)
    while (schedule.length < fim) schedule.push(filaments[i])
  }
  return { layerHeight: o.layerHeight, baseLayers: o.baseLayers, base: filaments[0], schedule }
}

/**
 * ΔE mínimo pra compensar mais uma cor. Cada filamento a mais é um slot de
 * AMS ocupado ou uma pausa manual — não é de graça só porque o cálculo é
 * barato. 1,0 ΔE é o próprio critério que o produto usa na explicação pra
 * quem usa ("a quinta cor melhora o erro em menos de 1 ΔE e custa mais uma
 * troca") — codificado aqui, não só em texto solto.
 */
const GANHO_MINIMO = 1.0

function joelho(curve: PassoSugestao[]): number {
  for (let i = 1; i < curve.length; i++) {
    const ganho = curve[i - 1].error - curve[i].error
    if (ganho < GANHO_MINIMO) return curve[i - 1].n
  }
  return curve[curve.length - 1].n
}

/**
 * Sugere quantas cores usar e quais, a partir do inventário inteiro.
 *
 * **Guloso, não força bruta.** Com 12 rolos, escolher 4 dá 495 combinações e
 * um `searchSchedule` de ~600ms cada — inviável. `scorePlan` sobre um plano
 * de bandas uniformes custa fração de milissegundo, então: começa pela
 * melhor cor sozinha e, a cada passo, acrescenta o rolo que mais derruba o
 * erro. `pool.length × maxColors` avaliações, não combinatória.
 *
 * **O alvo é a foto CRUA, sem tone map — decisão medida, não a primeira que
 * eu tentei.** A primeira versão tonemapeava a foto pra faixa do inventário
 * inteiro (uma vez, nunca por candidato — ver o motivo abaixo, que continua
 * valendo pra outras decisões deste tipo). Medi as duas em 4 cenários
 * (gradiente de faixa larga × pool curado de 8, gradiente × catálogo inteiro
 * de 30, `cachorro.jpg` real × pool de 8, `cachorro.jpg` × catálogo de 30),
 * contando quantas vezes o erro SOBE de n pra n+1 (violação de
 * monotonicidade — sinal de que a curva não é confiável pra decidir "vale a
 * pena a próxima cor"):
 *
 *   cenário                          | tone map | cru (off)
 *   gradiente × pool de 8 .......... |    2/7   |    2/7
 *   gradiente × catálogo de 30 ..... |    3/7   |    2/7
 *   cachorro.jpg × pool de 8 ....... |    3/7   |    3/7
 *   cachorro.jpg × catálogo de 30 .. |    4/7   |    2/7
 *
 * A foto crua nunca foi pior e foi melhor em 2 dos 4 casos — pior justamente
 * quando o inventário é grande e variado, que é o caso real do produto (a
 * pessoa que cadastra um inventário generoso). A explicação: o tone map
 * remapeia pra faixa do inventário INTEIRO, que uma paleta pequena não
 * alcança — então o "achado" de que uma paleta pequena perde por não
 * alcançar o alvo (o comportamento que a rodada 3 queria) aqui vira ruído
 * espúrio quando comparando n com n+1 dentro da MESMA curva, porque o alvo
 * já está esticado além do que qualquer n pequeno consegue, distorcendo a
 * comparação relativa que o joelho da curva precisa.
 *
 * **A proteção contra o subconjunto minúsculo que "trapaceia" não depende do
 * tone map — depende do alvo ser FIXO.** Continua sendo: pontue todo
 * candidato contra o MESMO alvo, nunca um recalculado por candidato (isso sim
 * deixaria um trio de cinzas quase iguais vencer por espremer a foto na
 * própria faixa e reproduzir um alvo achatado quase perfeito — a mesma classe
 * de erro que já fez a busca preferir o plano de menor contraste, ver
 * `scorePlan` em `schedule.ts`). Testei essa armadilha especificamente contra
 * o alvo cru (ver `suggest.test.ts`) e ela continua sem acontecer: preto e
 * branco continuam vencendo os cinzas quase iguais.
 */
export function suggestPalette(image: Bitmap, pool: Filament[], o: SuggestOptions): Sugestao {
  if (pool.length === 0) throw new Error('sugestão de paleta: inventário vazio')
  if (!Number.isInteger(o.layers) || o.layers < 1) throw new Error(`layers inválido: ${o.layers}`)
  if (!(o.layerHeight > 0)) throw new Error(`layerHeight inválido: ${o.layerHeight}`)
  const maxColors = Math.max(1, Math.min(o.maxColors ?? 6, pool.length))

  const alvo = sampleDown(image)

  const curve: PassoSugestao[] = []
  const escolhidos: Filament[] = []
  const restantes = [...pool]

  for (let n = 1; n <= maxColors; n++) {
    let melhorIdx = -1
    let melhorErro = Infinity
    for (let i = 0; i < restantes.length; i++) {
      const err = scorePlan(alvo, uniformPlan([...escolhidos, restantes[i]], o))
      if (err < melhorErro) {
        melhorErro = err
        melhorIdx = i
      }
    }
    escolhidos.push(restantes[melhorIdx])
    restantes.splice(melhorIdx, 1)
    curve.push({ n, filaments: [...escolhidos], error: melhorErro })
  }

  const recommended = joelho(curve)
  return { curve, recommended, filaments: curve[recommended - 1].filaments }
}
