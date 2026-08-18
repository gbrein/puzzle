import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lerBMP, lerImagem, lerPPM } from './ppm.ts'
import type { Bitmap } from '../color/types.ts'

/** Monta um PPM P6 binário a partir dos tokens do cabeçalho e dos bytes RGB crus. */
function ppm(cabecalho: string, rgb: number[]): Uint8Array {
  const h = new TextEncoder().encode(cabecalho)
  const out = new Uint8Array(h.length + rgb.length)
  out.set(h)
  out.set(rgb, h.length)
  return out
}

/** PPM 1×2 válido: (0,0)=vermelho, (1,0)=verde. */
function ppmSimples(): Uint8Array {
  return ppm('P6\n1 2\n255\n', [255, 0, 0, 0, 255, 0])
}

test('lerPPM lê um P6 válido: dimensões, RGBA e alfa opaco', () => {
  const b = lerPPM(ppmSimples())
  assert.equal(b.width, 1)
  assert.equal(b.height, 2)
  assert.equal(b.data.length, 1 * 2 * 4)
  assert.deepEqual([...b.data.slice(0, 4)], [255, 0, 0, 255], 'pixel 0 deve ser vermelho opaco')
  assert.deepEqual([...b.data.slice(4, 8)], [0, 255, 0, 255], 'pixel 1 deve ser verde opaco')
})

test('lerPPM aceita comentários "#" entre os tokens do cabeçalho', () => {
  const b = lerPPM(
    ppm('P6\n# foto de teste\n1 2 # largura altura\n255\n', [10, 20, 30, 40, 50, 60]),
  )
  assert.equal(b.width, 1)
  assert.equal(b.height, 2)
  assert.deepEqual([...b.data.slice(0, 3)], [10, 20, 30])
})

test('lerPPM devolve erro explícito em arquivo malformado, nunca lixo', () => {
  // sem o cabeçalho "P6"
  assert.throws(() => lerPPM(new Uint8Array([0x50, 0x33, 0x0a])), /P6/)
  // dimensões incoerentes
  assert.throws(() => lerPPM(ppm('P6\n0 2\n255\n', [1, 2, 3, 4, 5, 6])), /incoerentes/)
  // dados de pixel cortados (pede 2×2=4 px, só manda 2)
  assert.throws(() => lerPPM(ppm('P6\n2 2\n255\n', [1, 2, 3, 4, 5, 6])), /faltam/)
  // cabeçalho truncado
  assert.throws(() => lerPPM(new Uint8Array([0x50, 0x36, 0x0a, 0x31])), /truncado/)
  // maxval fora do 8 bits
  assert.throws(() => lerPPM(ppm('P6\n1 1\n256\n', [1, 2, 3])), /8 bits/)
})

test('lerBMP lê um BMP 24 bits bottom-up com alinhamento de linha e BGR→RGB', () => {
  // 2×2, linha de 2 px de 24 bits = 6 bytes → alinhada em 8 bytes.
  const largura = 2
  const altura = 2
  const bpl = 8
  const buf = Buffer.alloc(54 + bpl * altura)
  buf.write('BM', 0)
  buf.writeUInt32LE(54 + bpl * altura, 2)
  buf.writeUInt32LE(54, 10) // offset dos pixels
  buf.writeUInt32LE(40, 14) // BITMAPINFOHEADER
  buf.writeInt32LE(largura, 18)
  buf.writeInt32LE(altura, 22) // positivo = bottom-up
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30) // BI_RGB

  // bottom-up: a linha do TOPO fica por ÚLTIMO no arquivo.
  // y=1 (fundo do arquivo): (0,1)=azul (BGR FF 00 00), (1,1)=branco (FF FF FF)
  buf.set([0xff, 0x00, 0x00, 0xff, 0xff, 0xff], 54)
  // y=0 (topo, última no arquivo): (0,0)=vermelho (00 00 FF), (1,0)=verde (00 FF 00)
  buf.set([0x00, 0x00, 0xff, 0x00, 0xff, 0x00], 54 + bpl)

  const b = lerBMP(new Uint8Array(buf))
  const px = (x: number, y: number) => [b.data[(y * largura + x) * 4], b.data[(y * largura + x) * 4 + 1], b.data[(y * largura + x) * 4 + 2]]
  assert.equal(b.width, 2)
  assert.equal(b.height, 2)
  assert.deepEqual(px(0, 0), [255, 0, 0])
  assert.deepEqual(px(1, 0), [0, 255, 0])
  assert.deepEqual(px(0, 1), [0, 0, 255])
  assert.deepEqual(px(1, 1), [255, 255, 255])
})

test('lerBMP devolve erro explícito em formato fora do suportado', () => {
  const ok = (muda: (buf: Buffer) => void): Buffer => {
    const buf = Buffer.alloc(54 + 4 * 4)
    buf.write('BM', 0)
    buf.writeUInt32LE(54, 10)
    buf.writeUInt32LE(40, 14)
    buf.writeInt32LE(2, 18)
    buf.writeInt32LE(2, 22)
    buf.writeUInt16LE(1, 26)
    buf.writeUInt16LE(24, 28)
    buf.writeUInt32LE(0, 30)
    muda(buf)
    return buf
  }
  assert.throws(() => lerBMP(new Uint8Array(ok((b) => b.writeUInt16LE(32, 28)))), /32 bpp/, '32 bpp deve ser recusado')
  assert.throws(() => lerBMP(new Uint8Array(ok((b) => b.writeUInt32LE(3, 30)))), /compressão/, 'BI_PNG deve ser recusado')
  assert.throws(() => lerBMP(new Uint8Array(ok((b) => b.writeInt32LE(0, 18)))), /incoerentes/, 'largura 0 deve ser recusada')
  assert.throws(() => lerBMP(new Uint8Array([0x42, 0x4d, 0x00])), /curto/, 'arquivo curto deve ser recusado')
})

test('lerImagem despacha pelo cabeçalho e rejeita o que não reconhece', () => {
  const b = lerImagem(ppmSimples())
  assert.equal(b.width, 1)
  // um arquivo que não é P6 nem BM
  assert.throws(() => lerImagem(new TextEncoder().encode('hello world')), /não reconhecido/)
})

// pequena checagem de tipo para garantir que o contrato do Bitmap está certo
const _contrato: (b: Bitmap) => void = () => undefined
_contrato(lerPPM(ppmSimples()))
