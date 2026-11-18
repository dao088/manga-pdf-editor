import type { InferenceSession as InferenceSessionCommon } from 'onnxruntime-common';
import type { ImageRawData, ModelCreateOptions } from '../types/index.js';
import { ModelBase } from './ModelBase.js';
export declare class Detection extends ModelBase {
    static create({ models, onnxOptions, ...restOptions }: ModelCreateOptions): Promise<Detection>;
    run(path: string | ImageRawData, { onnxOptions }?: {
        onnxOptions?: InferenceSessionCommon.RunOptions;
    }): Promise<{
        lineImages: import("../types/index.js").LineImage[];
        resizedImageWidth: any;
        resizedImageHeight: any;
    }>;
}
