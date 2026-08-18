import type { Filament } from '../color/types.ts'
import { FILAMENTS, findFilament, RESSALVAS } from '../filaments/db.ts'
import { parseHex, rgbToLab, type Lab } from '../color/space.ts'
import './filamentos.css'

/**
 * Inventário "meus rolos" — os rolos que a pessoa TEM, persistidos no
 * localStorage. A plataforma escolhe dentro deste acervo a cada foto; o
 * catálogo serve só para popular o inventário.
 *
 * Exporta exatamente três coisas: `lerInventario`, `salvarInventario` e
 * `montarInventario` — a lane A programa contra elas.
 */

const CHAVE = 'puzzle.inventario'

// --- ordenação (matiz + neutros por croma) ---
// O matiz puro espalharia preto/branco/cinza em posições arbitrárias porque
// eles não têm matiz definido; os de baixa croma vão agrupados no fim, por
// luminosidade. Limiar medido no catálogo: cinzas têm C* < 8, a madeira mais
// apagada passa de 10.
const CROMA_NEUTRA = 10

const labDe = (f: Filament): Lab => rgbToLab(parseHex(f.hex))
const matiz = ([, a, b]: Lab): number => {
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return h < 0 ? h + 360 : h
}
const croma = ([, a, b]: Lab): number => Math.hypot(a, b)
const luminosidade = ([l]: Lab): number => l
const grupoDe = (f: Filament): 'cor' | 'neutro' => (croma(labDe(f)) < CROMA_NEUTRA ? 'neutro' : 'cor')

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

// --- persistência ---

const valido = (f: unknown): f is Filament => {
  if (!f || typeof f !== 'object') return false
  const o = f as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.hex === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(o.hex) &&
    typeof o.td === 'number' &&
    Number.isFinite(o.td) &&
    o.td > 0
  )
}

/** Os rolos que a pessoa TEM. `[]` se nunca salvou nada ou se o JSON corrompeu. */
export function lerInventario(): Filament[] {
  try {
    const cru = localStorage.getItem(CHAVE)
    if (cru === null) return []
    const dados: unknown = JSON.parse(cru)
    if (!Array.isArray(dados)) return []
    return dados.filter(valido)
  } catch {
    return []
  }
}

/** Grava o inventário inteiro na mesma chave. */
export function salvarInventario(rolos: Filament[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(rolos))
  } catch {
    // sem storage (modo privado/quota) — o inventário vive só na memória
  }
}

// --- ponto de partida ---

// Havia aqui uma lista fixa de partida (preto, branco e uma terceira cor
// escolhida por medição numa imagem "representativa"). Ela saiu, e a medição não
// era o problema: o problema é que uma lista fixa é arbitrária por natureza —
// não sabe nada da foto de quem chegou nem dos rolos que a pessoa tem, e ainda
// assim aparece com cara de recomendação. Quem viu não tinha como saber de onde
// ela veio. O inventário vazio agora é preenchido por `sugerirDoCatalogo`, que
// roda o motor de sugestão sobre a foto de verdade.
//
// Ela também prefixava o id com `sugestao-`, o que fazia o rolo deixar de casar
// com o item do catálogo de onde saiu — outro motivo para não voltar.

// --- interface ---

const cria = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (classe) e.className = classe
  if (texto !== undefined) e.textContent = texto
  return e
}

