import Ocr, { registerBackend } from '../ocr-common/index.js';
import { splitIntoLineImages } from '../ocr-common/backend/splitIntoLineImages.js';
import { InferenceSession } from 'onnxruntime-web';
import { FileUtils } from './FileUtils.js';
import { ImageRaw } from './ImageRaw.js';
registerBackend({ FileUtils, ImageRaw, InferenceSession, splitIntoLineImages });
export * from '../ocr-common/index.js';
export default Ocr;
