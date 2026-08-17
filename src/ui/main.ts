import type { Bitmap, Filament } from '../color/types.ts'
import type { GenerateOptions, GenerateResult } from '../generate.ts'
import { desenharPreview2D } from '../preview/preview2d.ts'
import { criarVisualizador3D, type Visualizador3D } from '../preview/preview3d.ts'
import { cancelar, gerarNoWorker, type Progresso } from '../worker/client.ts'
import { montarFilamentos } from './filamentos.ts'
import { montarCrop, montarUpload } from './foto.ts'

// ---------------------------------------------------------------- utilidades

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

const baixar = (blob: Blob, nome: string): void => {
  const url = URL.createObjectURL(blob)
  const a = cria('a')
  a.href = url
  a.download = nome
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ------------------------------------------------------------------- estado

interface Configuracao {
  size: number
  pieceCount: number
  layers: number
  layerHeight: number
  baseThickness: number
  maxSwaps: number
  kerf: number
  dither: boolean
  swapMode: 'manual' | 'ams'
  printerModel: string
}

const configuracao: Configuracao = {
  size: 180,
  pieceCount: 20,
  layers: 25,
  layerHeight: 0.16,
  baseThickness: 2.4,
  maxSwaps: 3,
  kerf: 0.4,
  dither: false,
  swapMode: 'manual',
  printerModel: '',
}

const filamentos: Filament[] = []
let bitmap: Bitmap | null = null
let resultado: GenerateResult | null = null
let gerando = false
let cancelado = false
let visualizador: Visualizador3D | null = null

// ------------------------------------------------------------ controles

const controleNumero = (opts: {
  rotulo: string
  min: number
  max: number
  passo: number
  valor: number
  formatar: (v: number) => string
  aoMudar: (v: number) => void
  ajuda?: string
}): HTMLElement => {
  const campo = cria('label', 'controle')
  const cabecalho = cria('span', 'cabecalho')
  const rotulo = cria('span', 'rotulo', opts.rotulo)
  const valor = cria('span', 'valor', opts.formatar(opts.valor))
  cabecalho.append(rotulo, valor)
  const input = cria('input')
  input.type = 'range'
  input.min = String(opts.min)
  input.max = String(opts.max)
  input.step = String(opts.passo)
  input.value = String(opts.valor)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    valor.textContent = opts.formatar(v)
    opts.aoMudar(v)
  })
  campo.append(cabecalho, input)
  if (opts.ajuda) {
    const ajuda = cria('span', 'ajuda', opts.ajuda)
    campo.append(ajuda)
  }
  return campo
}

const controleSelect = (opts: {
  rotulo: string
  opcoes: { valor: string; rotulo: string }[]
  valor: string
  aoMudar: (v: string) => void
  ajuda?: string
}): HTMLElement => {
  const campo = cria('label', 'controle')
  const rotulo = cria('span', 'rotulo', opts.rotulo)
  const select = cria('select')
  for (const o of opts.opcoes) {
    const opt = cria('option', undefined, o.rotulo)
    opt.value = o.valor
    select.append(opt)
  }
  select.value = opts.valor
  select.addEventListener('change', () => opts.aoMudar(select.value))
  campo.append(rotulo, select)
  if (opts.ajuda) {
    const ajuda = cria('span', 'ajuda', opts.ajuda)
    campo.append(ajuda)
  }
  return campo
}

const controleCheck = (opts: {
  rotulo: string
  valor: boolean
  aoMudar: (v: boolean) => void
  ajuda?: string
}): HTMLElement => {
  const campo = cria('label', 'controle')
  const linha = cria('span', 'linha-check')
  const rotulo = cria('span', 'rotulo', opts.rotulo)
  const input = cria('input')
  input.type = 'checkbox'
  input.checked = opts.valor
  input.addEventListener('change', () => opts.aoMudar(input.checked))
  linha.append(rotulo, input)
  campo.append(linha)
  if (opts.ajuda) {
    const ajuda = cria('span', 'ajuda', opts.ajuda)
    campo.append(ajuda)
  }
  return campo
}

// -------------------------------------------------------------------- app

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('nó #app não encontrado')

app.replaceChildren()

const cabecalho = cria('header', 'cabecalho')
const titulo = cria('h1')
titulo.innerHTML = '<span class="logo">puzzle</span> — quebra-cabeça imprimível a partir de uma foto'
const subtitulo = cria('p', undefined, 'Sobe uma foto, escolhe os rolos de filamento, ajusta a impressão e baixa um .3mf de projeto com as trocas de cor embutidas. Tudo no seu navegador.')
cabecalho.append(titulo, subtitulo)

const layout = cria('main', 'layout')
const colEsquerda = cria('aside', 'coluna')
const colDireita = cria('section', 'coluna')

// --- coluna esquerda: foto ---

