import type { Aspect } from './types'

/* Mock media sources. Replaced by real provider output when the backend lands. */

export function mockImageUrl(seed: string, _aspect: Aspect): string {
  const samples = ['/demo/forest-light.jpg', '/demo/forest-path.jpg', '/demo/forest-life.jpg']
  const hash = Array.from(seed).reduce((value, char) => value + char.charCodeAt(0), 0)
  return samples[hash % samples.length]!
}

/** CC0 flower sample from MDN, served locally so previews work without a provider. */
export function mockVideo(seed: string, aspect: Aspect): { url: string; posterUrl: string } {
  return { url: '/demo/flower.mp4', posterUrl: mockImageUrl(seed, aspect) }
}
