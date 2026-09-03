"use client";

import { useRef, useState } from "react";
import { parsePlyGemCostSheet, type ParsedPlyGemCostSheet, type ParsedPlyGemLine, type PositionedPdfPage } from "@/lib/domain/ply-gem-cost-sheet";
import { useDialogDismiss } from "./use-dialog-dismiss";

const MAX_FILES = 25;
const MAX_BYTES = 10 * 1024 * 1024;

type PreviewLine = ParsedPlyGemLine & {
  productId: string;
  productSku: string;
  productName: string;
  candidates: Array<{ id: string; sku: string; name: string; score: number }>;
};

type PreviewDocument = Omit<ParsedPlyGemCostSheet, "lines"> & {
  vendorId: string;
  vendorName: string;
  paymentTerms: string;
  vendorCurrency: string;
  existingPurchaseOrder: { id: string; number: string; status: string; sameFile: boolean } | null;
  lines: PreviewLine[];
  errors: string[];
  warnings: string[];
  canImport: boolean;
};

type ParseFailure = { fileName: string; message: string };
type ImportResult = { clientId: string; fileName: string; quoteNumber: string; status: "created" | "warning" | "failed"; number?: string; message: string };
type Phase = "select" | "parsing" | "review" | "importing" | "done";

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function responseMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message ?? fallback);
  return "message" in body ? String((body as { message?: unknown }).message ?? fallback) : fallback;
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parsePdf(file: File): Promise<ParsedPlyGemCostSheet> {
  if (file.type && file.type !== "application/pdf") throw new Error("Only PDF files are supported.");
  if (file.size <= 0 || file.size > MAX_BYTES) throw new Error("PDFs must be between 1 byte and 10 MB.");
  const buffer = await file.arrayBuffer();
  const firstBytes = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
  if (firstBytes !== "%PDF") throw new Error("The file contents are not a PDF.");
  const [sourceDocumentHash, pdfjs] = await Promise.all([
    sha256(buffer),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
    const pdf = await task.promise;
    const pages: PositionedPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const width = Number(page.view[2]) - Number(page.view[0]);
      const height = Number(page.view[3]) - Number(page.view[1]);
      const tokens = content.items.flatMap((item) => "str" in item && item.str.trim() ? [{ text: item.str, x: Number(item.transform[4]), top: height - Number(item.transform[5]) }] : []);
      pages.push({ pageNumber, width, height, tokens });
    }
    return parsePlyGemCostSheet({ clientId: crypto.randomUUID(), fileName: file.name, sourceDocumentHash, pages });
  } finally {
    await task.destroy();
  }
}

async function previewDocuments(documents: ParsedPlyGemCostSheet[]) {
  const response = await fetch("/api/imports/ply-gem/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documents }),
  });
  const body = await response.json() as { documents?: PreviewDocument[]; error?: unknown };
  if (!response.ok || !Array.isArray(body.documents)) throw new Error(responseMessage(body, "The parsed cost sheets could not be previewed."));
  return body.documents;
}

