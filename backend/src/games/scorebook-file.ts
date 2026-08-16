import { ISODateTimeString, Metadata } from "../domain";

export interface ScorebookFile {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt?: ISODateTimeString;
  metadata?: Metadata;
}
