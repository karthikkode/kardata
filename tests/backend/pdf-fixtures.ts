// Maintained TEST PDF bytes; real parser input, never live business evidence.
import { deflateSync } from 'node:zlib'

export function testPdf(withImages: boolean, format: 'xobject' | 'inline' | 'mask' | 'colored-mask' | 'repeat' | 'alpha' | 'form' | 'vector' | 'vector-alpha' | 'vector-repeat' | 'vector-crop' = 'xobject'): Buffer {
  const objects: Buffer[] = []
  const add = (text: string | Buffer) => { objects.push(typeof text === 'string' ? Buffer.from(text) : text); return objects.length }
  const stream = (dictionary: string, bytes: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')])
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const images = [[255, 0, 0], [0, 0, 255]].map((color) => {
    const alpha = format === 'alpha' || format === 'vector-alpha' ? add(stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', deflateSync(Buffer.from([0, 64, 128, 255])))) : null
    const mask = format === 'mask' || format === 'colored-mask'
    return add(stream(`/Type /XObject /Subtype /Image /Width 2 /Height 2 ${mask ? '/ImageMask true /BitsPerComponent 1 /Decode [1 0]' : `/ColorSpace /DeviceRGB /BitsPerComponent 8 ${alpha ? `/SMask ${alpha} 0 R` : ''}`} /Filter /FlateDecode`, deflateSync(mask ? Buffer.from([64, 128]) : Buffer.from([...color, ...color, ...color, ...color]))))
  })
  const forms = format === 'form' ? images.map((image) => add(stream(`/Type /XObject /Subtype /Form /BBox [0 0 612 200] /Matrix [1 0 0 1 0 500] /Resources << /XObject << /Im0 ${image} 0 R >> >>`, Buffer.from('q 100 0 0 100 20 120 cm /Im0 Do Q')))) : []
  const contents = [1, 2].map((page) => {
    const image = format === 'inline' ? `BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ${page === 1 ? 'ff0000'.repeat(4) : '0000ff'.repeat(4)}> EI` : '/Im0 Do'
    let draw = withImages ? Array.from({ length: format === 'repeat' || format === 'vector-repeat' ? 12 : 1 }, (_, index) => `q 100 0 0 100 ${20 + index * 5} 620 cm ${image} Q\n`).join('') : ''
    if (format === 'vector-crop') draw = `q 20 620 50 100 re W n\n${draw}Q\n`
    const vector = format.startsWith('vector') ? `q 0 0.7 0 rg ${format === 'vector' ? 20 : 250} 620 100 100 re f Q\n` : ''
    return add(stream('', Buffer.from(`${format === 'colored-mask' ? '0.2 0.4 0.6 rg\n' : ''}BT /F1 12 Tf 20 750 Td (TEST page ${page} before image) Tj ET\n${withImages && format === 'form' ? '/Fm0 Do\n' : draw}${vector}BT /F1 12 Tf 20 550 Td (TEST page ${page} after image) Tj ET`)))
  })
  const pagesId = objects.length + 1
  const pageIds = [pagesId + 1, pagesId + 2]
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count 2 >>`)
  pageIds.forEach((_id, index) => add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${withImages ? `/XObject << /Im0 ${images[index]} 0 R ${format === 'form' ? `/Fm0 ${forms[index]} 0 R` : ''} >>` : ''} >> /Contents ${contents[index]} 0 R >>`))
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const chunks = [Buffer.from('%PDF-1.7\n% TEST fixture\n')]
  const offsets = [0]
  let length = chunks[0]!.length
  objects.forEach((object, index) => {
    offsets.push(length)
    const bytes = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    chunks.push(bytes); length += bytes.length
  })
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(chunks)
}

/** Highly compressed, real near-limit RGB image with repeated placements.
 * Deliberately stresses decoded memory while staying below the upload cap. */
export function stressImagePdf(placements: number): Buffer {
  if (![1, 10, 100].includes(placements)) throw new Error('Unsupported TEST stress placement count')
  const width = 3000, height = 2666
  const raw = Buffer.alloc(width * height * 3)
  for (let index = 0; index < raw.length; index += 3) { raw[index] = 17; raw[index + 1] = 34; raw[index + 2] = 51 }
  const compressed = deflateSync(raw)
  const stream = (dictionary: string, bytes: Buffer) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')])
  const content = Buffer.from(Array.from({ length: placements }, (_, index) => `q 100 0 0 100 ${index % 10} ${Math.floor(index / 10)} cm /Im0 Do Q`).join('\n'))
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, compressed),
    stream('', content),
  ]
  const chunks = [Buffer.from('%PDF-1.7\n% TEST decoded-memory fixture\n')], offsets: number[] = []
  let length = chunks[0]!.length
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const bytes = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    chunks.push(bytes); length += bytes.length
  }
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(chunks)
}
