import type { Filament } from '../color/types.ts'
import { FILAMENTS, RESSALVAS } from '../filaments/db.ts'

/**
 * Monta o seletor de filamentos — o controle central da UI.
 *
 * Uma lista do catálogo (`FILAMENTS`) com amostra da cor, multi-seleção
 * ordenável (a ordem escolhida é a ordem em que os rolos entram no cronograma
 * de trocas), e um formulário de rolo manual (hex + TD) para quem usa um rolo
 * fora do catálogo. Itens com `estimated: true` ganham um selo de aviso.
 *
 * O array `estado` é mutado in place e `aoMudar` avisa quem chamou depois de
 * cada mudança — o seletor re-renderiza sozinho.
 */
export function montarFilamentos(opts: {
  container: HTMLElement
  estado: Filament[]
  aoMudar: () => void
}): void {
  const { container, estado, aoMudar } = opts
  // Rolos fora do catálogo adicionados pela pessoa — sobrevivem a desmarcar,
  // para poder reescolher sem digitar de novo.
  const manuais: Filament[] = []

  const indice = (id: string): number => estado.findIndex((f) => f.id === id)

  let detalhes: HTMLDetailsElement | null = null

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

  const tdTexto = (td: number): string => `${td.toFixed(1).replace('.', ',')} mm`

  const botaoChip = (rotulo: string, titulo: string, acao: () => void, desabilitado: boolean): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = rotulo
    b.title = titulo
    b.disabled = desabilitado
    b.addEventListener('click', acao)
    return b
  }

  const linhaSelecionado = (f: Filament, i: number): HTMLLIElement => {
    const li = document.createElement('li')
    li.className = 'chip'

    const pos = document.createElement('span')
    pos.className = 'pos'
    pos.textContent = `${i + 1}º`

    const amostra = document.createElement('span')
    amostra.className = 'amostra'
    amostra.style.backgroundColor = f.hex

    const nome = document.createElement('span')
    nome.className = 'nome'
    nome.textContent = f.name
    nome.title = f.name

    const td = document.createElement('span')
    td.className = 'td'
    td.textContent = tdTexto(f.td)

    const acoes = document.createElement('span')
    acoes.className = 'acoes'
    acoes.append(
      botaoChip('↑', `Sobe ${f.name}`, () => mover(f.id, -1), i === 0),
      botaoChip('↓', `Desce ${f.name}`, () => mover(f.id, 1), i === estado.length - 1),
      botaoChip('✕', `Remove ${f.name}`, () => selecionar(f), false),
    )

    li.append(pos, amostra, nome, td, acoes)
    return li
  }

  const linhaCatalogo = (f: Filament): HTMLButtonElement => {
    const ativo = indice(f.id) !== -1
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'filamento-opt' + (ativo ? ' ativo' : '')
    b.title = f.name

    const amostra = document.createElement('span')
    amostra.className = 'amostra'
    amostra.style.backgroundColor = f.hex

    const nome = document.createElement('span')
    nome.className = 'nome'
    nome.textContent = f.name

    if (f.estimated) {
      const selo = document.createElement('span')
      selo.className = 'badge-estimado'
      selo.textContent = 'estimado'
      selo.title = 'Cor e TD são estimativa, não medição própria.'
      b.append(amostra, nome, selo)
    } else {
      b.append(amostra, nome)
    }

    const td = document.createElement('span')
    td.className = 'td'
    td.textContent = tdTexto(f.td)
    b.append(td)

    const ressalva = RESSALVAS[f.id]
    if (ressalva) b.title = `${f.name} — ${ressalva}`

    const check = document.createElement('span')
    check.className = 'check'
    check.textContent = ativo ? '✓' : ''
    b.append(check)

    b.addEventListener('click', () => selecionar(f))
    return b
  }

  const render = (): void => {
    container.replaceChildren()

    const lista = document.createElement('ol')
    lista.className = 'lista-selecionados'
    if (estado.length === 0) {
      const li = document.createElement('li')
      li.className = 'chip'
      li.textContent = 'Nenhum filamento escolhido — selecione abaixo ou adicione um rolo manual.'
      li.style.opacity = '0.75'
      lista.append(li)
    } else {
      estado.forEach((f, i) => lista.append(linhaSelecionado(f, i)))
    }
    container.append(lista)

    if (manuais.length > 0) {
      const titulo = document.createElement('p')
      titulo.className = 'titulo-secao'
      titulo.textContent = 'Meus rolos'
      container.append(titulo)
      const grade = document.createElement('div')
      grade.className = 'grade-filamentos'
      manuais.forEach((f) => grade.append(linhaCatalogo(f)))
      container.append(grade)
    }

    const titulo = document.createElement('p')
    titulo.className = 'titulo-secao'
    titulo.textContent = 'Catálogo'
    container.append(titulo)
    const grade = document.createElement('div')
    grade.className = 'grade-filamentos'
    FILAMENTS.forEach((f) => grade.append(linhaCatalogo(f)))
    container.append(grade)

    // O formulário do rolo manual é construído UMA vez e reaproveitado: refazê-lo
    // a cada render fecharia o <details> e apagaria o hex/TD já digitados no meio
    // do preenchimento. `replaceChildren` tira o nó do container mas a referência
    // sobrevive com o estado intacto.
    if (!detalhes) {
      detalhes = document.createElement('details')
      const sumario = document.createElement('summary')
      sumario.textContent = 'Rolo fora do catálogo?'
      detalhes.append(sumario, formularioManual())
    }
    container.append(detalhes)
  }

  /**
   * Ponto único por onde toda mutação do estado passa. Redesenhar aqui, e não em
   * cada chamador, é o que garante que a lista de selecionados, a ordem e os
   * "Meus rolos" acompanhem o que a pessoa clicou.
   */
  const mudou = (): void => {
    render()
    aoMudar()
  }

  const formularioManual = (): HTMLDivElement => {
    const form = document.createElement('div')
    form.className = 'manual-form'

    const linha = document.createElement('div')
    linha.className = 'linha'

    const grupoNome = document.createElement('div')
    grupoNome.className = 'grupo'
    const labelNome = document.createElement('label')
    labelNome.textContent = 'Nome (opcional)'
    const inputNome = document.createElement('input')
    inputNome.type = 'text'
    inputNome.placeholder = 'Ex.: PETG azul da marca X'
    grupoNome.append(labelNome, inputNome)

    const grupoCor = document.createElement('div')
    grupoCor.className = 'grupo'
    const labelCor = document.createElement('label')
    labelCor.textContent = 'Cor'
    const linhaCor = document.createElement('div')
    linhaCor.className = 'linha'
    linhaCor.style.gridTemplateColumns = 'auto 1fr'
    const inputCor = document.createElement('input')
    inputCor.type = 'color'
    inputCor.value = '#d9d4c4'
    const inputHex = document.createElement('input')
    inputHex.type = 'text'
    inputHex.value = '#D9D4C4'
    inputHex.maxLength = 7
    inputHex.spellcheck = false
    inputCor.addEventListener('input', () => {
      inputHex.value = inputCor.value
    })
    inputHex.addEventListener('input', () => {
      const h = normalizaHex(inputHex.value)
      if (h) inputCor.value = h
    })
    linhaCor.append(inputCor, inputHex)
    grupoCor.append(labelCor, linhaCor)

    const grupoTd = document.createElement('div')
    grupoTd.className = 'grupo'
    const labelTd = document.createElement('label')
    labelTd.textContent = 'TD (mm)'
    const inputTd = document.createElement('input')
    inputTd.type = 'number'
    inputTd.min = '0.1'
    inputTd.step = '0.1'
    inputTd.value = '3.0'
    grupoTd.append(labelTd, inputTd)

    const grupoBotao = document.createElement('div')
    grupoBotao.className = 'grupo'
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.className = 'btn btn-primario'
    botao.textContent = 'Adicionar'
    grupoBotao.append(botao)

    linha.append(grupoNome, grupoCor, grupoTd, grupoBotao)
    form.append(linha)

    const erro = document.createElement('p')
    erro.className = 'erro-form'
    erro.style.display = 'none'
    form.append(erro)

    const falhar = (msg: string): void => {
      erro.textContent = msg
      erro.style.display = ''
    }

    botao.addEventListener('click', () => {
      const hex = normalizaHex(inputHex.value)
      if (!hex) {
        falhar('Cor inválida — use #RRGGBB.')
        return
      }
      const td = Number(inputTd.value)
      if (!Number.isFinite(td) || td <= 0) {
        falhar('TD precisa ser um número positivo, em mm.')
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

    return form
  }

  const normalizaHex = (v: string): string | null => {
    const m = v.trim().replace(/^#?/, '').match(/^([0-9a-fA-F]{6})$/)
    return m ? `#${m[1].toUpperCase()}` : null
  }

  render()
}