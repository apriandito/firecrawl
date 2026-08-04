import ExcelJS from "exceljs";
import type { ExportSink } from "../core/ports.js";
import type { Document } from "../types.js";

/**
 * Excel export. Accepts either scraped Documents (metadata sheet) or an array
 * of extracted records (via opts.records) — the agentic flow produces records
 * ("berita ekonomi syariah") and writes them straight to a styled sheet.
 */
export const xlsxSink: ExportSink = {
  format: "xlsx",
  async write(
    docs: Document[],
    opts?: Record<string, unknown>,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "ScrapeFlow";
    wb.created = new Date();

    const records = (opts?.records as Record<string, unknown>[] | undefined) ?? null;
    const sheetName = (opts?.sheetName as string | undefined) ?? "Data";

    if (records && records.length > 0) {
      const ws = wb.addWorksheet(sheetName);
      const columns = Object.keys(
        records.reduce<Record<string, true>>((acc, r) => {
          Object.keys(r).forEach((k) => (acc[k] = true));
          return acc;
        }, {}),
      );
      ws.columns = columns.map((key) => ({
        header: key,
        key,
        width: Math.min(60, Math.max(14, key.length + 4)),
      }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
      for (const r of records) {
        ws.addRow(
          Object.fromEntries(
            columns.map((c) => [c, normalizeCell(r[c])]),
          ),
        );
      }
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };
    } else {
      // Fallback: one row per scraped document.
      const ws = wb.addWorksheet("Documents");
      ws.columns = [
        { header: "url", key: "url", width: 50 },
        { header: "title", key: "title", width: 40 },
        { header: "status", key: "status", width: 10 },
        { header: "engine", key: "engine", width: 14 },
        { header: "chars", key: "chars", width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const d of docs) {
        ws.addRow({
          url: d.metadata.url,
          title: d.metadata.title ?? "",
          status: d.metadata.statusCode ?? "",
          engine: d.metadata.engine ?? "",
          chars: (d.markdown ?? d.html ?? "").length,
        });
      }
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  },
};

function normalizeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}
