import type { ReferenceNode } from './types'

export function handleFromName(name: string) {
  return (
    name
      .normalize('NFKC')
      .trim()
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'reference'
  )
}
export function referenceHandle(node: Pick<ReferenceNode, 'handle' | 'name' | 'title'>) {
  return node.handle || handleFromName(node.title ?? node.name)
}
export function uniqueHandle(name: string, taken: Iterable<string>) {
  const used = new Set(taken),
    base = handleFromName(name)
  let handle = base,
    suffix = 2
  while (used.has(handle)) {
    const ending = `-${suffix++}`
    handle = `${base.slice(0, 48 - ending.length)}${ending}`
  }
  return handle
}
export function replaceMentions(prompt: string, handles: Map<string, string>) {
  return prompt.replace(
    /(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]+)/gu,
    (match, boundary: string, handle: string) =>
      handles.has(handle) ? `${boundary}@${handles.get(handle)}` : match,
  )
}
export function mentionAt(text: string, start: number, end = start) {
  if (start !== end) return null
  const match = /(?:^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, start))
  return match ? { start: start - match[1]!.length - 1, end: start, query: match[1]! } : null
}
export function insertMention(text: string, range: { start: number; end: number }, handle: string) {
  const token = `@${handle} `
  return {
    text:
      text.slice(0, range.start) + token + text.slice(range.end).replace(/^[\p{L}\p{N}_-]* ?/u, ''),
    caret: range.start + token.length,
  }
}

export function mentionedHandles(prompt: string) {
  return [
    ...new Set(
      [...prompt.matchAll(/(?:^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]!),
    ),
  ]
}
