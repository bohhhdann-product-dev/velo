/** A single byte range; multipart ranges are deliberately unsupported. */
export function parseMediaRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid range')
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) throw new Error('Invalid range')
  if (first === null) {
    if (!last || last < 1) throw new Error('Invalid range')
    return { start: Math.max(0, size - last), end: size - 1 }
  }
  if (first >= size || (last !== null && last < first)) throw new Error('Invalid range')
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) }
}
