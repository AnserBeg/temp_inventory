import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/server/exports.ts", import.meta.url), "utf8");

test("accounting export includes auditable returnable obligation balances", () => {
  assert.match(source, /FROM returnable_obligations ro/);
  assert.match(source, /JOIN business_partners bp ON bp\.id=ro\.partner_id/);
  assert.match(source, /JOIN returnable_asset_types rat ON rat\.id=ro\.asset_type_id/);
  assert.match(source, /returnable_asset_balance/);
  assert.match(source, /returnable_deposit_balance/);
  assert.match(source, /custody_quantity_only/);
  assert.match(source, /refundable_deposit_liability/);
  assert.match(source, /refundable_deposit_asset/);
  assert.match(source, /depositCharged\)-Number\(obligation\.depositRefunded\)-Number\(obligation\.forfeitedAmount/);
});

test("accounting export includes every immutable custody event and its financial semantics", () => {
  assert.match(source, /FROM returnable_events re/);
  assert.match(source, /rowClass: "returnable_custody_event"/);
  for (const eventType of ["issue", "return", "forfeit", "deposit_refund"]) {
    assert.match(source, new RegExp(`event\\.eventType === "${eventType}"|\\["[^\"]*${eventType}`));
  }
  assert.match(source, /custody_issued_deposit_increase/);
  assert.match(source, /custody_returned_deposit_pending/);
  assert.match(source, /custody_forfeited_deposit_released/);
  assert.match(source, /deposit_refunded_after_return/);
  assert.match(source, /forfeiture_revenue_candidate/);
  assert.match(source, /forfeiture_expense_candidate/);
});

test("returnable rows preserve references and do not masquerade as balanced GL entries", () => {
  for (const field of [
    "row_class",
    "accounting_class",
    "reference",
    "parent_reference",
    "partner_reference",
    "asset_reference",
    "balance_cents",
    "balance_delta_cents",
    "event_amount_cents",
  ]) assert.match(source, new RegExp(`${field}:`));
  assert.match(source, /reference: `returnable_event:\$\{event\.id\}`/);
  assert.match(source, /const obligationReference = `returnable_obligation:\$\{/);
  assert.match(source, /returnable deposits are denominated in CAD/);
  assert.match(source, /debit_cents: 0,\s+credit_cents: 0/);
});

test("QuickBooks export uses balanced journal import columns and stable PaneFlow references", () => {
  assert.match(source, /async function quickBooksRows/);
  assert.match(source, /"Journal No\."/);
  assert.match(source, /"Journal Date"/);
  assert.match(source, /"Account Name"/);
  assert.match(source, /Debits: dollars/);
  assert.match(source, /Credits: dollars/);
  assert.match(source, /"PaneFlow Source ID"/);
  assert.match(source, /not balanced/);
  for (const account of ["Inventory clearing", "Landed cost clearing", "Vendor return clearing", "Cost of goods sold", "Inventory scrap expense", "Inventory adjustment expense", "Opening balance equity", "Refundable returnable deposits payable", "Refundable returnable deposits receivable", "Distribution fees revenue", "Forfeited returnable deposit revenue"]) {
    assert.match(source, new RegExp(account));
  }
  assert.match(source, /payment\.documentType==="returnable_deposit_collection"/);
  assert.match(source, /payment\.documentType==="returnable_deposit_refund"/);
  assert.match(source, /document_charges dc WHERE dc\.document_type='customer_invoice'/);
});
