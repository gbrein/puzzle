import type { Filament, LayerPlan, RGB } from '../color/types.ts'
import { FILAMENTS, RESSALVAS } from '../filaments/db.ts'
import { buildPalette } from '../color/beer-lambert.ts'
import { parseHex, rgbToLab, toHex, type Lab } from '../color/space.ts'
import './filamentos.css'

/**
 * Seletor de filamentos — escolher cor, não nome de rolo.
 *
 * Grade de amostras GRANDES ordenada por matiz (H, depois L, via Lab), com os
 * neutros de baixa croma agrupados à parte (preto, branco e cinza não têm
 * matiz definido — o matiz puro os jogaria em posições arbitrárias). Cada
 * amostra mostra a **rampa real** do filamento empilhado em 1/2/4/8 camadas
 * sobre a base atual — é o que revela que dois vermelhos com TD 0,3 e 3,3 se
 * comportam de forma completamente diferente. A rampa custa ~0 ms
 * (`buildPalette`), então pode ser calculada na hora.
 *
 * "Meus rolos" (cadastrados à mão) e catálogo ficam em seções separadas — quem
 * escolhe quer o que TEM à vista, sem o catálogo inteiro no meio do caminho.
 * E há um modo **comparar** que pinha duas amostras lado a lado sem tocar na
 * seleção.
 *
 * Mantém a assinatura `{ container, estado, aoMudar }` — o main.ts chama por ela.
 */

// Altura de camada fixa e representativa para a rampa (o default da UI). O
// comportamento qualitativo do TD não depende do valor exato; usar uma
// constante mantém as amostras comparáveis entre si.
const RAMPA_LAYER_HEIGHT = 0.16
const RAMPA_CAMADAS = [1, 2, 4, 8] as const
const RAMPA_TOPO = RAMPA_CAMADAS[RAMPA_CAMADAS.length - 1]

