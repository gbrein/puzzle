import type { Bitmap } from '../color/types.ts'

/**
 * Leitor de imagens para as FIXTURES de teste — PPM binário (P6) e BMP 24 bits
 * sem compressão.
 *
 * Por que estes dois e não JPEG: o Node não decodifica JPEG e não queremos
 * dependência nova — esses dois formatos são triviais (cabeçalho curto + pixels
 * crus), sem decoder nenhum. Servem para os testes carregarem uma FOTO de
 * verdade (em vez de só gradientes sintéticos), que foi onde os piores defeitos
 * da semana apareceram.
 *
 * Os dois devolvem o `Bitmap { width, height, data }` (RGBA) que o resto do
 * projeto usa. Arquivo malformado lança `Error` explícito — nunca devolve lixo.
 */

// ---------------------------------------------------------------- utilitários

const ehEspaco = (b: number): boolean => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d

const erro = (msg: string): Error => new Error(`imagem inválida: ${msg}`)

// ------------------------------------------------------------------ PPM (P6)

/**
 * Lê PPM binário (P6), máximo 255 por canal.
 *
 * Cabeçalho: "P6", depois os tokens `largura altura maxval` separados por
 * espaço/branco, com comentários `#...` permitidos entre tokens; um único byte
 * de branco após o `maxval`; então `largura×altura×3` bytes RGB crus.
 */
export function lerPPM(bytes: Uint8Array): Bitmap {
  if (bytes.length < 3) throw erro('PPM: arquivo curto demais')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x36) throw erro('PPM: falta o cabeçalho "P6"')

  let i = 2

  // tokenizador do cabeçalho: pula espaços e comentários `#...até\n`, lê um int.
  const token = (): number => {
    for (;;) {
      if (i >= bytes.length) throw erro('PPM: cabeçalho truncado')
      if (ehEspaco(bytes[i])) {
        i++
        continue
      }
      if (bytes[i] === 0x23) {
        // '#': pula até o fim da linha
        while (i < bytes.length && bytes[i] !== 0x0a) i++
        continue
      }
      break
    }
    let num = 0
    let tem = false
    while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39) {
      num = num * 10 + (bytes[i] - 0x30)
      tem = true
      i++
    }
    if (!tem) throw erro('PPM: esperava um número no cabeçalho')
    return num
  }

  const largura = token()
  const altura = token()
  const maxval = token()

  if (!Number.isInteger(largura) || !Number.isInteger(altura) || largura <= 0 || altura <= 0) {
    throw erro(`PPM: dimensões incoerentes ${largura}×${altura}`)
  }
  if (maxval < 1 || maxval > 255) {
    throw erro(`PPM: maxval ${maxval} — suporto só 8 bits (1..255)`)
  }

  // após o maxval vem exatamente UM byte de branco antes dos pixels
  if (i >= bytes.length || !ehEspaco(bytes[i])) throw erro('PPM: falta o branco após o maxval')
  i++

  const n = largura * altura
  const precisa = n * 3
  if (bytes.length - i < precisa) {
    throw erro(`PPM: faltam ${precisa - (bytes.length - i)} byte(s) de pixel (${largura}×${altura})`)
  }

  const data = new Uint8ClampedArray(n * 4)
  for (let p = 0; p < n; p++) {
    const o = i + p * 3
    data[p * 4] = bytes[o]
    data[p * 4 + 1] = bytes[o + 1]
    data[p * 4 + 2] = bytes[o + 2]
    data[p * 4 + 3] = 255
  }
  return { width: largura, height: altura, data }
}

// ------------------------------------------------------------------- BMP 24

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | ((b[o + 3] << 24) >>> 0)
const i32 = (b: Uint8Array, o: number): number => u32(b, o) | 0

/**
 * Lê BMP 24 bits sem compressão (BI_RGB), top-down ou bottom-up.
 *
 * Offset de DIB maior que 40 é aceito (cabeçalhos estendidos) desde que os
 * campos básicos estejam nos offsets canônicos. Linhas são alinhadas em 4 bytes.
 */
export function lerBMP(bytes: Uint8Array): Bitmap {
  if (bytes.length < 54) throw erro('BMP: arquivo curto demais')
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw erro('BMP: falta a assinatura "BM"')

  const deslocamentoDados = u32(bytes, 10)
  const tamanhoInfo = u32(bytes, 14)
  if (tamanhoInfo < 40) throw erro(`BMP: cabeçalho DIB de ${tamanhoInfo} bytes — esperava >= 40`)

  const largura = i32(bytes, 18)
  const altura = i32(bytes, 22)
  const planos = u16(bytes, 26)
  const bpp = u16(bytes, 28)
  const compressao = u32(bytes, 30)

  if (largura <= 0 || altura === 0) throw erro(`BMP: dimensões incoerentes ${largura}×${altura}`)
  if (planos !== 1) throw erro(`BMP: planos ${planos} — esperava 1`)
  if (bpp !== 24) throw erro(`BMP: ${bpp} bpp — suporto só 24`)
  if (compressao !== 0) throw erro(`BMP: compressão ${compressao} — suporto só BI_RGB (0)`)

  const h = Math.abs(altura)
  const bottomUp = altura > 0
  const bytesPorLinha = Math.ceil((largura * 3) / 4) * 4
  if (deslocamentoDados + bytesPorLinha * h > bytes.length) {
    throw erro(`BMP: dados de pixel cortados (${largura}×${h})`)
  }

  const n = largura * h
  const data = new Uint8ClampedArray(n * 4)
  for (let y = 0; y < h; y++) {
    const linhaArquivo = bottomUp ? h - 1 - y : y
    const baseLinha = deslocamentoDados + linhaArquivo * bytesPorLinha
    for (let x = 0; x < largura; x++) {
      const o = baseLinha + x * 3
      const p = (y * largura + x) * 4
      data[p] = bytes[o + 2] // BGR → RGB
      data[p + 1] = bytes[o + 1]
      data[p + 2] = bytes[o]
      data[p + 3] = 255
    }
  }
  return { width: largura, height: h, data }
}

// ---------------------------------------------------------------- despacho

/** Detecta o formato pelo cabeçalho e lê. "P6" → PPM; "BM" → BMP. */
export function lerImagem(bytes: Uint8Array): Bitmap {
  if (bytes.length >= 2) {
    if (bytes[0] === 0x50 && bytes[1] === 0x36) return lerPPM(bytes)
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return lerBMP(bytes)
  }
  throw erro('formato não reconhecido — esperava PPM (P6) ou BMP 24 bits')
}
