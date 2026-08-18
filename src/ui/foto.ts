import type { Bitmap } from '../color/types.ts'

/**
 * Upload com drag-and-drop + crop livre em canvas.
 *
 * `montarUpload` cria a zona de soltar/clickar e devolve a imagem decodificada
 * (`ImageBitmap`). `montarCrop` desenha a imagem num canvas e deixa a pessoa
 * arrastar um retângulo (alças nas bordas/cantos, arrastar o corpo move) — o
 * recorte final sai por `obterBitmap()` no formato `{ width, height, data }`,
 * igual ao `ImageData` que o núcleo espera. A reamostragem final é do núcleo.
 */

const MAX_LADO = 1600
const MIN_TAM = 24
const ALCANCE = 12

interface Retangulo {
  x: number
  y: number
  w: number
  h: number
}

type Alca = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'mover'

/** Monta a zona de upload dentro de `container`. */
export function montarUpload(opts: {
  container: HTMLElement
  aoCarregar: (imagem: ImageBitmap) => void
  aoErro: (mensagem: string) => void
}): void {
  const { container, aoCarregar, aoErro } = opts

  const zona = document.createElement('div')
  zona.className = 'dropzone'
  zona.tabIndex = 0
  zona.setAttribute('role', 'button')
  zona.setAttribute('aria-label', 'Escolhe uma foto para virar quebra-cabeça')

  const principal = document.createElement('p')
  principal.className = 'principal'
  principal.innerHTML = 'Arraste uma foto aqui ou <strong>clique para escolher</strong>'
  const dica = document.createElement('p')
  dica.className = 'dica'
  dica.textContent = 'PNG, JPG ou WebP. A foto não sai da sua máquina.'
  zona.append(principal, dica)

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'

  const abrir = (): void => input.click()

  zona.addEventListener('click', abrir)
  zona.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      abrir()
    }
  })

  const aoEntrar = (e: Event): void => {
    e.preventDefault()
    zona.classList.add('arrastando')
  }
  const aoSair = (e: Event): void => {
    e.preventDefault()
    zona.classList.remove('arrastando')
  }
  zona.addEventListener('dragenter', aoEntrar)
  zona.addEventListener('dragover', aoEntrar)
  zona.addEventListener('dragleave', aoSair)
  zona.addEventListener('drop', aoSair)

  input.addEventListener('change', () => {
    const arquivo = input.files?.[0]
    if (arquivo) void ler(arquivo)
    input.value = ''
  })

  zona.addEventListener('drop', (e) => {
    const arquivo = e.dataTransfer?.files?.[0]
    if (arquivo) void ler(arquivo)
  })

  const ler = async (arquivo: File): Promise<void> => {
    if (!arquivo.type.startsWith('image/')) {
      aoErro('Esse arquivo não parece ser uma imagem.')
      return
    }
    try {
      const imagem = await createImageBitmap(arquivo)
      if (imagem.width <= 0 || imagem.height <= 0) throw new Error('imagem vazia')
      aoCarregar(imagem)
    } catch {
      aoErro('Não consegui ler essa imagem. Tente um PNG, JPG ou WebP válido.')
    }
  }

  container.replaceChildren(zona, input)
}