const painelFoto = cria('section', 'painel')
const tituloFoto = cria('h2')
tituloFoto.innerHTML = '<span class="passo">1.</span> Foto'
const areaUpload = cria('div')
const areaCrop = cria('div', 'oculto')
const canvasCrop = cria('canvas')
areaCrop.append(canvasCrop)
const linhaCrop = cria('div', 'linha-acoes')
const infoCrop = cria('span', 'info')
const botaoAplicar = cria('button', 'btn btn-primario', 'Aplicar recorte')
linhaCrop.append(infoCrop, botaoAplicar)
areaCrop.append(linhaCrop)
painelFoto.append(tituloFoto, areaUpload, areaCrop)

// --- coluna esquerda: filamentos ---

const painelFilamentos = cria('section', 'painel')
const tituloFilamentos = cria('h2')
tituloFilamentos.innerHTML = '<span class="passo">2.</span> Filamentos'
const dicaFilamentos = cria('p', 'dica', 'Escolha os rolos na ordem em que quer que entrem no cronograma. O primeiro vira a base da peça.')
const areaFilamentos = cria('div')
painelFilamentos.append(tituloFilamentos, dicaFilamentos, areaFilamentos)

// --- coluna esquerda: impressão ---

const painelImpressao = cria('section', 'painel')
const tituloImpressao = cria('h2')
tituloImpressao.innerHTML = '<span class="passo">3.</span> Impressão'
const areaControles = cria('div', 'controles')

const TAMANHOS = [100, 140, 180, 210, 250]
const ALTURAS_CAMADA = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]
const PRESETS = [
  { valor: '', rotulo: 'Genérico (bico 0,4 mm)' },
  { valor: 'Bambu Lab X1 Carbon', rotulo: 'Bambu Lab X1 Carbon (X1C)' },
  { valor: 'Bambu Lab P1S', rotulo: 'Bambu Lab P1S' },
  { valor: 'Bambu Lab A1', rotulo: 'Bambu Lab A1' },
]

areaControles.append(
  controleSelect({
    rotulo: 'Tamanho da placa',
    opcoes: TAMANHOS.map((t) => ({ valor: String(t), rotulo: `${t} mm` })),
    valor: String(configuracao.size),
    aoMudar: (v) => {
      configuracao.size = Number(v)
    },
    ajuda: 'Maior dimensão da placa. 100/140/180/210/250 mm.',
  }),
  controleNumero({
    rotulo: 'Peças',
    min: 4,
    max: 120,
    passo: 1,
    valor: configuracao.pieceCount,
    formatar: (v) => `${v} peças`,
    aoMudar: (v) => {
      configuracao.pieceCount = v
    },
  }),
  controleNumero({
    rotulo: 'Camadas de cor',
    min: 1,
    max: 60,
    passo: 1,
    valor: configuracao.layers,
    formatar: (v) => `${v} camadas`,
    aoMudar: (v) => {
      configuracao.layers = v
    },
    ajuda: 'Mais camadas = mais tons, print mais alto.',
  }),
  controleSelect({
    rotulo: 'Altura de camada',
    opcoes: ALTURAS_CAMADA.map((a) => ({ valor: String(a), rotulo: `${a.toFixed(2).replace('.', ',')} mm` })),
    valor: String(configuracao.layerHeight),
    aoMudar: (v) => {
      configuracao.layerHeight = Number(v)
    },
  }),
  controleNumero({
    rotulo: 'Espessura da base',
    min: 0.8,
    max: 6,
    passo: 0.2,
    valor: configuracao.baseThickness,
    formatar: (v) => `${v.toFixed(1)} mm`,
    aoMudar: (v) => {
      configuracao.baseThickness = v
    },
    ajuda: 'Vira um número inteiro de camadas.',
  }),
  controleNumero({
    rotulo: 'Trocas máximas',
    min: 1,
    max: 8,
    passo: 1,
    valor: configuracao.maxSwaps,
    formatar: (v) => `${v}`,
    aoMudar: (v) => {
      configuracao.maxSwaps = v
    },
    ajuda: 'Contando a troca base → primeira cor.',
  }),
  controleNumero({
    rotulo: 'Folga (kerf)',
    min: 0.1,
    max: 0.8,
    passo: 0.05,
    valor: configuracao.kerf,
    formatar: (v) => `${v.toFixed(2)} mm`,
    aoMudar: (v) => {
      configuracao.kerf = v
    },
    ajuda: 'Folga de encaixe entre peças — calibre na sua impressora e filamento.',
  }),
  controleCheck({
    rotulo: 'Dither (difusão de erro)',
    valor: configuracao.dither,
    aoMudar: (v) => {
      configuracao.dither = v
    },
    ajuda: 'Ajuda quando a foto está dentro do que as cores escolhidas alcançam.',
  }),
  controleSelect({
    rotulo: 'Modo de troca',
    opcoes: [
      { valor: 'manual', rotulo: 'Manual (pausa para trocar o rolo)' },
      { valor: 'ams', rotulo: 'AMS (troca automática)' },
    ],
    valor: configuracao.swapMode,
    aoMudar: (v) => {
      configuracao.swapMode = v as Configuracao['swapMode']
    },
  }),
  controleSelect({
    rotulo: 'Impressora',
    opcoes: PRESETS,
    valor: configuracao.printerModel,
    aoMudar: (v) => {
      configuracao.printerModel = v
    },
    ajuda: 'O .3mf grava o modelo da máquina. Genérico usa o default do núcleo.',
  }),
)