function orderLines(document: PreviewDocument) {
  const items = document.lines.map((line) => ({
    kind: "item",
    productId: line.productId,
    quantity: line.quantity,
    unitCostCents: line.unitCostCents,
    discountCents: 0,
    taxable: document.taxRateBps > 0,
    taxCode: document.taxCode,
    taxRateBps: document.taxRateBps,
    fulfillmentRoute: "stock",
    configurationSnapshot: line.configurationSnapshot,
  }));
  const charges = document.charges.map((charge) => ({
    kind: "charge",
    chargeType: charge.chargeType,
    description: charge.description,
    amountCents: charge.amountCents,
    direction: "add",
    taxable: document.taxRateBps > 0,
    refundable: false,
    taxCode: document.taxCode,
    taxRateBps: document.taxRateBps,
  }));
  return [...items, ...charges];
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void | Promise<void> }) {
  const [phase, setPhase] = useState<Phase>("select");
  const [documents, setDocuments] = useState<PreviewDocument[]>([]);
  const [failures, setFailures] = useState<ParseFailure[]>([]);
  const [batchError, setBatchError] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]);
  const files = useRef(new Map<string, File>());
  const run = useRef(0);
  const busy = phase === "parsing" || phase === "importing";
  useDialogDismiss(onClose, busy);

  const chooseFiles = async (selected: FileList | null) => {
    const selection = Array.from(selected ?? []);
    const currentRun = ++run.current;
    setDocuments([]);
    setFailures([]);
    setResults([]);
    setBatchError("");
    files.current.clear();
    if (!selection.length) { setPhase("select"); return; }
    if (selection.length > MAX_FILES) {
      setBatchError(`Select no more than ${MAX_FILES} PDFs at once.`);
      setPhase("select");
      return;
    }
    setPhase("parsing");
    const settled = await Promise.allSettled(selection.map(async (file) => ({ file, document: await parsePdf(file) })));
    if (currentRun !== run.current) return;
    const parsed: ParsedPlyGemCostSheet[] = [];
    const nextFailures: ParseFailure[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        parsed.push(result.value.document);
        files.current.set(result.value.document.clientId, result.value.file);
      } else {
        nextFailures.push({ fileName: selection[index]?.name ?? "PDF", message: result.reason instanceof Error ? result.reason.message : "The PDF could not be read." });
      }
    });
    setFailures(nextFailures);
    if (!parsed.length) { setPhase("review"); return; }
    try {
      setDocuments(await previewDocuments(parsed));
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : "The PDFs could not be previewed.");
    } finally {
      if (currentRun === run.current) setPhase("review");
    }
  };

  const importReady = async () => {
    const ready = documents.filter((document) => document.canImport);
    if (!ready.length) return;
    setPhase("importing");
    setBatchError("");
    const nextResults: ImportResult[] = [];
    for (const document of ready) {
      const base = { clientId: document.clientId, fileName: document.fileName, quoteNumber: document.quoteNumber };
      try {
        const idempotencyKey = `ply-gem:${document.vendorId}:${document.quoteNumber}`;
        const response = await fetch("/api/workflows", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({
            command: "createPurchaseOrderDraft",
            idempotencyKey,
            payload: {
              vendorId: document.vendorId,
              expectedDate: document.scheduledDate,
              currency: document.vendorCurrency || document.currency,
              exchangeRateToBase: 1,
              paymentTerms: document.paymentTerms || undefined,
              projectReference: `Source quote ${document.quoteNumber}${document.supplierReference ? ` · ${document.supplierReference}` : ""}`,
              supplierQuoteNumber: document.quoteNumber,
              supplierReference: document.supplierReference || undefined,
              sourceDocumentHash: document.sourceDocumentHash,
              lines: orderLines(document),
            },
          }),
        });
        const body = await response.json() as { recordId?: string; number?: string; message?: string; error?: unknown };
        if (!response.ok || !body.recordId || !body.number) throw new Error(responseMessage(body, "The draft PO could not be created."));
        const file = files.current.get(document.clientId);
        if (!file) throw new Error(`${body.number} was created, but the source PDF is no longer available for attachment.`);
        const form = new FormData();
        form.set("documentType", "purchase_order");
        form.set("documentId", body.recordId);
        form.set("category", "document");
        form.set("file", file);
        const attachmentResponse = await fetch("/api/attachments", { method: "POST", body: form });
        const attachmentBody = await attachmentResponse.json() as { error?: unknown };
        if (!attachmentResponse.ok) {
          nextResults.push({ ...base, number: body.number, status: "warning", message: `${body.number} was created, but its source PDF was not attached: ${responseMessage(attachmentBody, "attachment upload failed")}` });
        } else {
          nextResults.push({ ...base, number: body.number, status: "created", message: `${body.number} created as a draft and ${document.fileName} attached.` });
        }
      } catch (error) {
        nextResults.push({ ...base, status: "failed", message: error instanceof Error ? error.message : "The draft PO could not be created." });
      }
      setResults([...nextResults]);
    }
    await onImported();
    setPhase("done");
  };

  const readyCount = documents.filter((document) => document.canImport).length;
  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="command-dialog cost-sheet-import-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-sheet-import-title">
      <div className="dialog-header"><div><span className="section-kicker">Purchasing automation</span><h2 id="cost-sheet-import-title">Import Ply Gem cost sheets</h2><p>Each PDF becomes a separate draft PO with a PaneFlow-generated PO number.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button></div>
      <div className="cost-sheet-import-body">
        <label className="cost-sheet-file-picker"><span>Select cost-sheet PDFs</span><input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => void chooseFiles(event.target.files)} /><small>Up to 25 files, 10 MB each. All item pages are read; page count does not need to be fixed.</small></label>
        {phase === "parsing" ? <div className="cost-sheet-progress" role="status"><span className="workflow-service loading">Reading PDFs and matching catalog products…</span></div> : null}
        {batchError ? <div className="error-summary" role="alert"><p>{batchError}</p></div> : null}
        {failures.length ? <div className="error-summary" role="alert"><strong>Files that could not be read</strong><ul className="error-list">{failures.map((failure) => <li key={failure.fileName}><strong>{failure.fileName}:</strong> {failure.message}</li>)}</ul></div> : null}
        {documents.length ? <div className="cost-sheet-document-list">{documents.map((document) => <article key={document.clientId} className={`cost-sheet-document ${document.canImport ? "ready" : "blocked"}`}>
          <header><div><span>{document.fileName}</span><h3>Ply Gem quote {document.quoteNumber}</h3><p>{document.vendorName || "Vendor not mapped"} · scheduled {document.scheduledDate}</p></div><span className={`workflow-status ${document.canImport ? "success" : "warning"}`}><span />{document.canImport ? "Ready" : document.existingPurchaseOrder ? "Duplicate" : "Review required"}</span></header>
          <dl><div><dt>Internal PO</dt><dd>Next PaneFlow number</dd></div><div><dt>Supplier reference</dt><dd>{document.supplierReference || "None on PDF"}</dd></div><div><dt>Items</dt><dd>{document.totalQuantity} units · {document.lines.length} lines</dd></div><div><dt>Total</dt><dd>{money(document.totalCents)}</dd></div></dl>
          {document.warnings.length ? <div className="cost-sheet-notices warning">{document.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
          {document.errors.length ? <div className="cost-sheet-notices danger">{document.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
          <div className="workflow-table-wrap"><table className="workflow-table cost-sheet-lines"><thead><tr><th>Source</th><th>Matched catalog item</th><th className="numeric">Qty</th><th className="numeric">Unit cost</th><th className="numeric">Line total</th></tr></thead><tbody>{document.lines.map((line) => <tr key={line.sourceLineNumber}><td>Line {line.sourceLineNumber}<small>{line.productType}{line.osmWidthMm && line.osmHeightMm ? ` · ${line.osmWidthMm} × ${line.osmHeightMm} mm` : ""}</small></td><td>{line.productId ? <><strong>{line.productSku}</strong><small>{line.productName}</small></> : <><strong>No automatic match</strong><small>{line.candidates.length ? `Closest: ${line.candidates.map((candidate) => candidate.sku).join(", ")}` : "No catalog candidates"}</small></>}</td><td className="numeric">{line.quantity}</td><td className="numeric">{money(line.unitCostCents)}</td><td className="numeric">{money(line.lineTotalCents)}</td></tr>)}</tbody></table></div>
        </article>)}</div> : phase === "review" && !batchError && !failures.length ? <div className="workflow-empty">Select one or more Ply Gem cost-sheet PDFs to begin.</div> : null}
        {results.length ? <div className="cost-sheet-results" role="status"><h3>Import results</h3>{results.map((result) => <p key={result.clientId} className={result.status}><strong>{result.fileName}</strong><span>{result.message}</span></p>)}</div> : null}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>{phase === "done" ? "Close" : "Cancel"}</button>{phase !== "done" ? <button type="button" className="button primary" onClick={() => void importReady()} disabled={busy || readyCount === 0}>{phase === "importing" ? `Creating ${readyCount} draft${readyCount === 1 ? "" : "s"}…` : `Import ${readyCount} ready PDF${readyCount === 1 ? "" : "s"}`}</button> : null}</div>
      </div>
    </section>
  </div>;
}

export function PlyGemImportButton({ disabled, onImported }: { disabled?: boolean; onImported: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return <><button className="workflow-action" type="button" disabled={disabled} onClick={() => setOpen(true)}>Import cost-sheet PDFs</button>{open ? <ImportDialog onClose={() => setOpen(false)} onImported={onImported} /> : null}</>;
}
