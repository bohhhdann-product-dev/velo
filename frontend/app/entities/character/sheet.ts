import { characterPhotos, type Character } from './types'

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024
export function photoFileError(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'Choose a JPG, PNG or WebP image.'
  if (file.size > MAX_PHOTO_BYTES) return 'Choose an image smaller than 12 MB.'
  return ''
}
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('This image could not be opened. Try another JPG, PNG or WebP.'))
    image.src = url
  })
}
// Local decoding verifies the file and bounds memory before it enters the character draft.
export async function readCharacterPhoto(file: File): Promise<string> {
  const error = photoFileError(file)
  if (error) throw new Error(error)
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f3f1ed'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.88)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// A reference contact sheet, not an AI render. Only supplied angles appear; none are invented.
export async function composeCharacterSheet(character: Character): Promise<string> {
  const face = characterPhotos(character, 'face')
  const body = characterPhotos(character, 'body')
  if (!face.length || !body.length)
    throw new Error('Add a front portrait and a full-body photo first.')
  const all = [...face, ...body]
  const images = await Promise.all(all.map((photo) => loadImage(photo.url)))
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1000
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#eae8e2'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const drawRow = (photos: typeof face, start: number, y: number, h: number, title: string) => {
    ctx.fillStyle = '#5d625e'
    ctx.font = '500 16px system-ui'
    ctx.fillText(title, 34, y - 14)
    const gap = 14
    const width = (1532 - gap * (photos.length - 1)) / photos.length
    photos.forEach((photo, index) => {
      const image = images[start + index]!
      const x = 34 + index * (width + gap)
      ctx.fillStyle = '#deddd7'
      ctx.fillRect(x, y, width, h)
      // Contain preserves full bodies and avoids inventing cropped reference views.
      const scale = Math.min(width / image.naturalWidth, h / image.naturalHeight)
      const w = image.naturalWidth * scale,
        height = image.naturalHeight * scale
      ctx.drawImage(image, x + (width - w) / 2, y + (h - height) / 2, w, height)
      ctx.fillStyle = '#5d625e'
      ctx.font = '14px system-ui'
      ctx.fillText(photo.label, x, y + h + 22)
    })
  }
  drawRow(face, 0, 50, 310, 'FACE REFERENCES')
  drawRow(body, face.length, 435, 500, 'BODY REFERENCES')
  return canvas.toDataURL('image/jpeg', 0.9)
}
