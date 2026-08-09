import type { ActorIdentity } from "./auth";
import { all, ensureDatabase, first, getD1, newId } from "./inventory-db";

export type ExportType = "inventory" | "movements" | "purchase-orders" | "vendor-bills" | "customer-invoices" | "audit" | "accounting" | "quickbooks";
export type ExportRange = { from: string; to: string };

const queries: Record<Exclude<ExportType, "accounting" | "quickbooks">, string> = {
  inventory: `SELECT p.sku,p.name,l.code AS location,l.inventory_status AS status,ib.on_hand_qty AS on_hand,ib.reserved_qty AS reserved,ib.on_hand_qty-ib.reserved_qty AS available,p.base_uom_id AS uom FROM inventory_balances ib JOIN products p ON p.id=ib.product_id JOIN locations l ON l.id=ib.location_id ORDER BY p.sku,l.code`,
  movements: `SELECT sm.posted_at,sm.movement_type,p.sku,sm.quantity,fl.code AS from_location,tl.code AS to_location,sm.inventory_status,sm.source_document_type,sm.source_document_id,sm.posted_by,sm.lot_id,sm.inventory_unit_id FROM stock_movements sm JOIN products p ON p.id=sm.product_id LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id ORDER BY sm.posted_at`,
  "purchase-orders": `SELECT po.number,bp.name AS vendor,po.lifecycle_status,po.billing_status,po.expected_date,po.currency,po.total_cents,po.revision_number,po.version,pol.id AS line_id,p.sku,pol.ordered_qty,pol.closed_qty,pol.unit_cost_cents,pol.fulfillment_route FROM purchase_orders po JOIN business_partners bp ON bp.id=po.vendor_id JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id JOIN products p ON p.id=pol.product_id ORDER BY po.number,pol.id`,
  "vendor-bills": `SELECT vb.number,vb.vendor_invoice_number,bp.name AS vendor,po.number AS purchase_order,vb.status,vb.match_status,vb.invoice_date,vb.due_date,vb.currency,vb.exchange_rate_to_base,vb.subtotal_cents,vb.tax_cents,vb.total_cents,vb.base_total_cents,vb.paid_cents,vb.hold_reason FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id LEFT JOIN purchase_orders po ON po.id=vb.purchase_order_id ORDER BY vb.invoice_date`,
  "customer-invoices": `SELECT ci.number,bp.name AS customer,so.number AS sales_order,ci.status,ci.invoice_date,ci.due_date,ci.currency,ci.exchange_rate_to_base,ci.subtotal_cents,ci.tax_cents,ci.total_cents,ci.base_total_cents,ci.paid_cents FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id LEFT JOIN sales_orders so ON so.id=ci.sales_order_id ORDER BY ci.invoice_date`,
  audit: `SELECT created_at,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json FROM audit_events ORDER BY created_at`,
};

function safeCell(value: unknown) {
  if (value == null) return "";
  const original = String(value);
  return typeof value === "string" && /^\s*[=+\-@]/.test(original) ? `'${original}` : original;
}

function csv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = safeCell(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\r\n");
}

type AccountingRow = Record<string, unknown> & { debit_cents: number; credit_cents: number };
type DocumentRow = { id:string; number:string; postingDate:string; subtotal:number; tax:number; total:number; baseTotal:number; currency:string; exchange:number; partnerName?:string; refundable?:number; otherCharges?:number };

function line(document:DocumentRow, documentType:string, account:string, debit:number, credit:number, transactionAmount:number):AccountingRow {
  return {
    posting_date: document.postingDate,
    document_type: documentType,
    document_number: document.number,
    source_type: documentType,
    source_id: document.id,
    row_class: "journal_entry",
    accounting_class: "general_ledger",
    reference: `${documentType}:${document.id}`,
    parent_reference: "",
    partner_reference: document.partnerName ?? "",
    asset_reference: "",
    asset_code: "",
    event_type: "",
    event_semantic: "",
    direction: "",
    quantity: "",
    balance_cents: "",
    balance_delta_cents: "",
    event_amount_cents: "",
    status: "",
    memo: "",
    posted_by: "",
    account,
    debit_cents: debit,
    credit_cents: credit,
    currency: document.currency,
    transaction_amount_cents: transactionAmount,
    exchange_rate_to_base: document.exchange,
  };
}

