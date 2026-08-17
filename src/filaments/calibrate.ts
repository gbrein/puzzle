/**
 * Calibração de TD a partir de medições do usuário.
 *
 * A lei é Beer-Lambert reescrita na convenção do HueForge: T = 10^(-t/TD).
 * Tirando log10 dos dois lados, log10(T) = -t/TD — uma reta pela origem, de
 * inclinação -1/TD. Então o ajuste é mínimos quadrados sem intercepto: a origem
 * não é um chute, é física (espessura zero não atenua nada).
 */

export interface Sample {
  /** Espessura do corpo de prova em mm. */
  thicknessMm: number
  /** Fração de luz que passou, em (0, 1]. */
  transmission: number
}

/**
 * Ajusta o TD. Devolve também o R² (quanto da variação das medidas o modelo
 * explica) e uma leitura de confiança que já combina R² com o tamanho da amostra
 * — R² alto com três pontos não é evidência forte.
 */
export function fitTD(samples: Sample[]): { td: number; r2: number; confidence: 'alta' | 'media' | 'baixa' } {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('fitTD: informe ao menos uma amostra')
  }

  // Fronteira de confiança: os números vêm de medição manual do usuário.
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const { thicknessMm, transmission } = samples[i]
    if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
      throw new Error(`fitTD: amostra ${i} tem espessura inválida (${thicknessMm}); precisa ser > 0 mm`)
    }
    if (!Number.isFinite(transmission) || transmission <= 0 || transmission > 1) {
      throw new Error(`fitTD: amostra ${i} tem transmissão inválida (${transmission}); precisa estar em (0, 1]`)
    }
    xs.push(thicknessMm)
    ys.push(Math.log10(transmission))
  }

  // Regressão pela origem: inclinação = Σxy / Σx².
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += xs[i] * ys[i]
    sxx += xs[i] * xs[i]
  }
  const slope = sxy / sxx
  if (slope >= 0) {
    throw new Error('fitTD: as amostras não mostram atenuação nenhuma; não dá para estimar TD')
  }
  const td = -1 / slope

  // R² centrado: mais severo que o "sem intercepto", e é o que cai quando as
  // medidas fogem da reta. Com menos de dois pontos não há dispersão a explicar.
  let r2 = 0
  if (ys.length >= 2) {
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length
    let ssRes = 0
    let ssTot = 0
    for (let i = 0; i < xs.length; i++) {
      const d = ys[i] - slope * xs[i]
      ssRes += d * d
      ssTot += (ys[i] - mean) ** 2
    }
    r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot)
  }

  const n = samples.length
  const confidence = r2 >= 0.98 && n >= 5 ? 'alta' : r2 >= 0.9 && n >= 3 ? 'media' : 'baixa'
  return { td, r2, confidence }
}
