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

  const exib =
    canvas.clientWidth > 0 && canvas.clientHeight > 0
      ? { w: canvas.clientWidth, h: canvas.clientHeight }
      : { w: width, h: height }
  canvas.width = exib.w
  canvas.height = exib.h
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(telaNat, 0, 0, exib.w, exib.h)
}