function splitLine(document:DocumentRow, documentType:string, account:string, baseAmount:number, transactionAmount:number, normalSide:"debit"|"credit") {
  const amount=Math.abs(baseAmount),transaction=Math.abs(transactionAmount);
  const debit=(baseAmount>=0)===(normalSide==="debit")?amount:0;
  return line(document,documentType,account,debit,debit?0:amount,transaction);
}

type ReturnableObligationRow = {
  id: string;
  postingDate: string;
  partnerId: string;
  partnerName: string;
  assetTypeId: string;
  assetCode: string;
  assetName: string;
  direction: string;
  issued: number;
  returned: number;
  forfeited: number;
  depositCharged: number;
  depositRefunded: number;
  forfeitedAmount: number;
  status: string;
};

type ReturnableEventRow = {
  id: string;
  obligationId: string;
  postingDate: string;
  eventType: string;
  quantity: number;
  amount: number;
  reason: string;
  postedBy: string;
  partnerId: string;
  partnerName: string;
  assetTypeId: string;
  assetCode: string;
  assetName: string;
  direction: string;
};

const returnableCurrencyMemo = "Base-currency cents; returnable obligations do not store a transaction currency.";

function returnableLine(input: {
  postingDate: string;
  documentType: "returnable_obligation" | "returnable_event";
  documentNumber: string;
  sourceId: string;
  rowClass: "returnable_asset_balance" | "returnable_deposit_balance" | "returnable_custody_event";
  accountingClass: string;
  reference: string;
  parentReference?: string;
  partnerId: string;
  assetTypeId: string;
  assetCode: string;
  eventType?: string;
  eventSemantic?: string;
  direction: string;
  quantity?: number;
  balanceCents?: number;
  balanceDeltaCents?: number;
  eventAmountCents?: number;
  status?: string;
  memo: string;
  postedBy?: string;
  account: string;
}): AccountingRow {
  return {
    posting_date: input.postingDate,
    document_type: input.documentType,
    document_number: input.documentNumber,
    source_type: input.documentType,
    source_id: input.sourceId,
    row_class: input.rowClass,
    accounting_class: input.accountingClass,
    reference: input.reference,
    parent_reference: input.parentReference ?? "",
    partner_reference: `business_partner:${input.partnerId}`,
    asset_reference: `returnable_asset_type:${input.assetTypeId}`,
    asset_code: input.assetCode,
    event_type: input.eventType ?? "",
    event_semantic: input.eventSemantic ?? "",
    direction: input.direction,
    quantity: input.quantity ?? "",
    balance_cents: input.balanceCents ?? "",
    balance_delta_cents: input.balanceDeltaCents ?? "",
    event_amount_cents: input.eventAmountCents ?? "",
    status: input.status ?? "",
    memo: input.memo,
    posted_by: input.postedBy ?? "",
    account: input.account,
    debit_cents: 0,
    credit_cents: 0,
    currency: "BASE",
    transaction_amount_cents: 0,
    exchange_rate_to_base: 1,
  };
}

function base(value:number, exchange:number){ return Math.round(value * exchange); }

function validateDocument(document: DocumentRow) {
  if (!Number.isFinite(document.exchange) || document.exchange <= 0) throw new Error(`Export blocked because ${document.number} has an invalid exchange rate.`);
  if (document.subtotal + document.tax !== document.total) throw new Error(`Export blocked because ${document.number} subtotal and tax do not equal its total.`);
  const expectedBase = base(document.total, document.exchange);
  if (document.baseTotal !== expectedBase) throw new Error(`Export blocked because ${document.number} base total is ${document.baseTotal}; expected ${expectedBase}.`);
}

function addRoundingLine(rows: AccountingRow[], document: DocumentRow, documentType: string, difference: number, normalSide: "debit" | "credit") {
  if (!difference) return;
  if (Math.abs(difference) > 3) throw new Error(`Export blocked because ${document.number} has an unexplained base-currency difference of ${difference} cents.`);
  rows.push(splitLine(document, documentType, "Foreign exchange rounding", difference, 0, normalSide));
}

