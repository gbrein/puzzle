import type { Bitmap, Filament } from '../color/types.ts'
import type { GenerateOptions, GenerateResult } from '../generate.ts'
import { desenharPreview2D } from '../preview/preview2d.ts'
import { criarVisualizador3D, type Visualizador3D } from '../preview/preview3d.ts'
import { cancelar, gerarNoWorker, type Progresso } from '../worker/client.ts'
import { montarFilamentos } from './filamentos.ts'
import { montarPaleta } from './paleta.ts'
import { desenharMiniatura, montarCrop, montarUpload } from './foto.ts'
import {
  consequenciaDoNivel,
  NIVEIS_DIFICULDADE,
  pecasDoNivel,
  tetoDePecas,
  type NivelDificuldade,
} from './dificuldade.ts'
import type { PedidoPreview, RespostaPreview } from './preview.worker.ts'

/**
 * Seed único da sessão, passado EXPLICITAMENTE tanto pro preview quanto pra
 * geração. Deixar os dois caírem no default do núcleo funciona por acidente:
 * no dia em que a interface expuser o seed, a prévia mostraria um cronograma e
 * a peça sairia com outro.
 */
const SEED = 1

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
  extrusionWidth: number
  swapMode: 'manual' | 'ams'
  printerModel: string
}

const configuracao: Configuracao = {
  size: 180,
  pieceCount: 20,
  // 50 × 0,08 = os mesmos 4mm de relevo que 25 × 0,16, com o DOBRO de níveis de
  // tom. 0,08mm é o piso físico com bico de 0,4mm — ver a medição no generate.ts.
  layers: 50,
  layerHeight: 0.08,
  baseThickness: 2.4,
  maxSwaps: 3,
  kerf: 0.4,
  dither: false,
  extrusionWidth: 0.42,
  // default AMS (decisão do Guilherme): a prévia do slicer sai colorida. O modo
  // manual continua disponível no avançado, para P1S sem AMS.
  swapMode: 'ams',
  printerModel: '',
}

const filamentos: Filament[] = []
let bitmap: Bitmap | null = null
let resultado: GenerateResult | null = null
let gerando = false
let cancelado = false
let visualizador: Visualizador3D | null = null

// Preview ao vivo (caminho de cor no worker) — ver o bloco "preview ao vivo".
let temporizadorPreview: number | null = null
let previewWorker: Worker | null = null
let proximoIdPreview = 0
let ultimaPreview: Bitmap | null = null
let nivelSelecionado: NivelDificuldade | null = NIVEIS_DIFICULDADE[1]

// ------------------------------------------------------------ controles

interface ControleNumero {
  campo: HTMLElement
  input: HTMLInputElement
  valor: HTMLSpanElement
  formatar: (v: number) => string
}