const botaoGerar = cria('button', 'btn btn-primario btn-grande', 'Gerar quebra-cabeça')
const areaErro = cria('div', 'erro oculto')
painelImpressao.append(tituloImpressao, areaControles, botaoGerar, areaErro)

colEsquerda.append(painelFoto, painelFilamentos, painelImpressao)

// --- coluna direita: resultado ---

const areaAviso = cria('div', 'aviso oculto')
colDireita.append(areaAviso)

const painelPreviews = cria('section', 'painel previews')
const tituloPreviews = cria('h2', undefined, 'Resultado')
const bloco2d = cria('div', 'bloco-preview')
const titulo2d = cria('h3', undefined, 'Como fica impresso')
const canvas2d = cria('canvas')
canvas2d.id = 'preview-2d'
bloco2d.append(titulo2d, canvas2d)
const bloco3d = cria('div', 'bloco-preview')
const titulo3d = cria('h3', undefined, 'Modelo 3D')
const container3d = cria('div')
container3d.id = 'preview-3d'
bloco3d.append(titulo3d, container3d)
const vazio = cria('p', 'dica', 'Nada gerado ainda — a prévia aparece aqui.')
bloco3d.append(vazio)
painelPreviews.append(tituloPreviews, bloco2d, bloco3d)

const painelStats = cria('section', 'painel oculto')
const tituloStats = cria('h2', undefined, 'Estatísticas')
const areaStats = cria('div', 'stats')
painelStats.append(tituloStats, areaStats)

const painelDownloads = cria('section', 'painel oculto')
const tituloDownloads = cria('h2', undefined, 'Baixar')
const areaDownloads = cria('div', 'downloads')
painelDownloads.append(tituloDownloads, areaDownloads)

colDireita.append(painelPreviews, painelStats, painelDownloads)

// --- spinner ---

const spinner = cria('div', 'spinner oculto')
const anel = cria('div', 'anel')
const textoSpinner = cria('p', 'texto', 'Gerando…')
const botaoCancelar = cria('button', 'btn', 'Cancelar')
spinner.append(anel, textoSpinner, botaoCancelar)

// --- rodapé ---

const rodape = cria('footer', 'rodape', 'puzzle — open source, MIT. Foto e geração rodam 100% no navegador.')

layout.append(colEsquerda, colDireita)
app.append(cabecalho, layout, rodape, spinner)

// --------------------------------------------------------------- erros

const mostraErro = (mensagem: string): void => {
  areaErro.textContent = mensagem
  areaErro.classList.remove('oculto')
}

const limpaErro = (): void => {
  areaErro.classList.add('oculto')
}

// ---------------------------------------------------------- upload + crop

let painelCrop: { obterBitmap: () => Bitmap | null } | null = null

montarUpload({
  container: areaUpload,
  aoCarregar: (imagem) => {
    limpaErro()
    areaCrop.classList.remove('oculto')
    painelCrop = montarCrop(canvasCrop, imagem, (w, h) => {
      infoCrop.textContent = `${w} × ${h} px`
    })
    canvasCrop.scrollIntoView({ behavior: 'smooth', block: 'center' })
  },
  aoErro: mostraErro,
})

botaoAplicar.addEventListener('click', () => {
  const b = painelCrop?.obterBitmap()
  if (!b) return
  bitmap = b
  limpaErro()
  infoCrop.textContent = `Recorte aplicado: ${b.width} × ${b.height} px`
})

// ------------------------------------------------------------- filamentos

montarFilamentos({
  container: areaFilamentos,
  estado: filamentos,
  aoMudar: () => {
    atualizaGerar()
  },
})

// --------------------------------------------------------------- gerar

const atualizaGerar = (): void => {
  botaoGerar.disabled = gerando || !bitmap || filamentos.length === 0
  botaoGerar.title =
    !bitmap
      ? 'Sobe e recorta uma foto primeiro.'
      : filamentos.length === 0
        ? 'Escolha pelo menos um filamento.'
        : ''
}