async function accountingRows(range: ExportRange) {
  const rows: AccountingRow[] = [];
  const bills = await all<DocumentRow>(`SELECT vb.id,vb.number,vb.invoice_date AS postingDate,vb.subtotal_cents AS subtotal,vb.tax_cents AS tax,vb.total_cents AS total,vb.base_total_cents AS baseTotal,vb.currency,vb.exchange_rate_to_base AS exchange,bp.name AS partnerName,
      COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='vendor_bill' AND dc.document_id=vb.id AND dc.refundable=1),0) AS refundable,
      COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='vendor_bill' AND dc.document_id=vb.id AND dc.refundable=0),0) AS otherCharges
    FROM vendor_bills vb JOIN business_partners bp ON bp.id=vb.vendor_id WHERE vb.status<>'void' AND substr(vb.invoice_date,1,10) BETWEEN ? AND ? ORDER BY vb.invoice_date,vb.number`, range.from, range.to);
  for (const bill of bills) {
    validateDocument(bill);
    const refundable=Number(bill.refundable??0),otherCharges=Number(bill.otherCharges??0),items=bill.subtotal-refundable-otherCharges;
    const itemBase=base(items,bill.exchange),refundableBase=base(refundable,bill.exchange),otherBase=base(otherCharges,bill.exchange),taxBase=base(bill.tax,bill.exchange);
    if(itemBase) rows.push(splitLine(bill,"vendor_bill","Inventory clearing",itemBase,items,"debit"));
    if(refundableBase) rows.push(splitLine(bill,"vendor_bill","Refundable returnable deposits receivable",refundableBase,refundable,"debit"));
    if(otherBase) rows.push(splitLine(bill,"vendor_bill","Landed cost clearing",otherBase,otherCharges,"debit"));
    if(taxBase) rows.push(splitLine(bill,"vendor_bill","Recoverable tax",taxBase,bill.tax,"debit"));
    addRoundingLine(rows,bill,"vendor_bill",bill.baseTotal-itemBase-refundableBase-otherBase-taxBase,"debit");
    rows.push(line(bill,"vendor_bill","Accounts payable",0,bill.baseTotal,bill.total));
  }
  const invoices = await all<DocumentRow>(`SELECT ci.id,ci.number,ci.invoice_date AS postingDate,ci.subtotal_cents AS subtotal,ci.tax_cents AS tax,ci.total_cents AS total,ci.base_total_cents AS baseTotal,ci.currency,ci.exchange_rate_to_base AS exchange,bp.name AS partnerName,
      COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='customer_invoice' AND dc.document_id=ci.id AND dc.refundable=1),0) AS refundable,
      COALESCE((SELECT SUM(CASE WHEN dc.direction='subtract' THEN -dc.amount_cents ELSE dc.amount_cents END) FROM document_charges dc WHERE dc.document_type='customer_invoice' AND dc.document_id=ci.id AND dc.refundable=0),0) AS otherCharges
    FROM customer_invoices ci JOIN business_partners bp ON bp.id=ci.customer_id WHERE ci.status<>'void' AND substr(ci.invoice_date,1,10) BETWEEN ? AND ? ORDER BY ci.invoice_date,ci.number`, range.from, range.to);
  for (const invoice of invoices) {
    validateDocument(invoice);
    const refundable=Number(invoice.refundable??0),otherCharges=Number(invoice.otherCharges??0),items=invoice.subtotal-refundable-otherCharges;
    const itemBase=base(items,invoice.exchange),refundableBase=base(refundable,invoice.exchange),otherBase=base(otherCharges,invoice.exchange),taxBase=base(invoice.tax,invoice.exchange);
    rows.push(line(invoice,"customer_invoice","Accounts receivable",invoice.baseTotal,0,invoice.total));
    if(itemBase) rows.push(splitLine(invoice,"customer_invoice","Sales revenue",itemBase,items,"credit"));
    if(refundableBase) rows.push(splitLine(invoice,"customer_invoice","Refundable returnable deposits payable",refundableBase,refundable,"credit"));
    if(otherBase) rows.push(splitLine(invoice,"customer_invoice","Distribution fees revenue",otherBase,otherCharges,"credit"));
    if(taxBase) rows.push(splitLine(invoice,"customer_invoice","Tax payable",taxBase,invoice.tax,"credit"));
    addRoundingLine(rows,invoice,"customer_invoice",invoice.baseTotal-itemBase-refundableBase-otherBase-taxBase,"credit");
  }
  const credits=await all<Record<string,unknown>>(`SELECT vc.posted_at AS postingDate,'vendor_credit' AS kind,vc.id,vc.number,vc.amount_cents AS amount,vc.base_amount_cents AS base,vc.currency,vc.exchange_rate_to_base AS exchange,bp.name AS partnerName FROM vendor_credits vc JOIN business_partners bp ON bp.id=vc.vendor_id WHERE vc.status='posted' AND substr(vc.posted_at,1,10) BETWEEN ? AND ? UNION ALL SELECT cc.posted_at,'customer_credit',cc.id,cc.number,cc.amount_cents,cc.base_amount_cents,cc.currency,cc.exchange_rate_to_base,bp.name FROM customer_credits cc JOIN business_partners bp ON bp.id=cc.customer_id WHERE cc.status='posted' AND substr(cc.posted_at,1,10) BETWEEN ? AND ?`,range.from,range.to,range.from,range.to);
  for(const credit of credits){const d:DocumentRow={id:String(credit.id),number:String(credit.number),postingDate:String(credit.postingDate),subtotal:Number(credit.amount),tax:0,total:Number(credit.amount),baseTotal:Number(credit.base),currency:String(credit.currency),exchange:Number(credit.exchange),partnerName:String(credit.partnerName??"")};validateDocument(d);if(credit.kind==="vendor_credit"){rows.push(line(d,"vendor_credit","Accounts payable",d.baseTotal,0,d.total),line(d,"vendor_credit","Purchase returns / allowances",0,d.baseTotal,d.total));}else{rows.push(line(d,"customer_credit","Sales returns / allowances",d.baseTotal,0,d.total),line(d,"customer_credit","Accounts receivable",0,d.baseTotal,d.total));}}
  const payments=await all<Record<string,unknown>>("SELECT p.id,p.number,p.direction,p.document_type AS documentType,p.document_id AS documentId,p.payment_date AS postingDate,p.amount_cents AS amount,p.base_amount_cents AS base,p.currency,p.exchange_rate_to_base AS exchange,bp.name AS partnerName FROM payments p JOIN business_partners bp ON bp.id=p.partner_id WHERE substr(p.payment_date,1,10) BETWEEN ? AND ? ORDER BY p.payment_date,p.number",range.from,range.to);
  for(const payment of payments){
    const d:DocumentRow={id:String(payment.id),number:String(payment.number),postingDate:String(payment.postingDate),subtotal:Number(payment.amount),tax:0,total:Number(payment.amount),baseTotal:Number(payment.base),currency:String(payment.currency),exchange:Number(payment.exchange),partnerName:String(payment.partnerName??"")};
    validateDocument(d);
    if(payment.documentType==="returnable_deposit"){
      if(payment.direction==="inbound") rows.push(line(d,"returnable_deposit_refund","Cash",d.baseTotal,0,d.total),line(d,"returnable_deposit_refund","Refundable returnable deposits receivable",0,d.baseTotal,d.total));
      else rows.push(line(d,"returnable_deposit_refund","Refundable returnable deposits payable",d.baseTotal,0,d.total),line(d,"returnable_deposit_refund","Cash",0,d.baseTotal,d.total));
    } else if(payment.direction==="inbound") rows.push(line(d,"payment","Cash",d.baseTotal,0,d.total),line(d,"payment","Accounts receivable",0,d.baseTotal,d.total));
    else rows.push(line(d,"payment","Accounts payable",d.baseTotal,0,d.total),line(d,"payment","Cash",0,d.baseTotal,d.total));
  }
  const values=await all<Record<string,unknown>>("SELECT ive.id,ive.posted_at AS postingDate,ive.entry_type AS entryType,ive.reference_type AS referenceType,ive.reference_id AS referenceId,ive.value_cents AS value,ive.quantity,ive.cost_method AS costMethod,p.sku FROM inventory_value_entries ive JOIN products p ON p.id=ive.product_id WHERE substr(ive.posted_at,1,10) BETWEEN ? AND ? ORDER BY ive.posted_at,ive.id",range.from,range.to);
  for(const value of values){
    const amount=Math.abs(Number(value.value));if(!amount)continue;
    const d:DocumentRow={id:String(value.id),number:String(value.id),postingDate:String(value.postingDate),subtotal:amount,tax:0,total:amount,baseTotal:amount,currency:"BASE",exchange:1};
    const entryType=String(value.entryType);
    const accounts = entryType === "receipt" ? ["Inventory", "Inventory clearing"]
      : entryType === "receipt_reversal" ? ["Inventory clearing", "Inventory"]
      : entryType === "vendor_return" ? ["Vendor return clearing", "Inventory"]
      : entryType === "shipment" ? ["Cost of goods sold", "Inventory"]
      : entryType === "shipment_reversal" || entryType === "customer_return" ? ["Inventory", "Cost of goods sold"]
      : entryType === "scrap" ? ["Inventory scrap expense", "Inventory"]
      : entryType === "inventory_adjustment_loss" ? ["Inventory adjustment expense", "Inventory"]
      : entryType === "inventory_adjustment_gain" ? ["Inventory", "Inventory adjustment gain"]
      : entryType === "migration_opening_balance" || entryType === "opening_balance" ? ["Inventory", "Opening balance equity"]
      : Number(value.value)>0 ? ["Inventory", "Inventory clearing"] : ["Inventory adjustment expense", "Inventory"];
    rows.push(line(d,"inventory_value_entry",accounts[0],amount,0,amount),line(d,"inventory_value_entry",accounts[1],0,amount,amount));
  }
  const landed=await all<Record<string,unknown>>("SELECT id,number,posted_at AS postingDate,amount_cents AS amount FROM landed_cost_allocations WHERE substr(posted_at,1,10) BETWEEN ? AND ? ORDER BY posted_at,number",range.from,range.to);
  for(const entry of landed){const d:DocumentRow={id:String(entry.id),number:String(entry.number),postingDate:String(entry.postingDate),subtotal:Number(entry.amount),tax:0,total:Number(entry.amount),baseTotal:Number(entry.amount),currency:"BASE",exchange:1};rows.push(line(d,"landed_cost","Inventory",d.baseTotal,0,d.total),line(d,"landed_cost","Landed cost accrual",0,d.baseTotal,d.total));}
  const obligations = await all<ReturnableObligationRow>(`SELECT
    ro.id,
    COALESCE((SELECT MAX(re.posted_at) FROM returnable_events re WHERE re.obligation_id=ro.id),ro.created_at) AS postingDate,
    ro.partner_id AS partnerId,bp.name AS partnerName,
    ro.asset_type_id AS assetTypeId,rat.code AS assetCode,rat.name AS assetName,
    ro.direction,ro.issued_qty AS issued,ro.returned_qty AS returned,ro.forfeited_qty AS forfeited,
    ro.deposit_charged_cents AS depositCharged,ro.deposit_refunded_cents AS depositRefunded,
    COALESCE((SELECT SUM(re.amount_cents) FROM returnable_events re WHERE re.obligation_id=ro.id AND re.event_type='forfeit'),0) AS forfeitedAmount,
    ro.status
    FROM returnable_obligations ro
    JOIN business_partners bp ON bp.id=ro.partner_id
    JOIN returnable_asset_types rat ON rat.id=ro.asset_type_id
    WHERE substr(COALESCE((SELECT MAX(re.posted_at) FROM returnable_events re WHERE re.obligation_id=ro.id),ro.created_at),1,10) BETWEEN ? AND ?
    ORDER BY postingDate,ro.id`,range.from,range.to);
  for (const obligation of obligations) {
    const customerHolds = obligation.direction === "customer_holds";
    const outstandingQuantity = Number(obligation.issued)-Number(obligation.returned)-Number(obligation.forfeited);
    const depositBalance = Number(obligation.depositCharged)-Number(obligation.depositRefunded)-Number(obligation.forfeitedAmount);
    const obligationReference = `returnable_obligation:${obligation.id}`;
    rows.push(
      returnableLine({
        postingDate: obligation.postingDate,
        documentType: "returnable_obligation",
        documentNumber: obligation.id,
        sourceId: obligation.id,
        rowClass: "returnable_asset_balance",
        accountingClass: "custody_quantity_only",
        reference: `${obligationReference}:asset_balance`,
        parentReference: obligationReference,
        partnerId: obligation.partnerId,
        assetTypeId: obligation.assetTypeId,
        assetCode: obligation.assetCode,
        direction: obligation.direction,
        quantity: outstandingQuantity,
        status: obligation.status,
        memo: `${obligation.assetName}; ${obligation.partnerName}; outstanding custody quantity as of the latest event.`,
        account: customerHolds ? "Returnable assets in customer custody" : "Vendor returnable assets in our custody",
      }),
      returnableLine({
        postingDate: obligation.postingDate,
        documentType: "returnable_obligation",
        documentNumber: obligation.id,
        sourceId: obligation.id,
        rowClass: "returnable_deposit_balance",
        accountingClass: customerHolds ? "refundable_deposit_liability" : "refundable_deposit_asset",
        reference: `${obligationReference}:deposit_balance`,
        parentReference: obligationReference,
        partnerId: obligation.partnerId,
        assetTypeId: obligation.assetTypeId,
        assetCode: obligation.assetCode,
        direction: obligation.direction,
        balanceCents: depositBalance,
        status: obligation.status,
        memo: `${obligation.assetName}; ${obligation.partnerName}; ${returnableCurrencyMemo}`,
        account: customerHolds ? "Refundable returnable deposits payable" : "Refundable returnable deposits receivable",
      }),
    );
  }
  const returnableEvents = await all<ReturnableEventRow>(`SELECT
    re.id,re.obligation_id AS obligationId,re.posted_at AS postingDate,re.event_type AS eventType,
    re.quantity,re.amount_cents AS amount,re.reason,re.posted_by AS postedBy,
    ro.partner_id AS partnerId,bp.name AS partnerName,
    ro.asset_type_id AS assetTypeId,rat.code AS assetCode,rat.name AS assetName,ro.direction
    FROM returnable_events re
    JOIN returnable_obligations ro ON ro.id=re.obligation_id
    JOIN business_partners bp ON bp.id=ro.partner_id
    JOIN returnable_asset_types rat ON rat.id=ro.asset_type_id
    WHERE substr(re.posted_at,1,10) BETWEEN ? AND ?
    ORDER BY re.posted_at,re.id`,range.from,range.to);
  for (const event of returnableEvents) {
    const customerHolds = event.direction === "customer_holds";
    const depositClass = customerHolds ? "refundable_deposit_liability" : "refundable_deposit_asset";
    const accountingClass = event.eventType === "forfeit"
      ? customerHolds ? "forfeiture_revenue_candidate" : "forfeiture_expense_candidate"
      : event.eventType === "return" ? "custody_quantity_only" : depositClass;
    const eventSemantic = event.eventType === "issue" ? "custody_issued_deposit_increase"
      : event.eventType === "return" ? "custody_returned_deposit_pending"
      : event.eventType === "forfeit" ? "custody_forfeited_deposit_released"
      : event.eventType === "deposit_refund" ? "deposit_refunded_after_return"
      : `custody_${event.eventType}`;
    const quantity = event.eventType === "issue" ? Number(event.quantity)
      : ["return", "forfeit"].includes(event.eventType) ? -Number(event.quantity) : 0;
    const balanceDelta = event.eventType === "issue" ? Number(event.amount)
      : ["forfeit", "deposit_refund"].includes(event.eventType) ? -Number(event.amount) : 0;
    const obligationReference = `returnable_obligation:${event.obligationId}`;
    rows.push(returnableLine({
      postingDate: event.postingDate,
      documentType: "returnable_event",
      documentNumber: event.id,
      sourceId: event.id,
      rowClass: "returnable_custody_event",
      accountingClass,
      reference: `returnable_event:${event.id}`,
      parentReference: obligationReference,
      partnerId: event.partnerId,
      assetTypeId: event.assetTypeId,
      assetCode: event.assetCode,
      eventType: event.eventType,
      eventSemantic,
      direction: event.direction,
      quantity,
      balanceDeltaCents: balanceDelta,
      eventAmountCents: Number(event.amount),
      memo: `${event.assetName}; ${event.partnerName}; ${event.reason}; ${returnableCurrencyMemo}`,
      postedBy: event.postedBy,
      account: "Returnable custody and deposit event memorandum",
    }));
    if (event.eventType === "forfeit" && Number(event.amount) > 0) {
      const financialEvent: DocumentRow = { id:event.id,number:event.id,postingDate:event.postingDate,subtotal:Number(event.amount),tax:0,total:Number(event.amount),baseTotal:Number(event.amount),currency:"BASE",exchange:1,partnerName:event.partnerName };
      if (customerHolds) rows.push(
        line(financialEvent,"returnable_forfeit","Refundable returnable deposits payable",Number(event.amount),0,Number(event.amount)),
        line(financialEvent,"returnable_forfeit","Forfeited returnable deposit revenue",0,Number(event.amount),Number(event.amount)),
      );
      else rows.push(
        line(financialEvent,"returnable_forfeit","Forfeited returnable deposit expense",Number(event.amount),0,Number(event.amount)),
        line(financialEvent,"returnable_forfeit","Refundable returnable deposits receivable",0,Number(event.amount),Number(event.amount)),
      );
    }
  }
  rows.sort((a,b)=>String(a.posting_date).localeCompare(String(b.posting_date))||String(a.document_number).localeCompare(String(b.document_number))||String(a.account).localeCompare(String(b.account)));
  return rows;
}