const controleNumero = (opts: {
  rotulo: string
  min: number
  max: number
  passo: number
  valor: number
  formatar: (v: number) => string
  aoMudar: (v: number) => void
  ajuda?: string
}): ControleNumero => {
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
  return { campo, input, valor, formatar: opts.formatar }
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
const subtitulo = cria('p', undefined, 'Sobe uma foto, escolhe os rolos, vê a cor resolvida ao vivo e baixa um .3mf de projeto com as trocas de cor embutidas. Tudo no seu navegador.')
cabecalho.append(titulo, subtitulo)

const layout = cria('main', 'layout')
const colEsquerda = cria('aside', 'coluna')
const colDireita = cria('section', 'coluna coluna-preview')

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

// Depois de aplicar, a foto vira miniatura — o canvas grande só aparece enquanto
// se recorta, senão empurra cores e controles para baixo da dobra.
const areaMiniatura = cria('div', 'miniatura oculto')
const canvasMiniatura = cria('canvas')
const infoMiniatura = cria('span', 'info')
const botaoAjustar = cria('button', 'btn', 'Ajustar recorte')
const botaoTrocarFoto = cria('button', 'btn', 'Trocar foto')
const linhaMiniatura = cria('div', 'linha-miniatura')
linhaMiniatura.append(infoMiniatura, botaoAjustar, botaoTrocarFoto)
areaMiniatura.append(canvasMiniatura, linhaMiniatura)

painelFoto.append(tituloFoto, areaUpload, areaCrop, areaMiniatura)

// --- coluna esquerda: cores ---

const painelCores = cria('section', 'painel')
const tituloCores = cria('h2')
tituloCores.innerHTML = '<span class="passo">2.</span> Cores'
const dicaCores = cria('p', 'dica', 'Escolha os rolos na ordem em que quer que entrem no cronograma. O primeiro vira a base da peça. A prévia da cor ao lado atualiza sozinha.')
const areaFilamentos = cria('div')
const areaPaleta = cria('div', 'area-paleta')
painelCores.append(tituloCores, dicaCores, areaFilamentos, areaPaleta)

// --- coluna esquerda: tamanho + dificuldade ---

const painelDificuldade = cria('section', 'painel')
const tituloDificuldade = cria('h2')
tituloDificuldade.innerHTML = '<span class="passo">3.</span> Tamanho e dificuldade'

const TAMANHOS = [100, 140, 180, 210, 250]
const tamanhoPlaca = controleSelect({
  rotulo: 'Tamanho da placa',
  opcoes: TAMANHOS.map((t) => ({ valor: String(t), rotulo: `${t} mm` })),
  valor: String(configuracao.size),
  aoMudar: (v) => {
    configuracao.size = Number(v)
    // tamanho NÃO muda o resultado de cor — nada a recalcular no preview
    atualizaDificuldade()
    atualizaLimitesSliderPecas()
  },
  ajuda: 'Maior dimensão da placa (100/140/180/210/250 mm). A dificuldade recalcula a contagem de peças para caber.',
})

const niveis = cria('div', 'niveis')
const botaoNivel: HTMLButtonElement[] = []
for (const nivel of NIVEIS_DIFICULDADE) {
  const b = cria('button', 'nivel', nivel.nome)
  b.type = 'button'
  b.dataset.id = nivel.id
  b.title = nivel.dica
  b.addEventListener('click', () => selecionarNivel(nivel))
  botaoNivel.push(b)
  niveis.append(b)
}
const consequencia = cria('p', 'consequencia')
const dicaNivel = cria('p', 'dica-nivel')
const avisoInsano = cria('p', 'aviso-dificuldade oculto')
const areaDificuldade = cria('div', 'dificuldade')
areaDificuldade.append(niveis, consequencia, dicaNivel, avisoInsano)
painelDificuldade.append(tituloDificuldade, tamanhoPlaca, areaDificuldade)

// --- coluna esquerda: avançado (recolhido) ---

const painelAvancado = cria('details', 'avancado')
const sumarioAvancado = cria('summary', undefined, 'Avançado — camadas, kerf e impressora')
const areaAvancado = cria('div', 'controles')
painelAvancado.append(sumarioAvancado, areaAvancado)

const ALTURAS_CAMADA = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]
const PRESETS = [
  { valor: '', rotulo: 'Genérico (bico 0,4 mm)' },
  { valor: 'Bambu Lab X1 Carbon', rotulo: 'Bambu Lab X1 Carbon (X1C)' },
  { valor: 'Bambu Lab P1S', rotulo: 'Bambu Lab P1S' },
  { valor: 'Bambu Lab A1', rotulo: 'Bambu Lab A1' },
]

// o slider cru de peças — o teto é calculado do lado mínimo da peça, que vem
// da largura de extrusão (pescoço da aba precisa de ~2,5 filetes para não quebrar)
const sliderPecas = controleNumero({
  rotulo: 'Peças (contagem crua)',
  min: 1,
  max: 120,
  passo: 1,
  valor: configuracao.pieceCount,
  formatar: (v) => `${v} peças`,
  aoMudar: (v) => {
    configuracao.pieceCount = v
    // quem usa o slider tomou o controle do nível de dificuldade
    nivelSelecionado = null
    atualizaDificuldade()
  },
  ajuda: 'Teto calculado do lado mínimo seguro da peça (pescoço da aba precisa de ~2,5 filetes de extrusão).',
})

