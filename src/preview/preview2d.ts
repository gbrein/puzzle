import type { Bitmap } from '../color/types.ts'

/**
 * Desenha o `preview` — a cor resolvida que vai sair impressa — no canvas,
 * reamostrando por vizinho mais próximo.
 *
 * Interpolar (bilinear) aqui MENTE: o preview é uma cor por célula do relevo, e
 * borrar as células sugere tons que a impressora não produz. O tamanho exibido
 * é o do canvas no layout (clientWidth/Height) — quem controla o aspecto é o
 * CSS da UI; se o canvas ainda não tiver layout, cai no tamanho nativo.
 */
export function desenharPreview2D(canvas: HTMLCanvasElement, preview: Bitmap): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d indisponível')
  const { width, height, data } = preview
  if (width <= 0 || height <= 0) return

  // `new ImageData` copia os bytes (não depende de o array virar a posição 0);
  // a cópia explícita também resolve o tipo: `data` é `Uint8ClampedArray` de
  // um buffer genérico, e o construtor do ImageData exige um ArrayBuffer próprio.
  // A tela intermediária é o que permite reamostrar por nearest com drawImage.
  const telaNat = document.createElement('canvas')
  telaNat.width = width
  telaNat.height = height
  telaNat
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)

  // O buffer do canvas vai em pixels de DISPOSITIVO, não em pixels CSS. Sem o
  // devicePixelRatio o navegador recebe um buffer menor que a área pintada e
  // interpola para cobrir — que é justamente o borrão que estamos evitando.
  const dpr = window.devicePixelRatio || 1
  const caixaW = canvas.clientWidth > 0 ? canvas.clientWidth : width
  const caixaH = canvas.clientHeight > 0 ? canvas.clientHeight : height
  canvas.width = Math.max(1, Math.round(caixaW * dpr))
  canvas.height = Math.max(1, Math.round(caixaH * dpr))

  // Encaixa PRESERVANDO A PROPORÇÃO. Esticar para preencher a caixa deformava a
  // peça: a caixa da prévia é quase quadrada e a placa é 4:3, então o
  // quebra-cabeça aparecia 38% mais alto do que vai sair impresso.
  const escala = Math.min(canvas.width / width, canvas.height / height)
  const w = Math.round(width * escala)
  const h = Math.round(height * escala)
  const x = Math.round((canvas.width - w) / 2)
  const y = Math.round((canvas.height - h) / 2)

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(telaNat, x, y, w, h)
}