// Abaixo desta croma (C* ≈ sqrt(a²+b²)) o matiz deixa de ser confiável — o tom
// é neutro. Valor medido no catálogo: cinzas têm C* < 8, a madeira mais apagada
// fica acima de 10.
const CROMA_NEUTRA = 10

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

  // Estado do modo comparar — é estado de INTERFACE, não de seleção: mexer aqui
  // re-renderiza mas NÃO dispara aoMudar() (a escolha de rolos não mudou).
  let comparando = false
  let compararA: Filament | null = null
  let compararB: Filament | null = null

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

  // --- ordem: matiz para os cromáticos, luminosidade para os neutros ---

  const labDe = (f: Filament): Lab => rgbToLab(parseHex(f.hex))
  const matiz = ([, a, b]: Lab): number => {
    const h = (Math.atan2(b, a) * 180) / Math.PI
    return h < 0 ? h + 360 : h
  }
  const croma = ([, a, b]: Lab): number => Math.hypot(a, b)
  const luminosidade = ([l]: Lab): number => l

  const grupoDe = (f: Filament): 'cor' | 'neutro' => (croma(labDe(f)) < CROMA_NEUTRA ? 'neutro' : 'cor')

  /**
   * Recalculada a cada render, e não uma vez só: `manuais` cresce quando alguém
   * cadastra um rolo, e uma lista congelada na partida deixaria o rolo novo
   * fora da grade para sempre.
   *
   * Ordem: cores por matiz (e luminosidade), neutros agrupados no fim por
   * luminosidade — o matiz puro espalharia preto/branco/cinza em posições
   * arbitrárias, porque eles não têm matiz definido.
   */
  const ordenadas = (lista: Filament[]): Filament[] =>
    [...lista].sort((x, y) => {
      const gx = grupoDe(x)
      const gy = grupoDe(y)
      if (gx !== gy) return gx === 'neutro' ? 1 : -1
      if (gx === 'neutro') return luminosidade(labDe(x)) - luminosidade(labDe(y))
      const hx = matiz(labDe(x))
      const hy = matiz(labDe(y))
      if (hx !== hy) return hx - hy
      return luminosidade(labDe(x)) - luminosidade(labDe(y))
    })

  // Busca sem diferenciar maiúsculas nem acentos: "aze" acha "Azul".
  const normaliza = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const filtradas = (lista: Filament[]): Filament[] => {
    if (!busca) return lista
    const alvo = normaliza(busca)
    return lista.filter((f) => normaliza(f.name).includes(alvo))
  }

  // --- modo comparar ---

  const alternarComparado = (f: Filament): void => {
    if (compararA?.id === f.id) compararA = null
    else if (compararB?.id === f.id) compararB = null
    else if (!compararA) compararA = f
    else if (!compararB) compararB = f
    else {
      // já tem dois pinos — o mais antigo (A) dá lugar ao novo
      compararA = compararB
      compararB = f
    }
    render()
  }

  const marcadorComparado = (f: Filament): 'A' | 'B' | null =>
    compararA?.id === f.id ? 'A' : compararB?.id === f.id ? 'B' : null

  // --- DOM dos itens ---

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

  const rampaDe = (f: Filament): HTMLSpanElement => {
    const rampa = document.createElement('span')
    rampa.className = 'fil-rampa'
    rampaDo(f).forEach((cor, k) => {
      const cel = document.createElement('span')
      cel.className = 'fil-rampa-celula'
      cel.style.backgroundColor = toHex(cor)
      cel.title = `${RAMPA_CAMADAS[k]} camada(s) → ${toHex(cor)}`
      rampa.append(cel)
    })
    return rampa
  }

  const cardAmostra = (f: Filament): HTMLButtonElement => {
    const ativo = indice(f.id) !== -1
    const marca = marcadorComparado(f)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className =
      'fil-amostra' +
      (ativo ? ' ativo' : '') +
      (comparando ? ' comparando' : '') +
      (marca ? ` comparado` : '')

    const base = baseAtual()
    btn.title = `${f.name} · TD ${f.td.toFixed(1)} mm
Rampa sobre ${base.name} (${base.hex}) em 1/2/4/8 camadas`

    const swatch = document.createElement('span')
    swatch.className = 'fil-swatch'
    swatch.style.backgroundColor = f.hex

    const nome = document.createElement('span')
    nome.className = 'fil-amostra-nome'
    nome.textContent = f.name
    nome.title = f.name

    const td = document.createElement('span')
    td.className = 'fil-amostra-td'
    td.textContent = `TD ${f.td.toFixed(1).replace('.', ',')} mm`

    btn.append(swatch, rampaDe(f), nome, td)

    if (f.estimated) {
      const selo = document.createElement('span')
      selo.className = 'fil-badge-estimado'
      selo.textContent = 'estimado'
      selo.title = 'Cor e TD são estimativa, não medição própria.'
      btn.append(selo)
    }

    const ressalva = RESSALVAS[f.id]
    if (ressalva) btn.title = `${f.name} — ${ressalva}\n${btn.title}`

    if (comparando) {
      const badge = document.createElement('span')
      badge.className = 'fil-amostra-badge'
      badge.textContent = marca ?? '?'
      badge.title = 'Pino do modo comparar — a seleção não muda.'
      btn.append(badge)
    }

    const check = document.createElement('span')
    check.className = 'fil-amostra-check'
    check.textContent = '✓'
    btn.append(check)

    btn.addEventListener('click', () => {
      if (comparando) alternarComparado(f)
      else selecionar(f)
    })
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

  // --- DOM fixo fora do render ---
  // Recriar a busca a cada tecla faria o input perder o foco a cada caractere
  // digitado; o painel de comparar também é fixo (o conteúdo é que muda).

  const raiz = document.createElement('div')
  raiz.className = 'fil-seletor'

  const dica = document.createElement('p')
  dica.className = 'fil-dica'
  dica.textContent =
    'Toque para selecionar. O primeiro da ordem vira a base — a rampa de cada amostra ' +
    'mostra o filamento empilhado em 1/2/4/8 camadas sobre ela.'

  const toolbar = document.createElement('div')
  toolbar.className = 'fil-toolbar'
  const buscaInput = document.createElement('input')
  buscaInput.type = 'search'
  buscaInput.className = 'fil-busca'
  buscaInput.placeholder = 'Buscar por nome…'
  buscaInput.addEventListener('input', () => {
    busca = buscaInput.value
    render()
  })
  const botaoComparar = document.createElement('button')
  botaoComparar.type = 'button'
  botaoComparar.className = 'fil-btn fil-btn-comparar'
  botaoComparar.title = 'Pinha duas amostras para ver as rampas lado a lado — a seleção não muda.'
  botaoComparar.addEventListener('click', () => {
    comparando = !comparando
    if (!comparando) {
      compararA = null
      compararB = null
    }
    // é estado de interface, não de seleção — render sem aoMudar()
    render()
  })
  toolbar.append(buscaInput, botaoComparar)

  const compararDica = document.createElement('p')
  compararDica.className = 'fil-dica fil-dica-comparar oculto'
  compararDica.textContent = 'Toque em duas amostras para comparar as rampas lado a lado — a seleção fica intacta.'

  const chips = document.createElement('ol')
  chips.className = 'fil-lista-selecionados'

  const painelComparar = document.createElement('div')
  painelComparar.className = 'fil-comparar oculto'

  const gradeContainer = document.createElement('div')
  gradeContainer.className = 'fil-grade-container'

  raiz.append(dica, toolbar, compararDica, chips, painelComparar, gradeContainer, formularioManual())

  // --- render ---

  const renderComparar = (): void => {
    painelComparar.replaceChildren()
    if (!comparando) {
      painelComparar.classList.add('oculto')
      return
    }
    painelComparar.classList.remove('oculto')

    const itemDe = (marca: 'A' | 'B', f: Filament | null, dica?: string): HTMLElement => {
      const item = document.createElement('div')
      item.className = 'fil-comparar-item'
      if (!f) {
        const p = document.createElement('p')
        p.className = 'fil-comparar-placeholder'
        p.textContent = dica ?? `Escolha a amostra ${marca}.`
        item.append(p)
        return item
      }
      const rotulo = document.createElement('span')
      rotulo.className = 'fil-comparar-marca'
      rotulo.textContent = marca
      const swatch = document.createElement('span')
      swatch.className = 'fil-swatch'
      swatch.style.backgroundColor = f.hex
      const nome = document.createElement('span')
      nome.className = 'fil-amostra-nome'
      nome.textContent = f.name
      const td = document.createElement('span')
      td.className = 'fil-amostra-td'
      td.textContent = `TD ${f.td.toFixed(1).replace('.', ',')} mm`
      item.append(rotulo, swatch, rampaDe(f), nome, td)
      return item
    }

    painelComparar.append(itemDe('A', compararA), itemDe('B', compararB, 'Escolha uma segunda amostra para comparar.'))
  }

  const secaoDe = (titulo: string, lista: Filament[]): HTMLElement => {
    const secao = document.createElement('div')
    secao.className = 'fil-secao'
    const h = document.createElement('p')
    h.className = 'fil-secao-titulo'
    h.textContent = titulo
    secao.append(h)

    const grade = document.createElement('div')
    grade.className = 'fil-grade'
    let emNeutros = false
    for (const f of lista) {
      const neutro = grupoDe(f) === 'neutro'
      if (neutro && !emNeutros) {
        emNeutros = true
        const rotulo = document.createElement('p')
        rotulo.className = 'fil-grupo-rotulo'
        rotulo.textContent = 'Neutros'
        grade.append(rotulo)
      }
      grade.append(cardAmostra(f))
    }
    secao.append(grade)
    return secao
  }

  const render = (): void => {
    chips.replaceChildren()
    if (estado.length === 0) {
      const li = document.createElement('li')
      li.className = 'fil-chip'
      li.style.opacity = '0.7'
      li.textContent = 'Nenhum filamento escolhido ainda.'
      chips.append(li)
    } else {
      estado.forEach((f, i) => chips.append(chipDe(f, i)))
    }

    botaoComparar.textContent = comparando ? 'Concluir comparação' : 'Comparar'
    botaoComparar.classList.toggle('ativo', comparando)
    compararDica.classList.toggle('oculto', !comparando)

    renderComparar()

    gradeContainer.replaceChildren()
    let achou = false
    const secoes: [string, Filament[]][] = []
    if (manuais.length > 0) secoes.push(['Meus rolos', manuais])
    secoes.push(['Catálogo', FILAMENTS])
    for (const [titulo, lista] of secoes) {
      const visiveis = ordenadas(filtradas(lista))
      if (visiveis.length === 0) continue
      achou = true
      gradeContainer.append(secaoDe(titulo, visiveis))
    }
    if (!achou) {
      const vazio = document.createElement('p')
      vazio.className = 'fil-busca-vazia'
      vazio.textContent = 'Nenhum filamento encontrado para essa busca.'
      gradeContainer.append(vazio)
    }
  }

  /**
   * Ponto único por onde toda mutação do estado (seleção) passa. Redesenhar
   * aqui, e não em cada chamador, é o que garante que a lista de escolhidos, a
   * ordem, a marca de "base" e as rampas (que dependem da base) acompanhem o
   * clique. Sem isto, a pessoa clica numa amostra e nada muda na tela.
   */
  function mudou(): void {
    render()
    aoMudar()
  }

  container.replaceChildren(raiz)
  render()
}