const controlesAvancados = [
  sliderPecas.campo,
  controleNumero({
    rotulo: 'Altura de camada',
    min: 0.08,
    max: 0.28,
    passo: 0.02,
    valor: configuracao.layerHeight,
    formatar: (v) => `${v.toFixed(2).replace('.', ',')} mm`,
    aoMudar: (v) => {
      configuracao.layerHeight = v
      agendarPreview()
    },
  }).campo,
  controleNumero({
    rotulo: 'Espessura da base',
    min: 0.8,
    max: 6,
    passo: 0.2,
    valor: configuracao.baseThickness,
    formatar: (v) => `${v.toFixed(1)} mm`,
    aoMudar: (v) => {
      configuracao.baseThickness = v
      agendarPreview()
    },
    ajuda: 'Vira um número inteiro de camadas.',
  }).campo,
  controleNumero({
    rotulo: 'Camadas de cor',
    min: 1,
    // 120 e não 60: o que importa é a ESPESSURA de cor, e ela é camadas ×
    // altura. Com 60 de teto, quem baixa a camada para 0,04mm fica preso em
    // 2,4mm — abaixo dos 4mm onde o erro para de cair.
    max: 120,
    passo: 1,
    valor: configuracao.layers,
    // Mostra os mm junto: é a espessura que decide se a cor acontece, e é ela
    // que a pessoa sente na mão como relevo. "50 camadas" sozinho não diz nada.
    formatar: (v) => `${v} camadas · ${(v * configuracao.layerHeight).toFixed(2).replace('.', ',')} mm de cor`,
    aoMudar: (v) => {
      configuracao.layers = v
      agendarPreview()
    },
    ajuda: 'Mais camadas = mais tons, print mais alto. É o que mais muda a cor.',
  }).campo,
  controleNumero({
    rotulo: 'Trocas máximas',
    min: 1,
    max: 8,
    passo: 1,
    valor: configuracao.maxSwaps,
    formatar: (v) => `${v}`,
    aoMudar: (v) => {
      configuracao.maxSwaps = v
      agendarPreview()
    },
    ajuda: 'Contando a troca base → primeira cor.',
  }).campo,
  controleNumero({
    rotulo: 'Folga (kerf)',
    min: 0.1,
    max: 0.8,
    passo: 0.05,
    valor: configuracao.kerf,
    formatar: (v) => `${v.toFixed(2)} mm`,
    aoMudar: (v) => {
      configuracao.kerf = v
      // kerf é geometria — não muda a cor, então o preview ao vivo não recalcula
    },
    ajuda: 'Folga de encaixe entre peças — calibre uma vez na sua impressora e filamento.',
  }).campo,
  controleNumero({
    rotulo: 'Largura de extrusão',
    min: 0.3,
    max: 0.6,
    passo: 0.02,
    valor: configuracao.extrusionWidth,
    formatar: (v) => `${v.toFixed(2)} mm`,
    aoMudar: (v) => {
      configuracao.extrusionWidth = v
      // muda a célula do relevo (resolução do preview) e o teto de peças
      atualizaLimitesSliderPecas()
      agendarPreview()
    },
    ajuda: 'Bico da impressora. É o piso da resolução e define o teto de peças.',
  }).campo,
  controleCheck({
    rotulo: 'Dither (difusão de erro)',
    valor: configuracao.dither,
    aoMudar: (v) => {
      configuracao.dither = v
      agendarPreview()
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
]
areaAvancado.append(...controlesAvancados)

const botaoGerar = cria('button', 'btn btn-primario btn-grande', 'Gerar geometria e .3mf')
const areaErro = cria('div', 'erro oculto')

colEsquerda.append(painelFoto, painelCores, painelDificuldade, painelAvancado, botaoGerar, areaErro)

// --- coluna direita: preview protagonista (sticky) ---

const areaAviso = cria('div', 'aviso oculto')

const painelPreview = cria('section', 'painel painel-preview')
const tituloPreview = cria('h2', undefined, 'Prévia')
const abasPreview = cria('div', 'abas-preview')
const aba2d = cria('button', 'aba ativa', 'Cor (2D)')
const aba3d = cria('button', 'aba', 'Modelo (3D)')
abasPreview.append(aba2d, aba3d)

const bloco2d = cria('div', 'bloco-preview')
const canvas2d = cria('canvas')
canvas2d.id = 'preview-2d'
canvas2d.classList.add('oculto')
const estadoVazio2d = cria('div', 'estado-vazio')
bloco2d.append(canvas2d, estadoVazio2d)

const bloco3d = cria('div', 'bloco-preview oculto')
const container3d = cria('div')
container3d.id = 'preview-3d'
container3d.classList.add('oculto')
const estadoVazio3d = cria(
  'div',
  'estado-vazio',
  'O modelo 3D das peças aparece aqui depois de gerar — mostra a geometria, não a cor.',
)
bloco3d.append(container3d, estadoVazio3d)

const statusCor = cria('p', 'status-cor')
painelPreview.append(tituloPreview, abasPreview, bloco2d, bloco3d, statusCor)

// Stats recolhidas: uma linha com o essencial, o resto atrás de "detalhes" —
// a prévia é o produto e não pode perder área para os números.
const painelStats = cria('section', 'painel resumo-painel oculto')
const resumoLinha = cria('p', 'resumo-linha')
const detalhesStats = cria('details', 'detalhes-stats')
const sumarioStats = cria('summary', undefined, 'Detalhes')
const areaStats = cria('div', 'stats')
detalhesStats.append(sumarioStats, areaStats)
painelStats.append(resumoLinha, detalhesStats)

const painelDownloads = cria('section', 'painel oculto')
const tituloDownloads = cria('h2', undefined, 'Baixar')
const areaDownloads = cria('div', 'downloads')
painelDownloads.append(tituloDownloads, areaDownloads)

colDireita.append(painelPreview, areaAviso, painelStats, painelDownloads)

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
    // foto existe — a dropzone sai do caminho e o recorte grande abre
    areaUpload.classList.add('oculto')
    areaMiniatura.classList.add('oculto')
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
  // recorte fechado: vira miniatura, o canvas grande some
  areaCrop.classList.add('oculto')
  areaMiniatura.classList.remove('oculto')
  desenharMiniatura(canvasMiniatura, b)
  infoMiniatura.textContent = `${b.width} × ${b.height} px`
  // foto nova muda o alvo do preview — recalcula o caminho de cor
  atualizaDificuldade()
  atualizaLimitesSliderPecas()
  atualizaEstadoVazio()
  agendarPreview()
  atualizaGerar()
})

botaoAjustar.addEventListener('click', () => {
  // reabre o recorte no mesmo canvas, com o último retângulo intacto
  areaMiniatura.classList.add('oculto')
  areaCrop.classList.remove('oculto')
  canvasCrop.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

botaoTrocarFoto.addEventListener('click', () => {
  areaMiniatura.classList.add('oculto')
  areaCrop.classList.add('oculto')
  areaUpload.classList.remove('oculto')
  previewWorker?.terminate()
  previewWorker = null
  if (temporizadorPreview !== null) {
    window.clearTimeout(temporizadorPreview)
    temporizadorPreview = null
  }
  bitmap = null
  resultado = null
  ultimaPreview = null
  painelStats.classList.add('oculto')
  painelDownloads.classList.add('oculto')
  areaAviso.classList.add('oculto')
  atualizaEstadoVazio()
  atualizaGerar()
})

// ------------------------------------------------------------- filamentos

montarFilamentos({
  container: areaFilamentos,
  estado: filamentos,
  aoMudar: () => {
    atualizaGerar()
    atualizaEstadoVazio()
    // filamento é o que mais muda a cor — recálculo ao vivo, com debounce
    agendarPreview()
  },
})

// ------------------------------------------------------ preview ao vivo

/**
 * Preview 2D ao vivo, medido (ver docs/plano-ui.md §medições):
 * - `solveHeights` + `renderHeightMap` custam 7 ms;
 * - `searchSchedule` custa 621 ms — por isso roda no worker, com debounce.
 *
 * Tamanho, peças e kerf NÃO mexem no resultado de cor — mexer neles não
 * recalcula nada. Filamentos, camadas e base disparam o recálculo.
 */
/**
 * A paleta e a gama saem de `buildPalette`, que custa 0 ms — então elas
 * atualizam na hora, fora do debounce que segura o preview (esse sim paga os
 * ~621 ms do `searchSchedule`). É o ponto da interface em que a pessoa descobre
 * que as cores escolhidas não alcançam a foto **antes** de gerar, e não depois.
 */
const atualizaPaleta = (): void => {
  montarPaleta(areaPaleta, filamentos, {
    layers: configuracao.layers,
    layerHeight: configuracao.layerHeight,
    baseLayers: Math.max(1, Math.round(configuracao.baseThickness / configuracao.layerHeight)),
  })
}

const agendarPreview = (): void => {
  atualizaPaleta()
  if (temporizadorPreview !== null) window.clearTimeout(temporizadorPreview)
  temporizadorPreview = window.setTimeout(() => {
    temporizadorPreview = null
    rodarPreview()
  }, 250)
}

const rodarPreview = (): void => {
  if (!bitmap || filamentos.length === 0) return
  previewWorker?.terminate()
  const id = ++proximoIdPreview
  const worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
  previewWorker = worker
  statusCor.textContent = 'atualizando cor…'

  worker.onmessage = (e: MessageEvent<RespostaPreview>) => {
    if (e.data.id !== id) return
    previewWorker = null
    worker.terminate()
    statusCor.textContent = ''
    if (e.data.tipo === 'resultado') {
      ultimaPreview = e.data.preview
      desenhaPreview2d(ultimaPreview)
    }
  }
  worker.onerror = () => {
    previewWorker = null
    worker.terminate()
    statusCor.textContent = ''
  }

  const pedido: PedidoPreview = {
    tipo: 'preview',
    id,
    image: bitmap,
    filaments: filamentos,
    size: configuracao.size,
    layers: configuracao.layers,
    layerHeight: configuracao.layerHeight,
    baseThickness: configuracao.baseThickness,
    maxSwaps: configuracao.maxSwaps,
    dither: configuracao.dither,
    extrusionWidth: configuracao.extrusionWidth,
    // o mesmo seed da geração, senão a prévia mostraria um cronograma e a peça
    // sairia com outro
    seed: SEED,
  }
  worker.postMessage(pedido)
}

const desenhaPreview2d = (preview: Bitmap): void => {
  desenharPreview2D(canvas2d, preview)
  canvas2d.classList.remove('oculto')
  estadoVazio2d.classList.add('oculto')
}

const atualizaEstadoVazio = (): void => {
  if (ultimaPreview) return
  if (!bitmap) {
    estadoVazio2d.innerHTML =
      'A prévia da cor resolvida aparece aqui ao vivo, conforme você escolhe os rolos. <strong>Suba e recorte uma foto</strong> para começar.'
  } else if (filamentos.length === 0) {
    estadoVazio2d.innerHTML =
      'Foto pronta. <strong>Escolha pelo menos um filamento</strong> para a cor da prévia aparecer.'
  } else {
    estadoVazio2d.innerHTML = '<strong>Gerando a prévia…</strong>'
  }
  canvas2d.classList.add('oculto')
  estadoVazio2d.classList.remove('oculto')
}

// alternância 2D/3D no mesmo quadro — a cor (2D) é o default
const trocarAba = (aba: '2d' | '3d'): void => {
  aba2d.classList.toggle('ativa', aba === '2d')
  aba3d.classList.toggle('ativa', aba === '3d')
  bloco2d.classList.toggle('oculto', aba !== '2d')
  bloco3d.classList.toggle('oculto', aba !== '3d')
  if (aba === '2d' && ultimaPreview) desenhaPreview2d(ultimaPreview)
  if (aba === '3d') visualizador?.redimensionar()
}
aba2d.addEventListener('click', () => trocarAba('2d'))
aba3d.addEventListener('click', () => trocarAba('3d'))

// ------------------------------------------------- dificuldade e peças

const dimensoesPlaca = (): { largura: number; altura: number } | null => {
  if (!bitmap) return null
  const aspect = bitmap.width / bitmap.height
  return aspect >= 1
    ? { largura: configuracao.size, altura: configuracao.size / aspect }
    : { largura: configuracao.size * aspect, altura: configuracao.size }
}

const selecionarNivel = (nivel: NivelDificuldade): void => {
  nivelSelecionado = nivel
  // dificuldade é geometria — mexe no nº de peças, não na cor: sem recálculo
  atualizaDificuldade()
  atualizaLimitesSliderPecas()
}

const atualizaDificuldade = (): void => {
  for (const b of botaoNivel) b.classList.toggle('ativo', b.dataset.id === nivelSelecionado?.id)

  const dims = dimensoesPlaca()
  if (!dims) {
    consequencia.textContent = 'Suba e recorte uma foto para ver a contagem de peças.'
    dicaNivel.textContent = nivelSelecionado?.dica ?? ''
  } else if (nivelSelecionado) {
    configuracao.pieceCount = pecasDoNivel(nivelSelecionado, dims.largura, dims.altura)
    consequencia.textContent = consequenciaDoNivel(nivelSelecionado, dims.largura, dims.altura)
    dicaNivel.textContent = nivelSelecionado.dica
  } else {
    consequencia.textContent = `${configuracao.pieceCount} peças — contagem manual (slider no avançado)`
    dicaNivel.textContent = ''
  }

  // sincroniza o valor mostrado no slider avançado com o que a dificuldade decidiu
  sliderPecas.input.value = String(configuracao.pieceCount)
  sliderPecas.valor.textContent = sliderPecas.formatar(configuracao.pieceCount)

  // aviso específico do nível Insano (peça frágil, kerf calibrado)
  const aviso = nivelSelecionado?.id === 'insano' ? nivelSelecionado.aviso : undefined
  if (aviso) {
    avisoInsano.textContent = aviso
    avisoInsano.classList.remove('oculto')
  } else {
    avisoInsano.classList.add('oculto')
  }
}

const atualizaLimitesSliderPecas = (): void => {
  const dims = dimensoesPlaca()
  if (!dims) return
  const teto = tetoDePecas(dims.largura, dims.altura, configuracao.extrusionWidth)
  sliderPecas.input.max = String(teto)
  if (configuracao.pieceCount > teto) {
    configuracao.pieceCount = teto
    sliderPecas.input.value = String(teto)
    sliderPecas.valor.textContent = sliderPecas.formatar(teto)
  }
}

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
  // pct já vem em 0..100 (etapa grossa do worker)
  textoSpinner.textContent = progresso ? `${progresso.etapa} — ${Math.round(progresso.pct)}%` : 'Gerando…'
}

const escondeSpinner = (): void => {
  spinner.classList.add('oculto')
}

/** Só geometria + .3mf — a cor já está no preview ao vivo. */
const gerar = async (): Promise<void> => {
  if (gerando) return
  if (!bitmap || filamentos.length === 0) return

  // o resultado completo é a verdade — descarta preview ao vivo pendente
  if (temporizadorPreview !== null) {
    window.clearTimeout(temporizadorPreview)
    temporizadorPreview = null
  }
  previewWorker?.terminate()
  previewWorker = null

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
    extrusionWidth: configuracao.extrusionWidth,
    seed: SEED,
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

  // stats — placas e gramas vêm da lane C; só mostram quando a geração devolver
  const extras = s as typeof s & { plates?: number; grams?: number }
  const resumo: string[] = [
    `${s.pieces} peças (${s.cols}×${s.rows})`,
    `${s.width}×${s.height} mm`,
    `${s.swaps} trocas`,
    `ΔE ${s.deltaE.toFixed(1)}`,
    `gama ${s.paletteSpan.toFixed(0)}`,
    `${s.meshMB.toFixed(1)} MB`,
  ]
  if (extras.plates !== undefined) {
    resumo.push(`${extras.plates} ${extras.plates === 1 ? 'placa' : 'placas'}`)
  }
  if (extras.grams !== undefined) resumo.push(`${extras.grams.toFixed(0)} g`)
  resumoLinha.textContent = resumo.join(' · ')

  const itens = [
    stat('Peças', `${s.pieces} (${s.cols}×${s.rows})`),
    stat('Tamanho', `${s.width}×${s.height} mm`),
    stat('Triângulos', s.triangles.toLocaleString('pt-BR')),
    stat('Malha', `${s.meshMB.toFixed(1)} MB`),
    stat('Trocas', `${s.swaps}`),
    stat('ΔE médio', s.deltaE.toFixed(1)),
    stat('Altura total', `${s.totalHeightMm.toFixed(2)} mm`),
    stat('Gama da paleta', s.paletteSpan.toFixed(0)),
  ]
  if (extras.plates !== undefined) itens.push(stat('Placas', `${extras.plates}`))
  if (extras.grams !== undefined) itens.push(stat('Peso estimado', `${extras.grams.toFixed(0)} g`))
  areaStats.replaceChildren(...itens)
  painelStats.classList.remove('oculto')

  // downloads
  const base = `puzzle-${configuracao.size}mm-${configuracao.pieceCount}pecas`
  const itensDownload: [string, Blob, string][] = [
    ['.3mf (projeto)', new Blob([res.threemf as Uint8Array<ArrayBuffer>], { type: 'model/3mf' }), `${base}.3mf`],
    ['.stl (reserva)', new Blob([res.stl as Uint8Array<ArrayBuffer>], { type: 'model/stl' }), `${base}.stl`],
    ['swaps.txt', new Blob([res.swaps], { type: 'text/plain;charset=utf-8' }), `${base}-trocas.txt`],
  ]
  areaDownloads.replaceChildren()
  for (const [rotulo, blob, nome] of itensDownload) {
    const b = cria('button', 'btn', rotulo)
    b.addEventListener('click', () => baixar(blob, nome))
    areaDownloads.append(b)
  }
  painelDownloads.classList.remove('oculto')

  // preview 2D — a cor resolvida que vai sair impressa (mesma do ao vivo)
  ultimaPreview = res.preview
  desenhaPreview2d(res.preview)

  // preview 3D — recria o visualizador a cada resultado novo
  if (visualizador) {
    visualizador.destruir()
    visualizador = null
  }
  container3d.replaceChildren()
  container3d.classList.remove('oculto')
  estadoVazio3d.classList.add('oculto')
  visualizador = criarVisualizador3D(container3d)
  // Com a paleta, o 3D deixa de ser um bloco cinza: a cor de cada vértice sai da
  // altura dele, então visto de cima o modelo reproduz o preview 2D. Sem isso
  // não dá para julgar se a foto ficou boa — só se a geometria fechou.
  visualizador.mostrar(res.mesh, {
    palette: res.palette,
    baseZ: res.plan.baseLayers * res.plan.layerHeight,
    layerHeight: res.plan.layerHeight,
  })
}

// ------------------------------------------------------------- bootstrap

atualizaGerar()
atualizaEstadoVazio()
atualizaDificuldade()
atualizaLimitesSliderPecas()
atualizaPaleta()