async function quickBooksRows(range: ExportRange) {
  const journalRows = (await accountingRows(range)).filter((row) => row.row_class === "journal_entry");
  const balances = new Map<string, number>();
  for (const row of journalRows) {
    const key = `${row.document_type}:${row.source_id}`;
    balances.set(key, (balances.get(key) ?? 0) + Number(row.debit_cents) - Number(row.credit_cents));
  }
  const unbalanced = [...balances.entries()].find(([, balance]) => balance !== 0);
  if (unbalanced) throw new Error(`QuickBooks export blocked because ${unbalanced[0]} is not balanced.`);
  const dollars = (cents: unknown) => Number(cents) ? (Number(cents) / 100).toFixed(2) : "";
  return journalRows.map((row) => ({
    "Journal No.": row.document_number,
    "Journal Date": String(row.posting_date).slice(0, 10),
    "Account Name": row.account,
    Description: `${row.document_type} ${row.document_number} · PaneFlow ${row.source_id}`,
    Debits: dollars(row.debit_cents),
    Credits: dollars(row.credit_cents),
    Name: row.partner_reference,
    Class: "",
    Location: "",
    "PaneFlow Source ID": row.source_id,
    "PaneFlow Source Type": row.source_type,
  }));
}

async function assertLocationIntegrityForExport() {
  const integrity = await first<{ balanceRows: number; movementRows: number; locationIds: string }>(`SELECT
    (SELECT COUNT(*) FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL) AS balanceRows,
    (SELECT COUNT(*) FROM stock_movements sm LEFT JOIN locations fl ON fl.id=sm.from_location_id LEFT JOIN locations tl ON tl.id=sm.to_location_id WHERE (sm.from_location_id IS NOT NULL AND fl.id IS NULL) OR (sm.to_location_id IS NOT NULL AND tl.id IS NULL)) AS movementRows,
    (SELECT GROUP_CONCAT(location_id,', ') FROM (SELECT ib.location_id AS location_id FROM inventory_balances ib LEFT JOIN locations l ON l.id=ib.location_id WHERE l.id IS NULL UNION SELECT sm.from_location_id FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.from_location_id WHERE sm.from_location_id IS NOT NULL AND l.id IS NULL UNION SELECT sm.to_location_id FROM stock_movements sm LEFT JOIN locations l ON l.id=sm.to_location_id WHERE sm.to_location_id IS NOT NULL AND l.id IS NULL)) AS locationIds`);
  const affected = Number(integrity?.balanceRows ?? 0) + Number(integrity?.movementRows ?? 0);
  if (affected > 0) throw new Error(`Export blocked: ${affected} inventory record${affected === 1 ? "" : "s"} reference missing location IDs (${integrity?.locationIds || "unknown"}). Restore those legacy locations in Controls before exporting.`);
}

