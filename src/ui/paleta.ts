import type { Filament, LayerPlan, Palette } from '../color/types.ts'
import { buildPalette } from '../color/beer-lambert.ts'
import { deltaE, rgbToLab, toHex } from '../color/space.ts'
import './filamentos.css'

/**
 * Barra ao vivo com as L+1 cores que a pilha atual produz + o medidor de gama
 * (`paletteSpan`) com o corte em 40 marcado. `buildPalette` custa 0 ms, então
 * isto re-renderiza a cada mexida na seleção — é o mesmo número que hoje só
 * aparece depois de 2 segundos de geração.
 *
 * ponytail: quem escolhe o cronograma de verdade é o `searchSchedule`, que
 * custa 621 ms e só roda na geração — aqui montamos uma aproximação barata com
 * **divisão uniforme** dos filamentos escolhidos. A barra é honesta sobre isso
 * na tela ("prévia"), porque fingir que é o resultado final enganaria quem está
 * escolhendo cor. Upgrade: rodar `searchSchedule` num worker ocioso quando a
 * seleção estiver parada e substituir a barra pelo cronograma de verdade.
 */
export function montarPaleta(
  container: HTMLElement,
  estado: Filament[],
  opts: { layers: number; layerHeight: number; baseLayers: number },
): void {
  container.replaceChildren()

  if (estado.length === 0) {
    const vazio = document.createElement('p')
    vazio.className = 'fil-vazio'
    vazio.textContent = 'Escolha filamentos para ver a paleta que a pilha produz e a gama que ela alcança.'
    container.append(vazio)
    return
  }

  const { layers, layerHeight, baseLayers } = opts

  // Divisão uniforme e contígua: cada filamento vira uma faixa (uma troca de
  // rolo), como no cronograma real. Se layers < número de filamentos, os
  // últimos não entram — o que também é verdade na geração.
  const schedule: Filament[] = []
  for (let i = 0; i < layers; i++) {
    schedule.push(estado[Math.min(estado.length - 1, Math.floor((i * estado.length) / layers))])
  }

  const plan: LayerPlan = { layerHeight, baseLayers, base: estado[0], schedule }
  const palette = buildPalette(plan)
  const span = maiorDeltaE(palette)

  const titulo = document.createElement('p')
  titulo.className = 'fil-paleta-titulo'
  titulo.textContent = 'Paleta resultante (prévia)'

  const barra = document.createElement('div')
  barra.className = 'fil-bar'
  palette.forEach((cor, i) => {
    const faixa = document.createElement('div')
    faixa.className = 'fil-bar-faixa'
    faixa.style.backgroundColor = toHex(cor)
    faixa.title = `camada ${i}: ${toHex(cor)}`
    barra.append(faixa)
  })

  const nota = document.createElement('p')
  nota.className = 'fil-nota'
  nota.textContent = 'Prévia com divisão uniforme dos rolos — o cronograma final é escolhido na geração.'

  // Medidor de gama. Escala fixa de 0..100 com o corte em 40 marcado; acima de
  // 100 o preenchimento enche (o número real fica no rótulo).
  const gama = document.createElement('div')
  gama.className = 'fil-gama'
  const tituloGama = document.createElement('p')
  tituloGama.className = 'fil-gama-titulo'
  tituloGama.textContent = `Gama da paleta: ${span.toFixed(0)} ΔE`

  const trilho = document.createElement('div')
  trilho.className = 'fil-gama-trilho'
  const preenchimento = document.createElement('div')
  preenchimento.className = 'fil-gama-preenchimento'
  preenchimento.style.width = `${Math.min(100, (span / 100) * 100)}%`
  const marcador = document.createElement('div')
  marcador.className = 'fil-gama-marcador'
  marcador.style.left = '40%'
  marcador.title = 'Corte: 40 ΔE'
  trilho.append(preenchimento, marcador)

  const rotulos = document.createElement('div')
  rotulos.className = 'fil-gama-rotulos'
  const r0 = document.createElement('span')
  r0.textContent = '0'
  const r40 = document.createElement('span')
  r40.textContent = '40 (corte)'
  const r100 = document.createElement('span')
  r100.textContent = '100+'
  rotulos.append(r0, r40, r100)

  gama.append(tituloGama, trilho, rotulos)

  if (span < 40) {
    const aviso = document.createElement('p')
    aviso.className = 'fil-gama-aviso'
    aviso.textContent =
      `Gama de ${span.toFixed(0)} ΔE — abaixo de 40 essas cores não alcançam uma foto colorida. ` +
      'Aumente as camadas de cor ou escolha filamentos mais contrastantes.'
    gama.append(aviso)
  }

  container.append(titulo, barra, nota, gama)
}

/**
 * Maior ΔE entre DUAS entradas quaisquer da paleta.
 *
 * Comparar só a primeira com a última mediria errado: um cronograma que termina
 * no filamento da base (que a busca escolhe quando compensa) fecha o ciclo e
 * devolveria ~0, mesmo tendo passado longe no meio. Mesma conta do `generate.ts`.
 */
function maiorDeltaE(palette: Palette): number {
  const labs = palette.map(rgbToLab)
  let max = 0
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE(labs[i], labs[j])
      if (d > max) max = d
    }
  }
  return max
}