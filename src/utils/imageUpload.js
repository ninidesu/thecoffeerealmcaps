export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp'

const MIME_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
}

const CANONICAL_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function detectedMimeType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return ''
}

async function verifyImageCanBeDecoded(file, label) {
  if (typeof globalThis.createImageBitmap !== 'function') return
  let bitmap
  try {
    bitmap = await globalThis.createImageBitmap(file)
    if (!bitmap.width || !bitmap.height) throw new Error()
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error(`${label} dimensions are too large. Choose an image under 40 megapixels.`)
  } catch (error) {
    if (error?.message?.includes('40 megapixels')) throw error
    throw new Error(`${label} is damaged or is not a valid JPG, PNG, or WEBP image.`)
  } finally {
    bitmap?.close?.()
  }
}

export async function validateImageFile(file, { label = 'Image', maxBytes = IMAGE_UPLOAD_MAX_BYTES } = {}) {
  if (!file) throw new Error(`Choose a ${label.toLowerCase()} to upload.`)
  if (!CANONICAL_EXTENSIONS[file.type]) throw new Error(`${label} must be a JPG, PNG, or WEBP image. GIFs, videos, and documents are not allowed.`)
  if (!file.size) throw new Error(`${label} cannot be empty.`)
  if (file.size > maxBytes) throw new Error(`${label} must be 5 MB or smaller.`)

  const filenameExtension = String(file.name || '').split('.').pop()?.toLowerCase()
  if (!filenameExtension || !MIME_EXTENSIONS[file.type].includes(filenameExtension)) {
    throw new Error(`${label} filename and file type do not match. Use an original JPG, PNG, or WEBP image.`)
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (detectedMimeType(bytes) !== file.type) {
    throw new Error(`${label} content does not match its file type. Renamed GIFs, videos, and other files are not allowed.`)
  }

  await verifyImageCanBeDecoded(file, label)
  return { extension: CANONICAL_EXTENSIONS[file.type], mimeType: file.type }
}
