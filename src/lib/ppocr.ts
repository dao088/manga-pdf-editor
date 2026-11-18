import * as ort from 'onnxruntime-web'
import Ocr from '../vendor/ocr-browser/index.js'
import detUrl from '../assets/ocr/ch_PP-OCRv4_det_infer.onnx?url'
import recUrl from '../assets/ocr/ch_PP-OCRv4_rec_infer.onnx?url'
import dictUrl from '../assets/ocr/ppocr_keys_v1.txt?url'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

export type OcrLine = { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }

let ocr: Promise<Ocr> | null = null

/** PaddleOCR (PP-OCRv4) running locally through ONNX/WASM: no internet, handles lettering on busy backgrounds. */
function getOcr(): Promise<Ocr> {
  ocr ??= (async () => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl }
    ort.env.wasm.numThreads = 1
    return Ocr.create({
      models: { detectionPath: detUrl, recognitionPath: recUrl, dictionaryPath: dictUrl },
      onnxOptions: { executionProviders: ['wasm'] },
    })
  })().catch((e) => {
    ocr = null
    throw e
  })
  return ocr
}

/** Runs OCR on a canvas; returns line boxes in canvas pixels. */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
  const o = await getOcr()
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const res = await o.detect({ data: img.data, width: img.width, height: img.height })
  const sx = canvas.width / res.resizedImageWidth
  const sy = canvas.height / res.resizedImageHeight
  type T = { text: string; mean: number; box?: number[][] }
  return (res.texts as T[])
    .filter((t) => t.box && t.text.trim())
    .map((t) => {
      const box = t.box as number[][]
      const xs = box.map((p) => p[0] * sx)
      const ys = box.map((p) => p[1] * sy)
      return {
        text: t.text.trim(),
        conf: t.mean,
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      }
    })
}
