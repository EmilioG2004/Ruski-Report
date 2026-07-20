import { ScorebookSource } from "../../games";
import { PostgresExecutor } from "./postgres-executor";

export async function writeScorebookSource(
  executor: PostgresExecutor,
  sourceId: string,
  source: ScorebookSource
): Promise<void> {
  await executor.query(
    `
      INSERT INTO scorebook_sources (
        id, original_name, mime_type, size_bytes, checksum, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        original_name = EXCLUDED.original_name,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        checksum = EXCLUDED.checksum,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      sourceId,
      source.originalName,
      source.mimeType ?? null,
      source.sizeBytes ?? null,
      source.checksum ?? null,
      source.metadata ?? {}
    ]
  );
}
