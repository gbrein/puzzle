/**
 * Dificuldade = tamanho da peça, não contagem.
 *
 * É o que a pessoa sente na mão e o que tem limite físico: abaixo de um certo
 * lado, o pescoço da aba fica com menos de dois ou três filetes de extrusão e a
 * peça quebra ao desencaixar. `pieceCount` é DERIVADO da área da placa e do lado
 * alvo — quem quiser o número cru tem o slider no avançado.
 */

export interface NivelDificuldade {
  id: string
  nome: string
  /** Lado alvo da peça, em mm. */
  ladoAlvo: number
  /** O que o nível significa para quem vai montar. */
  dica: string
  /** Aviso que aparece quando o nível está selecionado. */
  aviso?: string
}

export const NIVEIS_DIFICULDADE: NivelDificuldade[] = [
  {
    id: 'facil',
    nome: 'Fácil',
    ladoAlvo: 35,
    dica: 'Peças grandes — boa para criança ou montagem rápida.',
  },
  { id: 'medio', nome: 'Médio', ladoAlvo: 25, dica: 'Padrão: o equilíbrio usual entre montagem e visual.' },
  {
    id: 'dificil',
    nome: 'Difícil',
    ladoAlvo: 18,
    dica: 'Mais peças, montagem demorada, imagem mais detalhada.',
  },
  {
    id: 'insano',
    nome: 'Insano',
    ladoAlvo: 13,
    dica: 'Muitas peças pequenas.',
    aviso:
      'Peça frágil — o encaixe exige kerf calibrado na sua impressora. Faça o teste de folga antes de imprimir a placa inteira.',
  },
]

/** Filetes de extrusão que o pescoço da aba precisa manter para não quebrar ao desencaixar. */
const FILETES_NO_PESCOCO = 2.5
/** Fração da aresta em que o pescoço da aba afunda — tabSize default do `tabEdge`. */
const TAB_SIZE_DEFAULT = 0.1

/**
 * Lado mínimo seguro da peça, em mm.
 *
 * O pescoço da aba afunda `tabSize × lado` para dentro da peça; abaixo de ~2,5
 * filetes de extrusão de material ali, a aba quebra ao desencaixar. É o piso
 * que substitui o 4 arbitrário do slider de peças — o número sai da física da
 * impressão, não de um chute.
 */
export function ladoMinimoDaPeca(extrusionWidth: number): number {
  if (!(extrusionWidth > 0)) return 1
  return (FILETES_NO_PESCOCO * extrusionWidth) / TAB_SIZE_DEFAULT
}

/**
 * Teto do slider de peças: a contagem em que a peça encolhe até o lado mínimo
 * seguro. Acima disso cada aba teria menos de ~2,5 filetes e quebraria.
 */
export function tetoDePecas(largura: number, altura: number, extrusionWidth: number): number {
  const lado = ladoMinimoDaPeca(extrusionWidth)
  return Math.max(1, Math.round((largura * altura) / (lado * lado)))
}

/** Quantas peças um nível pede para uma placa de `largura` × `altura` mm. */
export function pecasDoNivel(nivel: NivelDificuldade, largura: number, altura: number): number {
  const lado = nivel.ladoAlvo
  return Math.max(1, Math.round((largura * altura) / (lado * lado)))
}

/** O texto da consequência, ex.: "Médio — 34 peças de ~25 mm". */
export function consequenciaDoNivel(nivel: NivelDificuldade, largura: number, altura: number): string {
  return `${nivel.nome} — ${pecasDoNivel(nivel, largura, altura)} peças de ~${nivel.ladoAlvo} mm`
}