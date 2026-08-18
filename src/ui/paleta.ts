import type { Filament, LayerPlan, Palette } from '../color/types.ts'
import type { PassoSugestao, Sugestao as SugestaoPaleta } from '../color/suggest.ts'
import { buildPalette } from '../color/beer-lambert.ts'
import { deltaE, rgbToLab, toHex } from '../color/space.ts'
import './filamentos.css'

export type { PassoSugestao, SugestaoPaleta }

/**
 * A paleta desta foto vira **slots**: n posições, base primeiro, cada uma
 * mostrando a cor e aceitando troca por outro rolo do inventário. A sugestão
 * automática (motor da lane C, `src/color/suggest.ts`) chega pronta via
 * `opts.sugestao`; sem ela, os slots seguem **manuais** — trocar, remover,
 * reordenar e adicionar funciona à mão.
 *
 * Mantém o que já existia: a barra das L+1 cores da pilha atual (divisão
 * uniforme — custa 0 ms com `buildPalette`) e o medidor de gama com o corte em
 * 40 marcado, com a honestidade de que o cronograma final só sai na geração.
 */

export function montarPaleta(
  container: HTMLElement,
  estado: Filament[],
  opts: {
    layers: number
    layerHeight: number
    baseLayers: number
    /** Rolos disponíveis para trocar nos slots (o inventário). */
    pool: Filament[]
    /** Saída do motor da lane C. `null`/omitido = motor indisponível → manual. */
    sugestao?: SugestaoPaleta | null
    /** Avisa quem chamou depois de cada edição de slot. */
    aoMudar?: () => void
  },
): void {
  const { layers, layerHeight, baseLayers, pool, sugestao, aoMudar } = opts

  let pickerAberto: number | null = null

  const indice = (id: string): number => estado.findIndex((f) => f.id === id)
  const naoUsados = (): Filament[] => pool.filter((f) => indice(f.id) === -1)

  const mudou = (): void => aoMudar?.()

  // Mutação em lugar do MESMO array que main.ts guarda — reatribuir quebraria
  // as referências que montarFilamentos e o preview seguram.
  const trocar = (i: number, f: Filament): void => {
    estado[i] = f
    mudou()
  }
  const remover = (i: number): void => {
    estado.splice(i, 1)
    mudou()
  }
  const adicionar = (): void => {
    const f = naoUsados()[0]
    if (!f) return
    estado.push(f)
    mudou()
  }
  const mover = (i: number, delta: number): void => {
    const j = i + delta
    if (i < 1 || j < 1 || j >= estado.length) return
    const [f] = estado.splice(i, 1)
    estado.splice(j, 0, f)
    mudou()
  }

  const tdTexto = (td: number): string => `${td.toFixed(1).replace('.', ',')} mm`

  const botaoSlot = (rotulo: string, titulo: string, acao: () => void, desabilitado = false): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'paleta-slot-acao'
    b.textContent = rotulo
    b.title = titulo
    b.disabled = desabilitado
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      acao()
    })
    return b
  }

  const slotDe = (f: Filament, i: number): HTMLElement => {
    const card = document.createElement('div')
    card.className = 'paleta-slot' + (i === 0 ? ' base' : '')

    const pos = document.createElement('span')
    pos.className = 'paleta-slot-pos'
    pos.textContent = i === 0 ? '1º base' : `${i + 1}º`
    pos.title = i === 0 ? 'Primeiro slot — vira a base opaca da peça.' : 'Posição no cronograma.'

    const cor = document.createElement('button')
    cor.type = 'button'
    cor.className = 'paleta-slot-cor'
    cor.style.backgroundColor = f.hex
    cor.title = `${f.name} — clique para trocar por outro rolo`
    cor.addEventListener('click', () => {
      pickerAberto = pickerAberto === i ? null : i
      render()
    })

    const nome = document.createElement('span')
    nome.className = 'paleta-slot-nome'
    nome.textContent = f.name
    nome.title = f.name

    const td = document.createElement('span')
    td.className = 'paleta-slot-td'
    td.textContent = `TD ${tdTexto(f.td)}`

    const acoes = document.createElement('span')
    acoes.className = 'paleta-slot-acoes'
    acoes.append(
      botaoSlot('↑', 'Sobe na ordem', () => mover(i, -1), i < 1),
      botaoSlot('↓', 'Desce na ordem', () => mover(i, 1), i >= estado.length - 1),
      botaoSlot('✕', `Remove ${f.name}`, () => remover(i), estado.length <= 1),
    )

    card.append(pos, cor, nome, td, acoes)
    return card
  }

  const seletorDe = (i: number): HTMLElement | null => {
    if (pickerAberto !== i) return null
    const atual = estado[i]
    const opcoes = pool.filter((f) => f.id !== atual?.id)
    const seletor = document.createElement('div')
    seletor.className = 'paleta-picker'

    const titulo = document.createElement('p')
    titulo.className = 'paleta-picker-titulo'
    titulo.textContent = `Trocar o slot ${i + 1} por:`
    seletor.append(titulo)

    if (opcoes.length === 0) {
      const vazio = document.createElement('p')
      vazio.className = 'paleta-picker-vazio'
      vazio.textContent = 'Nenhum outro rolo disponível.'
      seletor.append(vazio)
    } else {
      for (const f of opcoes) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'paleta-picker-item'
        const swatch = document.createElement('span')
        swatch.className = 'paleta-picker-swatch'
        swatch.style.backgroundColor = f.hex
        const nome = document.createElement('span')
        nome.textContent = f.name
        const td = document.createElement('span')
        td.className = 'paleta-picker-td'
        td.textContent = tdTexto(f.td)
        item.append(swatch, nome, td)
        item.addEventListener('click', () => trocar(i, f))
        seletor.append(item)
      }
    }

    const fechar = document.createElement('button')
    fechar.type = 'button'
    fechar.className = 'paleta-picker-fechar'
    fechar.textContent = 'Fechar'
    fechar.addEventListener('click', () => {
      pickerAberto = null
      render()
    })
    seletor.append(fechar)
    return seletor
  }

  // ---- curva de erro por número de cores (motor da lane C) ----

  const curvaDe = (): HTMLElement => {
    const caixa = document.createElement('div')
    caixa.className = 'paleta-curva'
    const titulo = document.createElement('p')
    titulo.className = 'fil-paleta-titulo'
    titulo.textContent = 'Erro médio por número de cores'
    caixa.append(titulo)

    const curva = sugestao!.curve
    const maxErr = Math.max(1, ...curva.map((p) => p.error))

    const barras = document.createElement('div')
    barras.className = 'paleta-curva-barras'
    for (const p of curva) {
      const coluna = document.createElement('div')
      coluna.className = 'paleta-curva-coluna'
      const barra = document.createElement('div')
      barra.className = 'paleta-curva-barra' + (p.n === sugestao!.recommended ? ' recomendada' : '')
      barra.style.height = `${Math.max(2, (p.error / maxErr) * 100)}%`
      barra.title = `${p.n} ${p.n === 1 ? 'cor' : 'cores'} → ΔE ${p.error.toFixed(1)}`
      const rotulo = document.createElement('span')
      rotulo.className = 'paleta-curva-rotulo'
      rotulo.textContent = `${p.n}`
      coluna.append(barra, rotulo)
      barras.append(coluna)
    }
    caixa.append(barras)

    const recomendado = sugestao!.recommended
    const passoDe = (n: number): PassoSugestao | undefined => curva.find((p) => p.n === n)
    const atual = passoDe(recomendado)
    const proximo = passoDe(recomendado + 1)
    const plural = recomendado === 1 ? 'cor' : 'cores'

    const banner = document.createElement('div')
    banner.className = 'paleta-recomendacao'
    const rotulo = document.createElement('strong')
    rotulo.textContent = `Recomendado para esta foto: ${recomendado} ${plural}.`
    const corpo = document.createElement('span')
    if (!atual) {
      corpo.textContent = ''
    } else if (!proximo) {
      corpo.textContent = 'É o máximo avaliado — cada cor extra custa mais uma troca.'
    } else {
      const ganho = Math.max(0, atual.error - proximo.error)
      const descricao = ganho < 1 ? 'menos de 1' : `apenas ${ganho.toFixed(1)}`
      corpo.textContent =
        `A ${recomendado + 1}ª cor melhora o erro em ${descricao} ΔE e custa mais uma troca — ` +
        'por isso não compensa. Os slots acima já estão preenchidos; edite à vontade.'
    }
    banner.append(rotulo, corpo)
    caixa.append(banner)
    return caixa
  }

  // ---- barra + medidor de gama (o que já existia) ----

  const barraEGama = (): HTMLElement => {
    const bloco = document.createElement('div')
    bloco.className = 'paleta-barra'

    if (estado.length === 0) return bloco

    // Divisão uniforme e contígua: cada filamento vira uma faixa (uma troca de
    // rolo). Se layers < nº de filamentos, os últimos não entram — como na geração.
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

    bloco.append(titulo, barra, nota, gama)
    return bloco
  }

  // ---- render ----

  const render = (): void => {
    container.replaceChildren()

    const raiz = document.createElement('div')
    raiz.className = 'fil-paleta'

    const titulo = document.createElement('h3')
    titulo.className = 'paleta-titulo'
    titulo.textContent = 'Paleta desta foto'
    const sub = document.createElement('p')
    sub.className = 'paleta-subtitulo'
    sub.textContent = sugestao
      ? 'Sugerida para esta foto — edite, remova, reordene ou acrescente cores à vontade.'
      : 'Monte as cores desta foto. Toque num slot para trocar o rolo; o primeiro vira a base.'
    raiz.append(titulo, sub)

    const slots = document.createElement('div')
    slots.className = 'paleta-slots'
    if (estado.length === 0) {
      const vazio = document.createElement('p')
      vazio.className = 'fil-vazio'
      vazio.textContent =
        'Nenhum rolo nos slots ainda — suba a foto para a sugestão automática preencher, ou adicione à mão com o +.'
      slots.append(vazio)
    } else {
      estado.forEach((f, i) => slots.append(slotDe(f, i)))
    }
    const disponiveis = naoUsados()
    if (disponiveis.length > 0) {
      const botaoMais = document.createElement('button')
      botaoMais.type = 'button'
      botaoMais.className = 'paleta-slot-adicionar'
      botaoMais.textContent = '+ Adicionar cor'
      botaoMais.title = 'Acrescenta um slot com o próximo rolo disponível do inventário'
      botaoMais.addEventListener('click', adicionar)
      slots.append(botaoMais)
    }
    raiz.append(slots)

    if (pickerAberto !== null) {
      const seletor = seletorDe(pickerAberto)
      if (seletor) raiz.append(seletor)
    }

    if (sugestao) raiz.append(curvaDe())

    raiz.append(barraEGama())
    container.append(raiz)
  }

  render()
}

/**
 * Maior ΔE entre DUAS entradas quaisquer da paleta.
 *
 * Comparar só a primeira com a última mediria errado: um cronograma que termina
 * no filamento da base fecha o ciclo e devolveria ~0, mesmo tendo passado longe
 * no meio. Mesma conta do `generate.ts`.
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