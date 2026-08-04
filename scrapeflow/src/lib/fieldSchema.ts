import { z } from "zod";

export type FieldType = "string" | "number" | "boolean";
export type FieldSpec = Record<string, FieldType>;

/** Build a flat, nullable Zod object schema from a {field: type} map. */
export function buildRecordSchema(fields: FieldSpec): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const [key, type] of Object.entries(fields)) {
    shape[key] =
      type === "number"
        ? z.number().nullable()
        : type === "boolean"
          ? z.boolean().nullable()
          : z.string().nullable();
  }
  return z.object(shape);
}

/** True when a record carries at least one non-empty value. */
export function hasSignal(record: Record<string, unknown>): boolean {
  return Object.values(record).some(
    (v) => v !== null && v !== undefined && v !== "",
  );
}