/** Arma o crop livre sobre `imagem` no canvas. Devolve como extrair o recorte. */
export function montarCrop(
  canvas: HTMLCanvasElement,
  imagem: ImageBitmap,
  aoInfo?: (largura: number, altura: number) => void,
): { obterBitmap: () => Bitmap | null } {
  const escala = Math.min(1, MAX_LADO / Math.max(imagem.width, imagem.height))
  const largura = Math.max(1, Math.round(imagem.width * escala))
  const altura = Math.max(1, Math.round(imagem.height * escala))

  canvas.width = largura
  canvas.height = altura
  // Garante que o canvas NUNCA estoure o painel (ele tem até 1600px internos
  // dentro de um painel de ~300px). O `max-width` inline tem prioridade máxima
  // sobre qualquer regra de folha. As coordenadas do mouse são convertidas pela
  // razão getBoundingClientRect ↔ canvas.width/height (ver `paraCoordenadas`),
  // então o recorte segue o cursor mesmo com o canvas exibido menor que o
  // tamanho interno — e continua certo se a janela mudar de tamanho.
  canvas.style.maxWidth = '100%'
  canvas.style.height = 'auto'

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponível')

  // Base só com a imagem: o canvas visível recebe o overlay do recorte por cima.
  const base = document.createElement('canvas')
  base.width = largura
  base.height = altura
  base.getContext('2d')!.drawImage(imagem, 0, 0, largura, altura)

  let rect: Retangulo = { x: 0, y: 0, w: largura, h: altura }
  let arrastando: { alca: Alca; xi: number; yi: number; inicio: Retangulo } | null = null

  // Razão entre o tamanho interno do canvas e o exibido — as alças e o cursor
  // são medidos em PIXELS EXIBIDOS, então o raio de acerto escala junto.
  const raioDeAcerto = (): number => {
    const b = canvas.getBoundingClientRect()
    if (!b.width || b.height === 0) return ALCANCE
    return ALCANCE * (canvas.width / b.width)
  }

  const paraCoordenadas = (e: PointerEvent): { x: number; y: number } => {
    const b = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - b.left) / b.width) * canvas.width,
      y: ((e.clientY - b.top) / b.height) * canvas.height,
    }
  }

  const alcaEm = (x: number, y: number): Alca | null => {
    const r = raioDeAcerto()
    const perto = (px: number, py: number, cx: number, cy: number): boolean =>
      Math.abs(px - cx) <= r && Math.abs(py - cy) <= r
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    if (perto(x, y, rect.x, rect.y)) return 'nw'
    if (perto(x, y, rect.x + rect.w, rect.y)) return 'ne'
    if (perto(x, y, rect.x, rect.y + rect.h)) return 'sw'
    if (perto(x, y, rect.x + rect.w, rect.y + rect.h)) return 'se'
    if (perto(x, y, cx, rect.y)) return 'n'
    if (perto(x, y, rect.x + rect.w, cy)) return 'e'
    if (perto(x, y, cx, rect.y + rect.h)) return 's'
    if (perto(x, y, rect.x, cy)) return 'w'
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return 'mover'
    return null
  }

  const cursorDaAlca = (a: Alca): string => {
    const mapas: Record<Alca, string> = {
      nw: 'nwse-resize',
      se: 'nwse-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      mover: 'move',
    }
    return mapas[a]
  }

  const desenhar = (): void => {
    ctx.clearRect(0, 0, largura, altura)
    ctx.drawImage(base, 0, 0)

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 0, largura, rect.y)
    ctx.fillRect(0, rect.y + rect.h, largura, altura - rect.y - rect.h)
    ctx.fillRect(0, rect.y, rect.x, rect.h)
    ctx.fillRect(rect.x + rect.w, rect.y, largura - rect.x - rect.w, rect.h)

    ctx.strokeStyle = '#4f8cff'
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)

    ctx.fillStyle = '#ffffff'
    const marca = (x: number, y: number): void => {
      ctx.fillRect(x - 4, y - 4, 8, 8)
      ctx.strokeStyle = '#4f8cff'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 5, y - 5, 10, 10)
    }
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    marca(rect.x, rect.y)
    marca(rect.x + rect.w, rect.y)
    marca(rect.x, rect.y + rect.h)
    marca(rect.x + rect.w, rect.y + rect.h)
    marca(cx, rect.y)
    marca(rect.x + rect.w, cy)
    marca(cx, rect.y + rect.h)
    marca(rect.x, cy)
  }

  const redimensionar = (px: number, py: number): void => {
    const r0 = arrastando!.inicio
    const x = Math.min(Math.max(px, 0), largura)
    const y = Math.min(Math.max(py, 0), altura)
    let nx = r0.x
    let ny = r0.y
    let nw = r0.w
    let nh = r0.h

    switch (arrastando!.alca) {
      case 'nw':
        nx = Math.min(x, r0.x + r0.w - MIN_TAM)
        ny = Math.min(y, r0.y + r0.h - MIN_TAM)
        nw = r0.x + r0.w - nx
        nh = r0.y + r0.h - ny
        break
      case 'ne':
        ny = Math.min(y, r0.y + r0.h - MIN_TAM)
        nw = Math.max(x - r0.x, MIN_TAM)
        nh = r0.y + r0.h - ny
        break
      case 'sw':
        nx = Math.min(x, r0.x + r0.w - MIN_TAM)
        nw = r0.x + r0.w - nx
        nh = Math.max(y - r0.y, MIN_TAM)
        break
      case 'se':
        nw = Math.max(x - r0.x, MIN_TAM)
        nh = Math.max(y - r0.y, MIN_TAM)
        break
      case 'n':
        ny = Math.min(y, r0.y + r0.h - MIN_TAM)
        nh = r0.y + r0.h - ny
        break
      case 's':
        nh = Math.max(y - r0.y, MIN_TAM)
        break
      case 'e':
        nw = Math.max(x - r0.x, MIN_TAM)
        break
      case 'w':
        nx = Math.min(x, r0.x + r0.w - MIN_TAM)
        nw = r0.x + r0.w - nx
        break
      default:
        return
    }

    nx = Math.max(0, nx)
    ny = Math.max(0, ny)
    nw = Math.min(nw, largura - nx)
    nh = Math.min(nh, altura - ny)
    rect = { x: nx, y: ny, w: nw, h: nh }
  }

  const mover = (px: number, py: number): void => {
    const r0 = arrastando!.inicio
    const dx = px - arrastando!.xi
    const dy = py - arrastando!.yi
    rect = {
      x: Math.min(Math.max(r0.x + dx, 0), largura - r0.w),
      y: Math.min(Math.max(r0.y + dy, 0), altura - r0.h),
      w: r0.w,
      h: r0.h,
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = paraCoordenadas(e)
    const alca = alcaEm(p.x, p.y)
    if (!alca) return
    arrastando = { alca, xi: p.x, yi: p.y, inicio: { ...rect } }
    canvas.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  canvas.addEventListener('pointermove', (e) => {
    const p = paraCoordenadas(e)
    if (arrastando) {
      if (arrastando.alca === 'mover') mover(p.x, p.y)
      else redimensionar(p.x, p.y)
      desenhar()
      aoInfo?.(Math.round(rect.w), Math.round(rect.h))
      return
    }
    const a = alcaEm(p.x, p.y)
    canvas.style.cursor = a ? cursorDaAlca(a) : 'crosshair'
  })

  canvas.addEventListener('pointerup', (e) => {
    if (!arrastando) return
    arrastando = null
    canvas.releasePointerCapture(e.pointerId)
  })

  canvas.addEventListener('pointercancel', () => {
    arrastando = null
  })

  const obterBitmap = (): Bitmap | null => {
    const w = Math.max(1, Math.round(rect.w))
    const h = Math.max(1, Math.round(rect.h))
    const alvo = document.createElement('canvas')
    alvo.width = w
    alvo.height = h
    alvo
      .getContext('2d')!
      .drawImage(base, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h)
    const dados = alvo.getContext('2d')!.getImageData(0, 0, w, h)
    return { width: w, height: h, data: dados.data }
  }

  desenhar()
  aoInfo?.(Math.round(rect.w), Math.round(rect.h))
  return { obterBitmap }
}

/**
 * Desenha o `bitmap` recortado num canvas pequeno — a miniatura que substitui o
 * canvas de recorte depois de aplicado. O `putImageData` não redimensiona, então
 * passa por uma tela intermediária em resolução cheia e reamostra com `drawImage`.
 */
export function desenharMiniatura(canvas: HTMLCanvasElement, bitmap: Bitmap, maxLado = 200): void {
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * escala))
  const h = Math.max(1, Math.round(bitmap.height * escala))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponível')
  const tela = document.createElement('canvas')
  tela.width = bitmap.width
  tela.height = bitmap.height
  tela
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height), 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(tela, 0, 0, w, h)
}