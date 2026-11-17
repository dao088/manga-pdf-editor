import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

/** Rendered page canvases, used to sample colours for the text-edit auto detection. */
const canvases = new Map<number, HTMLCanvasElement>()
export const registerCanvas = (page: number, c: HTMLCanvasElement) => canvases.set(page, c)
export const getCanvas = (page: number) => canvases.get(page)