/** Monta a interface de gerenciar o inventário. `aoMudar` avisa quem depende. */
export function montarInventario(opts: {
  container: HTMLElement
  aoMudar: (rolos: Filament[]) => void
  /**
   * Cores do catálogo que dariam bom resultado NA FOTO ATUAL, ou `null` quando
   * ainda não há foto. É o que preenche o estado vazio.
   *
   * Existe porque a versão anterior oferecia uma lista fixa ("preto, branco e
   * vermelho") apresentada como se fosse recomendação — e não era, era um chute
   * nosso. Quem chega aqui não tem como saber de onde o chute veio, e o
   * Guilherme reclamou exatamente disso. Derivar da foto da pessoa é a única
   * forma honesta de o inventário vazio ser útil em vez de arbitrário.
   */
  sugerirDoCatalogo?: () => Filament[] | null
}): void {
  const { container, aoMudar, sugerirDoCatalogo } = opts
  let rolos: Filament[] = lerInventario()
  let buscaCatalogo = ''
  let importado: string | null = null

  const indice = (id: string): number => rolos.findIndex((f) => f.id === id)

  const adicionar = (f: Filament): void => {
    if (indice(f.id) === -1) rolos.push(f)
    mudou()
  }

  const remover = (id: string): void => {
    const i = indice(id)
    if (i === -1) return
    rolos.splice(i, 1)
    mudou()
  }

  const editarTd = (id: string, td: number): void => {
    const f = rolos[indice(id)]
    if (!f || !Number.isFinite(td) || td <= 0) return
    f.td = td
    // quem digita o TD está calibrando o ROLO DELE — o valor deixa de ser a
    // estimativa do catálogo e o selo "estimado" some.
    delete f.estimated
    mudou()
  }

  /** Preenche o banner do inventário vazio com o que o motor achar PARA ESTA FOTO. */
  const renderVazio = (): void => {
    bannerVazio.replaceChildren(bannerTitulo)

    const sugeridas = sugerirDoCatalogo?.() ?? null
    if (!sugeridas || sugeridas.length === 0) {
      bannerVazio.append(
        cria(
          'p',
          undefined,
          'Cadastre os rolos que você tem — do catálogo abaixo ou à mão. Com uma foto carregada, ' +
            'a plataforma sugere aqui quais cores do catálogo dariam bom resultado nela.',
        ),
      )
      return
    }

    bannerVazio.append(
      cria('p', undefined, 'Estas cores do catálogo dariam bom resultado nesta foto. Quais delas você tem?'),
    )
    const linha = cria('div', 'fil-inv-sugeridas')
    for (const f of sugeridas) {
      const b = cria('button', 'fil-btn')
      b.type = 'button'
      b.title = `Adiciona ${f.name} (TD ${f.td} mm) ao seu inventário`
      const amostra = cria('span', 'fil-chip-swatch')
      amostra.style.backgroundColor = f.hex
      b.append(amostra, cria('span', undefined, f.name))
      b.addEventListener('click', () => adicionar(f))
      linha.append(b)
    }
    bannerVazio.append(linha)
  }

  // --- exportar / importar ---

  const exportar = (): void => {
    const blob = new Blob([JSON.stringify(rolos, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = cria('a')
    a.href = url
    a.download = 'meus-rolos.json'
    a.style.display = 'none'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const importarDoArquivo = async (arquivo: File): Promise<void> => {
    try {
      const texto = await arquivo.text()
      const dados: unknown = JSON.parse(texto)
      if (!Array.isArray(dados)) throw new Error('não é uma lista de rolos')
      const validos = dados.filter(valido)
      let novos = 0
      for (const f of validos) {
        if (indice(f.id) === -1) {
          rolos.push(f)
          novos++
        }
      }
      importado = novos > 0 ? `${novos} rolo(s) importado(s)` : 'Nada novo para importar (já estavam no inventário).'
      mudou()
    } catch {
      importado = 'Não consegui ler esse arquivo — ele tem que ser um JSON exportado daqui.'
      mudou()
    }
  }

  // --- DOM fixo (fora do render — recriar a cada tecla derruba o foco) ---

  const raiz = cria('div', 'fil-inventario')

  const bannerVazio = cria('div', 'fil-inv-vazio')
  const bannerTitulo = cria('p', 'fil-inv-vazio-titulo', 'Seu inventário está vazio.')
  // conteúdo montado em `renderVazio`, porque depende da foto atual

  const lista = cria('ul', 'fil-inv-lista')

  const acoes = cria('div', 'fil-inv-acoes')
  const botaoExportar = cria('button', 'fil-btn', 'Exportar JSON')
  botaoExportar.type = 'button'
  botaoExportar.title = 'Baixa um arquivo com o inventário inteiro — para não perder ao limpar o navegador.'
  botaoExportar.addEventListener('click', exportar)
  const botaoImportar = cria('button', 'fil-btn', 'Importar JSON')
  botaoImportar.type = 'button'
  botaoImportar.title = 'Lê um arquivo exportado daqui e junta os rolos que faltam.'
  const inputImportar = cria('input')
  inputImportar.type = 'file'
  inputImportar.accept = 'application/json'
  inputImportar.style.display = 'none'
  inputImportar.addEventListener('change', () => {
    const arquivo = inputImportar.files?.[0]
    if (arquivo) void importarDoArquivo(arquivo)
    inputImportar.value = ''
  })
  botaoImportar.addEventListener('click', () => inputImportar.click())
  acoes.append(botaoExportar, botaoImportar)
  const statusImport = cria('p', 'fil-inv-status oculto')

  // bloco "adicionar do catálogo"
  const detalhesCatalogo = cria('details', 'fil-manual')
  const sumarioCatalogo = cria('summary', undefined, 'Adicionar rolo do catálogo')
  const buscaCatalogoInput = cria('input')
  buscaCatalogoInput.type = 'search'
  buscaCatalogoInput.className = 'fil-busca'
  buscaCatalogoInput.placeholder = 'Buscar por nome…'
  buscaCatalogoInput.addEventListener('input', () => {
    buscaCatalogo = buscaCatalogoInput.value
    renderGradeCatalogo()
  })
  const gradeCatalogo = cria('div', 'fil-grade')
  detalhesCatalogo.append(sumarioCatalogo, buscaCatalogoInput, gradeCatalogo)

  // bloco "adicionar à mão"
  const detalhesManual = cria('details', 'fil-manual')
  const sumarioManual = cria('summary', undefined, 'Adicionar rolo à mão')
  const formManual = cria('div', 'fil-manual-form')
  const linhaManual = cria('div', 'fil-manual-linha')

  const grupoCor = cria('div', 'fil-grupo')
  const rotuloCor = cria('span', undefined, 'Cor')
  const inputCor = cria('input')
  inputCor.type = 'color'
  inputCor.value = '#d9d4c4'
  grupoCor.append(rotuloCor, inputCor)

  const grupoTd = cria('div', 'fil-grupo')
  const rotuloTd = cria('span', undefined, 'TD (mm)')
  const inputTd = cria('input')
  inputTd.type = 'number'
  inputTd.min = '0.1'
  inputTd.step = '0.1'
  inputTd.value = '3.0'
  grupoTd.append(rotuloTd, inputTd)

  const grupoNome = cria('div', 'fil-grupo')
  const rotuloNome = cria('span', undefined, 'Nome')
  const inputNome = cria('input')
  inputNome.type = 'text'
  inputNome.placeholder = 'Ex.: PETG azul da marca X'
  grupoNome.append(rotuloNome, inputNome)

  const grupoBotao = cria('div', 'fil-grupo')
  const botaoManual = cria('button', 'fil-btn fil-btn-primario', 'Adicionar')
  botaoManual.type = 'button'
  grupoBotao.append(botaoManual)

  const erroManual = cria('p', 'fil-erro-form')
  erroManual.style.display = 'none'

  linhaManual.append(grupoCor, grupoTd, grupoNome, grupoBotao)
  formManual.append(linhaManual, erroManual)
  detalhesManual.append(sumarioManual, formManual)

  botaoManual.addEventListener('click', () => {
    const hex = inputCor.value
    const td = Number(inputTd.value)
    if (!Number.isFinite(td) || td <= 0) {
      erroManual.textContent = 'TD precisa ser um número positivo, em mm.'
      erroManual.style.display = ''
      return
    }
    erroManual.style.display = 'none'
    const nome = inputNome.value.trim() || `Rolo ${hex}`
    adicionar({ id: `manual-${hex}-${Date.now()}`, name: nome, hex, td })
    inputNome.value = ''
  })

    // Cadastrar rolos é tarefa de uma vez — o inventário inteiro fica recolhido
  // num resumo compacto "Meus rolos (N)" com a faixa de cores, e expande só
  // para editar. Exportar/importar e os blocos de adicionar vivem no expandido.
  const caixa = cria('details', 'fil-inv-caixa')
  const resumo = cria('summary', 'fil-inv-resumo')
  const resumoTitulo = cria('span', 'fil-inv-resumo-titulo')
  const resumoSwatches = cria('span', 'fil-inv-resumo-swatches')
  resumo.append(resumoTitulo, resumoSwatches)

  const conteudo = cria('div', 'fil-inv-conteudo')
  conteudo.append(bannerVazio, lista, acoes, statusImport, detalhesCatalogo, detalhesManual)
  caixa.append(resumo, conteudo)

  raiz.append(caixa)

  // primeira visita sem rolos: aberto por padrão para a sugestão inicial ficar
  // visível; com rolos já cadastrados, nasce recolhido. Depois disso a pessoa
  // controla o expandir/colapsar — o render não briga com ela.
  caixa.open = rolos.length === 0

  // --- render ---

  const cardCatalogo = (f: Filament): HTMLButtonElement => {
    const presente = indice(f.id) !== -1
    const btn = cria('button', 'fil-amostra' + (presente ? ' ativo' : ''))
    btn.type = 'button'
    btn.title = f.name

    const swatch = cria('span', 'fil-swatch')
    swatch.style.backgroundColor = f.hex

    const nome = cria('span', 'fil-amostra-nome', f.name)

    const td = cria('span', 'fil-amostra-td', `TD ${f.td.toFixed(1).replace('.', ',')} mm`)

    btn.append(swatch, nome, td)

    if (f.estimated) {
      const selo = cria('span', 'fil-badge-estimado', 'estimado')
      selo.title = 'Cor e TD são estimativa, não medição própria.'
      btn.append(selo)
    }

    const ressalva = RESSALVAS[f.id]
    if (ressalva) btn.title = `${f.name} — ${ressalva}`

    const check = cria('span', 'fil-amostra-check', '✓')
    btn.append(check)

    btn.addEventListener('click', () => {
      if (presente) remover(f.id)
      else adicionar(f)
    })
    return btn
  }

  const linhaDa = (f: Filament): HTMLLIElement => {
    const li = cria('li', 'fil-inv-item')

    const swatch = cria('span', 'fil-chip-swatch')
    swatch.style.backgroundColor = f.hex

    const nome = cria('span', 'fil-inv-nome', f.name)
    nome.title = f.name

    const grupoTdEdicao = cria('label', 'fil-inv-td')
    const rotuloTd = cria('span', undefined, 'TD')
    rotuloTd.title =
      'Transmission distance — o número que você calibra na sua impressora. O valor do catálogo é estimativa; edite aqui o seu.'
    const inputTdEdicao = cria('input')
    inputTdEdicao.type = 'number'
    inputTdEdicao.min = '0.1'
    inputTdEdicao.step = '0.1'
    inputTdEdicao.value = String(f.td)
    inputTdEdicao.title = 'O TD que você calibrou na sua impressora — edite e o selo "estimado" some.'
    inputTdEdicao.addEventListener('change', () => {
      editarTd(f.id, Number(inputTdEdicao.value))
    })
    grupoTdEdicao.append(rotuloTd, inputTdEdicao)

    const botaoRemover = cria('button', 'fil-btn-chip', '✕')
    botaoRemover.type = 'button'
    botaoRemover.title = `Remove ${f.name} do inventário`
    botaoRemover.addEventListener('click', () => remover(f.id))

    li.append(swatch, nome, grupoTdEdicao, botaoRemover)

    // o selo "estimado" ACOMPANHA o rolo até a pessoa calibrar o TD próprio —
    // é o aviso de que o valor veio do catálogo, não da impressora dela.
    if (f.estimated) {
      const selo = cria('span', 'fil-badge-estimado', 'estimado')
      selo.title = 'Cor e TD são estimativa do catálogo — calibre o TD do seu rolo e o selo some.'
      li.append(selo)
    }

    return li
  }

  const renderGradeCatalogo = (): void => {
    gradeCatalogo.replaceChildren()
    let itens = FILAMENTS
    if (buscaCatalogo) {
      const alvo = normaliza(buscaCatalogo)
      itens = itens.filter((f) => normaliza(f.name).includes(alvo))
    }
    if (itens.length === 0) {
      gradeCatalogo.append(cria('p', 'fil-busca-vazia', 'Nenhum rolo encontrado para essa busca.'))
      return
    }
    // neutros agrupados à parte, como no restante da interface
    let emNeutros = false
    for (const f of ordenadas(itens)) {
      const neutro = grupoDe(f) === 'neutro'
      if (neutro && !emNeutros) {
        emNeutros = true
        gradeCatalogo.append(cria('p', 'fil-grupo-rotulo', 'Neutros'))
      }
      gradeCatalogo.append(cardCatalogo(f))
    }
  }

  const render = (): void => {
    // resumo compacto: contagem + faixa de amostras em linha
    resumoTitulo.textContent = `Meus rolos (${rolos.length})`
    resumoSwatches.replaceChildren()
    for (const f of ordenadas(rolos)) {
      const s = cria('span', 'fil-inv-resumo-swatch')
      s.style.backgroundColor = f.hex
      s.title = f.name
      resumoSwatches.append(s)
    }

    // lista do inventário
    lista.replaceChildren()
    if (rolos.length === 0) {
      const li = cria('li', 'fil-inv-item')
      li.textContent = 'Nenhum rolo cadastrado.'
      li.style.opacity = '0.7'
      lista.append(li)
    } else {
      for (const f of ordenadas(rolos)) lista.append(linhaDa(f))
    }

    bannerVazio.classList.toggle('oculto', rolos.length > 0)
    if (rolos.length === 0) renderVazio()

    if (importado) {
      statusImport.textContent = importado
      statusImport.classList.remove('oculto')
      importado = null
    } else {
      statusImport.classList.add('oculto')
    }

    renderGradeCatalogo()
  }

  /**
   * Ponto único por onde toda mutação passa: persiste, redesenha E avisa quem
   * depende com o inventário lido de volta. Chamar `aoMudar` direto é o bug do
   * docs/achados.md — clicar deixa de mudar qualquer coisa na tela.
   */
  function mudou(): void {
    salvarInventario(rolos)
    render()
    aoMudar(lerInventario())
  }

  container.replaceChildren(raiz)
  render()
}