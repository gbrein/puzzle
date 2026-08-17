import type { Filament, LayerPlan, RGB } from '../color/types.ts'
import { FILAMENTS, RESSALVAS } from '../filaments/db.ts'
import { buildPalette } from '../color/beer-lambert.ts'
import { parseHex, rgbToLab, toHex } from '../color/space.ts'
import './filamentos.css'

/**
 * Seletor de filamentos — escolher cor, não nome de rolo.
 *
 * Grade de amostras grandes **ordenada por matiz** (H, depois L, via Lab),
 * busca por texto, e cada amostra mostra a **rampa real** do filamento
 * empilhado em 1/2/4/8 camadas sobre a base atual — é o que revela que dois
 * vermelhos com TD 0,3 e 3,3 se comportam de forma completamente diferente.
 * A rampa custa ~0 ms (`buildPalette`), então pode ser calculada na hora.
 *
 * Mantém a assinatura `{ container, estado, aoMudar }` — a lane B chama por ela.
 */

// Altura de camada fixa e representativa para a rampa (o default da UI). O
// comportamento qualitativo do TD não depende do valor exato; usar uma
// constante mantém as amostras comparáveis entre si.
const RAMPA_LAYER_HEIGHT = 0.16
const RAMPA_CAMADAS = [1, 2, 4, 8] as const
const RAMPA_TOPO = RAMPA_CAMADAS[RAMPA_CAMADAS.length - 1]

// Base de referência enquanto nenhum filamento estiver selecionado. O td aqui
// é irrelevante — a base é opaca, o `buildPalette` nunca usa o td dela.
const BASE_REFERENCIA: Filament = {
  id: 'ref-cinza-medio',
  name: 'cinza médio (referência)',
  hex: '#8C8C8C',
  td: 5,
}

