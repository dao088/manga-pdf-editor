import type { ImageRawData, ModelCreateOptions } from './types/index.js';
import { Detection, Recognition } from './models/index.js';
export declare class Ocr {
    #private;
    static create(options?: ModelCreateOptions): Promise<Ocr>;
    constructor({ detection, recognition, }: {
        detection: Detection;
        recognition: Recognition;
    });
    detect(image: string | ImageRawData, options?: {}): Promise<{
        texts: import("./types/index.js").Line[];
        resizedImageWidth: any;
        resizedImageHeight: any;
    }>;
}