export async function buildExport(type: ExportType, actor: ActorIdentity, range?: ExportRange) {
  await ensureDatabase();
  if ((type === "accounting" || type === "quickbooks") && !range) throw new Error("Accounting exports require a bounded from/to date range.");
  if (["inventory", "movements", "accounting", "quickbooks"].includes(type)) await assertLocationIntegrityForExport();
  const rows = type === "accounting" ? await accountingRows(range!) : type === "quickbooks" ? await quickBooksRows(range!) : await all<Record<string, unknown>>(queries[type]);
  const when = new Date().toISOString();
  const metadata={ type,rowCount:rows.length,role:actor.role,range };
  await getD1().batch([
    getD1().prepare(`INSERT INTO audit_events (id,entity_type,entity_id,action,summary,actor,actor_id,actor_email,metadata_json,created_at) VALUES (?,'export',?,'export_generated',?,?,?,?,?,?)`).bind(newId("audit"),type,`${type} CSV export generated.`,actor.label,actor.id,actor.email,JSON.stringify(metadata),when),
    getD1().prepare(`INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json,status,attempts,available_at,created_at) VALUES (?,'export.generated','export',?,?,'pending',0,?,?)`).bind(newId("outbox"),type,JSON.stringify(metadata),when,when),
  ]);
  return { body: csv(rows), rowCount: rows.length };
}