const mostraSpinner = (progresso: Progresso | null): void => {
  spinner.classList.remove('oculto')
  textoSpinner.textContent = progresso ? `${progresso.etapa} — ${Math.round(progresso.pct * 100)}%` : 'Gerando…'
}

const escondeSpinner = (): void => {
  spinner.classList.add('oculto')
}

const gerar = async (): Promise<void> => {
  if (gerando) return
  if (!bitmap || filamentos.length === 0) return

  gerando = true
  cancelado = false
  limpaErro()
  atualizaGerar()
  mostraSpinner(null)

  const opts: GenerateOptions = {
    image: bitmap,
    filaments: filamentos,
    size: configuracao.size,
    pieceCount: configuracao.pieceCount,
    kerf: configuracao.kerf,
    layers: configuracao.layers,
    layerHeight: configuracao.layerHeight,
    baseThickness: configuracao.baseThickness,
    maxSwaps: configuracao.maxSwaps,
    dither: configuracao.dither,
    swapMode: configuracao.swapMode,
    printerModel: configuracao.printerModel || undefined,
  }

  try {
    const res = await gerarNoWorker(opts, mostraSpinner)
    resultado = res
    mostraResultado(res)
  } catch (e) {
    if (cancelado) {
      // cancelamento intencional — não é erro.
    } else {
      mostraErro(e instanceof Error ? e.message : 'erro desconhecido na geração')
    }
  } finally {
    gerando = false
    escondeSpinner()
    atualizaGerar()
  }
}

botaoGerar.addEventListener('click', () => {
  void gerar()
})

botaoCancelar.addEventListener('click', () => {
  cancelado = true
  cancelar()
})

// ------------------------------------------------------------ resultado

const stat = (rotulo: string, valor: string): HTMLElement => {
  const s = cria('div', 'stat')
  const v = cria('div', 'valor', valor)
  const r = cria('div', 'rotulo', rotulo)
  s.append(v, r)
  return s
}

const mostraResultado = (res: GenerateResult): void => {
  const s = res.stats

  // aviso de gama — as cores escolhidas não alcançam a foto
  if (s.paletteSpan < 40) {
    areaAviso.replaceChildren()
    const tituloAviso = cria('p', 'titulo', 'As cores escolhidas não alcançam essa foto.')
    const corpoAviso = cria(
      'p',
      undefined,
      `A paleta alcança ${s.paletteSpan.toFixed(0)} de ΔE — abaixo de 40 a foto sai enlameada. ` +
        'Aumente as camadas de cor ou escolha filamentos mais contrastantes.',
    )
    areaAviso.append(tituloAviso, corpoAviso)
    areaAviso.classList.remove('oculto')
  } else {
    areaAviso.classList.add('oculto')
  }

  // stats
  areaStats.replaceChildren(
    stat('Peças', `${s.pieces} (${s.cols}×${s.rows})`),
    stat('Tamanho', `${s.width}×${s.height} mm`),
    stat('Triângulos', s.triangles.toLocaleString('pt-BR')),
    stat('Malha', `${s.meshMB.toFixed(1)} MB`),
    stat('Trocas', `${s.swaps}`),
    stat('ΔE médio', s.deltaE.toFixed(1)),
    stat('Altura total', `${s.totalHeightMm.toFixed(2)} mm`),
    stat('Gama da paleta', s.paletteSpan.toFixed(0)),
  )
  painelStats.classList.remove('oculto')

  // downloads
  const base = `puzzle-${configuracao.size}mm-${configuracao.pieceCount}pecas`
  const itens: [string, Blob, string][] = [
    ['.3mf (projeto)', new Blob([res.threemf as Uint8Array<ArrayBuffer>], { type: 'model/3mf' }), `${base}.3mf`],
    ['.stl (reserva)', new Blob([res.stl as Uint8Array<ArrayBuffer>], { type: 'model/stl' }), `${base}.stl`],
    ['swaps.txt', new Blob([res.swaps], { type: 'text/plain;charset=utf-8' }), `${base}-trocas.txt`],
  ]
  areaDownloads.replaceChildren()
  for (const [rotulo, blob, nome] of itens) {
    const b = cria('button', 'btn', rotulo)
    b.addEventListener('click', () => baixar(blob, nome))
    areaDownloads.append(b)
  }
  painelDownloads.classList.remove('oculto')

  // preview 2D — a cor resolvida que vai sair impressa
  canvas2d.classList.remove('oculto')
  desenharPreview2D(canvas2d, res.preview)

  // preview 3D — recria o visualizador a cada resultado novo
  if (visualizador) {
    visualizador.destruir()
    visualizador = null
  }
  container3d.replaceChildren()
  visualizador = criarVisualizador3D(container3d)
  visualizador.mostrar(res.mesh)
  vazio.remove()

  painelPreviews.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

atualizaGerar()