export function montarFilamentos(opts: {
  container: HTMLElement
  estado: Filament[]
  aoMudar: () => void
}): void {
  const { container, estado, aoMudar } = opts
  const manuais: Filament[] = []
  let busca = ''

  const indice = (id: string): number => estado.findIndex((f) => f.id === id)

  const selecionar = (f: Filament): void => {
    const i = indice(f.id)
    if (i === -1) estado.push(f)
    else estado.splice(i, 1)
    mudou()
  }

  const mover = (id: string, delta: number): void => {
    const i = indice(id)
    const j = i + delta
    if (i === -1 || j < 0 || j >= estado.length) return
    const [item] = estado.splice(i, 1)
    estado.splice(j, 0, item)
    mudou()
  }

  const baseAtual = (): Filament => estado[0] ?? BASE_REFERENCIA

  /** Cor vista após 1, 2, 4 e 8 camadas do filamento sobre a base atual. */
  const rampaDo = (f: Filament): RGB[] => {
    const plan: LayerPlan = {
      layerHeight: RAMPA_LAYER_HEIGHT,
      baseLayers: 1,
      base: baseAtual(),
      schedule: Array.from({ length: RAMPA_TOPO }, () => f),
    }
    const palette = buildPalette(plan)
    return RAMPA_CAMADAS.map((k) => palette[k])
  }

  const matiz = (c: RGB): number => {
    const [, a, b] = rgbToLab(c)
    const h = (Math.atan2(b, a) * 180) / Math.PI
    return h < 0 ? h + 360 : h
  }

  const luminosidade = (c: RGB): number => rgbToLab(c)[0]

  // Recalculado a cada render, e não uma vez só: `manuais` cresce quando alguém
  // cadastra um rolo, e uma lista congelada na partida deixaria o rolo novo
  // fora da grade para sempre.
  const ordenadas = (): Filament[] =>
    [...FILAMENTS, ...manuais].sort((x, y) => {
      const hx = matiz(parseHex(x.hex))
      const hy = matiz(parseHex(y.hex))
      if (hx !== hy) return hx - hy
      return luminosidade(parseHex(x.hex)) - luminosidade(parseHex(y.hex))
    })

  // Busca sem diferenciar maiúsculas nem acentos: "aze" acha "Azul".
  const normaliza = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const visiveis = (): Filament[] => {
    const todas = ordenadas()
    if (!busca) return todas
    const alvo = normaliza(busca)
    return todas.filter((f) => normaliza(f.name).includes(alvo))
  }

  const botaoChip = (rotulo: string, titulo: string, acao: () => void, desabilitado: boolean): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fil-btn-chip'
    b.textContent = rotulo
    b.title = titulo
    b.disabled = desabilitado
    b.addEventListener('click', acao)
    return b
  }

  const chipDe = (f: Filament, i: number): HTMLLIElement => {
    const li = document.createElement('li')
    li.className = 'fil-chip'

    const pos = document.createElement('span')
    pos.className = 'fil-chip-pos'
    pos.textContent = `${i + 1}º`

    const swatch = document.createElement('span')
    swatch.className = 'fil-chip-swatch'
    swatch.style.backgroundColor = f.hex

    const nome = document.createElement('span')
    nome.className = 'fil-chip-nome'
    nome.textContent = f.name
    nome.title = f.name

    const td = document.createElement('span')
    td.className = 'fil-chip-td'
    td.textContent = `TD ${f.td.toFixed(1).replace('.', ',')} mm`

    const acoes = document.createElement('span')
    acoes.className = 'fil-chip-acoes'
    acoes.append(
      botaoChip('↑', `Sobe ${f.name}`, () => mover(f.id, -1), i === 0),
      botaoChip('↓', `Desce ${f.name}`, () => mover(f.id, 1), i === estado.length - 1),
      botaoChip('✕', `Remove ${f.name}`, () => selecionar(f), false),
    )

    li.append(pos, swatch, nome, td, acoes)

    if (i === 0) {
      const selo = document.createElement('span')
      selo.className = 'fil-base-selo'
      selo.textContent = 'base'
      selo.title = 'Primeiro da ordem — vira a base opaca da peça.'
      li.append(selo)
    }
    return li
  }

  const cardAmostra = (f: Filament): HTMLButtonElement => {
    const ativo = indice(f.id) !== -1
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fil-amostra' + (ativo ? ' ativo' : '')

    const base = baseAtual()
    btn.title = `${f.name} · TD ${f.td} mm
Rampa sobre ${base.name} (${base.hex}) em 1/2/4/8 camadas`

    const swatch = document.createElement('span')
    swatch.className = 'fil-swatch'
    swatch.style.backgroundColor = f.hex

    const rampa = document.createElement('span')
    rampa.className = 'fil-rampa'
    rampaDo(f).forEach((cor, k) => {
      const cel = document.createElement('span')
      cel.className = 'fil-rampa-celula'
      cel.style.backgroundColor = toHex(cor)
      cel.title = `${RAMPA_CAMADAS[k]} camada(s) → ${toHex(cor)}`
      rampa.append(cel)
    })

    const nome = document.createElement('span')
    nome.className = 'fil-amostra-nome'
    nome.textContent = f.name

    btn.append(swatch, rampa, nome)

    if (f.estimated) {
      const selo = document.createElement('span')
      selo.className = 'fil-badge-estimado'
      selo.textContent = 'estimado'
      selo.title = 'Cor e TD são estimativa, não medição própria.'
      btn.append(selo)
    }

    const ressalva = RESSALVAS[f.id]
    if (ressalva) btn.title = `${f.name} — ${ressalva}\n${btn.title}`

    const check = document.createElement('span')
    check.className = 'fil-amostra-check'
    check.textContent = '✓'
    btn.append(check)

    btn.addEventListener('click', () => selecionar(f))
    return btn
  }

  const formularioManual = (): HTMLDetailsElement => {
    const detalhes = document.createElement('details')
    detalhes.className = 'fil-manual'
    const sumario = document.createElement('summary')
    sumario.textContent = 'Rolo fora do catálogo?'
    detalhes.append(sumario)

    const form = document.createElement('div')
    form.className = 'fil-manual-form'
    const linha = document.createElement('div')
    linha.className = 'fil-manual-linha'

    const grupoNome = document.createElement('div')
    grupoNome.className = 'fil-grupo'
    const rotuloNome = document.createElement('span')
    rotuloNome.textContent = 'Nome (opcional)'
    const inputNome = document.createElement('input')
    inputNome.type = 'text'
    inputNome.placeholder = 'Ex.: PETG azul da marca X'
    grupoNome.append(rotuloNome, inputNome)

    const grupoCor = document.createElement('div')
    grupoCor.className = 'fil-grupo'
    const rotuloCor = document.createElement('span')
    rotuloCor.textContent = 'Cor'
    const inputCor = document.createElement('input')
    inputCor.type = 'color'
    inputCor.value = '#d9d4c4'
    grupoCor.append(rotuloCor, inputCor)

    const grupoTd = document.createElement('div')
    grupoTd.className = 'fil-grupo'
    const rotuloTd = document.createElement('span')
    rotuloTd.textContent = 'TD (mm)'
    const inputTd = document.createElement('input')
    inputTd.type = 'number'
    inputTd.min = '0.1'
    inputTd.step = '0.1'
    inputTd.value = '3.0'
    grupoTd.append(rotuloTd, inputTd)

    const grupoBotao = document.createElement('div')
    grupoBotao.className = 'fil-grupo'
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.className = 'fil-btn fil-btn-primario'
    botao.textContent = 'Adicionar'
    grupoBotao.append(botao)

    linha.append(grupoNome, grupoCor, grupoTd, grupoBotao)
    form.append(linha)

    const erro = document.createElement('p')
    erro.className = 'fil-erro-form'
    erro.style.display = 'none'
    form.append(erro)

    botao.addEventListener('click', () => {
      const hex = inputCor.value
      const td = Number(inputTd.value)
      if (!Number.isFinite(td) || td <= 0) {
        erro.textContent = 'TD precisa ser um número positivo, em mm.'
        erro.style.display = ''
        return
      }
      erro.style.display = 'none'
      const nome = inputNome.value.trim() || `Rolo ${hex}`
      const f: Filament = { id: `manual-${hex}-${Date.now()}`, name: nome, hex, td }
      if (indice(f.id) === -1) estado.push(f)
      if (!manuais.some((m) => m.id === f.id)) manuais.push(f)
      inputNome.value = ''
      mudou()
    })

    detalhes.append(form)
    return detalhes
  }

  // DOM fixo fora do render — recriar a busca a cada tecla faria o input perder
  // o foco a cada caractere digitado.
  const raiz = document.createElement('div')
  raiz.className = 'fil-seletor'

  const dica = document.createElement('p')
  dica.className = 'fil-dica'
  dica.textContent =
    'Toque para selecionar. O primeiro da ordem vira a base — a rampa de cada amostra ' +
    'mostra o filamento empilhado em 1/2/4/8 camadas sobre ela.'

  const buscaInput = document.createElement('input')
  buscaInput.type = 'search'
  buscaInput.className = 'fil-busca'
  buscaInput.placeholder = 'Buscar por nome…'
  buscaInput.addEventListener('input', () => {
    busca = buscaInput.value
    render()
  })

  const chips = document.createElement('ol')
  chips.className = 'fil-lista-selecionados'

  const grade = document.createElement('div')
  grade.className = 'fil-grade'

  raiz.append(dica, buscaInput, chips, grade, formularioManual())

  const render = (): void => {
    chips.replaceChildren()
    grade.replaceChildren()

    if (estado.length === 0) {
      const li = document.createElement('li')
      li.className = 'fil-chip'
      li.style.opacity = '0.7'
      li.textContent = 'Nenhum filamento escolhido ainda.'
      chips.append(li)
    } else {
      estado.forEach((f, i) => chips.append(chipDe(f, i)))
    }

    const mostraveis = visiveis()
    if (mostraveis.length === 0) {
      const vazio = document.createElement('p')
      vazio.className = 'fil-busca-vazia'
      vazio.textContent = 'Nenhum filamento encontrado para essa busca.'
      grade.append(vazio)
    } else {
      mostraveis.forEach((f) => grade.append(cardAmostra(f)))
    }
  }

  /**
   * Ponto único por onde toda mutação do estado passa. Redesenhar aqui, e não em
   * cada chamador, é o que garante que a lista de escolhidos, a ordem, a marca de
   * "base" e as rampas (que dependem da base) acompanhem o clique. Sem isto, a
   * pessoa clica numa amostra e nada muda na tela.
   */
  function mudou(): void {
    render()
    aoMudar()
  }

  container.replaceChildren(raiz)
  render()
}