import test from 'node:test'
import assert from 'node:assert/strict'
import { validateImageFile } from '../src/utils/imageUpload.js'

test('ID upload rejects non-images, renamed files, empty files and files over 5 MB', async () => {
  const options = { label: 'ID image' }
  await assert.rejects(validateImageFile(new File(['pdf'], 'id.pdf', { type: 'application/pdf' }), options), /JPG, PNG, or WEBP/)
  await assert.rejects(validateImageFile(new File(['GIF89a'], 'id.jpg', { type: 'image/jpeg' }), options), /content does not match/)
  await assert.rejects(validateImageFile(new File([new Uint8Array([255,216,255])], 'id.gif', { type: 'image/jpeg' }), options), /filename and file type/)
  await assert.rejects(validateImageFile(new File([], 'id.jpg', { type: 'image/jpeg' }), options), /empty/)
  await assert.rejects(validateImageFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'id.png', { type: 'image/png' }), options), /5 MB/)
})
