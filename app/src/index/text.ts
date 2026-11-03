// Text normalisation and offset mapping shared by search, quoting and resolve.
// Normalisation ignores width, case, whitespace, punctuation and symbols, but
// keeps a map back to the original string so snippets and quotes can be sliced
// from the authoritative text instead of the normalised copy.

export interface NormalizedText {
  /** Normalised text used for comparisons. */
  text: string
  /** offsets[i] is the index in the original string of normalised char i. */
  offsets: number[]
}

const SKIP = /[\s\p{P}\p{S}]/u

export function normalizeText(input: string): NormalizedText {
  let text = ''
  const offsets: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    const normalized = input[index].normalize('NFKC').toLowerCase()
    for (const char of normalized) {
      if (SKIP.test(char)) continue
      text += char
      offsets.push(index)
    }
  }
  return { text, offsets }
}

/** Comparison form only; never use it as display text. */
export function normalize(input: string): string {
  return normalizeText(input).text
}

export function findAll(haystack: string, needle: string): number[] {
  if (!needle) return []
  const hits: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    hits.push(at)
    from = at + 1
  }
  return hits
}

export interface TextSpan {
  start: number
  end: number
}

/** Maps a normalised span back to a span in the original string. */
export function originalSpan(original: string, normalized: NormalizedText, start: number, length: number): TextSpan {
  if (!normalized.offsets.length) return { start: 0, end: 0 }
  const clampedStart = Math.max(0, Math.min(start, normalized.offsets.length - 1))
  const last = Math.max(clampedStart, Math.min(start + length - 1, normalized.offsets.length - 1))
  const endIndex = Math.min(normalized.offsets[last] + 1, original.length)
  return { start: normalized.offsets[clampedStart], end: endIndex }
}

/** Original-text excerpt around a normalised match position. */
export function snippetAround(
  original: string,
  normalized: NormalizedText,
  start: number,
  length: number,
  radius = 40
): string {
  const span = originalSpan(original, normalized, start, length)
  const from = Math.max(0, span.start - radius)
  const to = Math.min(original.length, span.end + radius)
  const prefix = from > 0 ? '…' : ''
  const suffix = to < original.length ? '…' : ''
  return `${prefix}${original.slice(from, to).replace(/\s+/g, ' ').trim()}${suffix}`
}

/** Stable 32-bit FNV-1a hash, hex encoded. Used for revisions and derived ids. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Short deterministic id for a derived object: prefix + hash. */
export function derivedId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${hashString(parts.join('|'))}`
}
