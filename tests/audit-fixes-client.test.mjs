import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { localDatePlusDays, localDateString } from "../app/components/local-date.ts";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

// The client is JSX, which Node cannot import here, so behaviour that lives in components is
// pinned through the source text: each assertion names the exact construct the fix depends on.
const sources = {};
test.before(async () => {
  [sources.app, sources.suite, sources.picker, sources.dismiss, sources.counts, sources.email, sources.numberField, sources.css] = await Promise.all([
    read("../app/inventory-app.tsx"),
    read("../app/components/operations-suite.tsx"),
    read("../app/components/reference-picker.tsx"),
    read("../app/components/use-dialog-dismiss.ts"),
    read("../app/components/inventory-count-sessions.tsx"),
    read("../app/components/email-documents.tsx"),
    read("../app/components/number-field.tsx"),
    read("../app/globals.css"),
  ]);
});

test("today is the viewer's calendar date, never the UTC date (#17)", () => {
  // 23:30 local on the 31st is already the 1st in UTC for anyone west of Greenwich.
  assert.equal(localDateString(new Date(2026, 0, 31, 23, 30)), "2026-01-31");
  assert.equal(localDateString(new Date(2026, 11, 5, 0, 15)), "2026-12-05");
  assert.equal(localDatePlusDays(1, new Date(2026, 0, 31, 23, 30)), "2026-02-01");
  assert.equal(localDatePlusDays(7, new Date(2026, 1, 25, 9)), "2026-03-04");
  assert.match(localDateString(), /^\d{4}-\d{2}-\d{2}$/);

  for (const [name, source] of [["inventory-app", sources.app], ["operations-suite", sources.suite], ["inventory-count-sessions", sources.counts]]) {
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, `${name} still derives today from UTC`);
  }
  assert.match(sources.suite, /const today = \(\) => localDateString\(\);/);
  assert.match(sources.app, /asOf: localDateString\(\)/, "snapshot fetches must carry the viewer's local date");
});

test("movement counterparties follow the movement type (#6)", () => {
  assert.doesNotMatch(sources.app, /text\(item\.fromLocationCode, "External \/ Supplier"\)/);
  assert.doesNotMatch(sources.app, /text\(item\.toLocationCode, "External \/ Customer"\)/);
  assert.match(sources.app, /from: text\(item\.fromLocationCode\) \|\| movementCounterparty\(text\(item\.type\), "from"\)/);
  assert.match(sources.app, /customer_return: "External \/ Customer", shipment_reversal: "External \/ Customer"/);
  assert.match(sources.app, /receipt_reversal: "External \/ Supplier", vendor_return: "External \/ Supplier"/);
  assert.match(sources.app, /type\.includes\("scrap"\) \? "Scrap" : "Adjustment"/);
});

test("a purchase order with no expected date stays unset (#7)", () => {
  assert.match(sources.app, /const expectedDate = text\(item\.expectedDate\);/);
  assert.doesNotMatch(sources.app, /text\(item\.expectedDate, futureDate/);
  assert.match(sources.app, /const late = expectedDate && expectedDate < localDateString\(\) && open > 0/);
  assert.match(sources.app, /return value \? formatDocumentDate\(value\) : "Not set";/);
  // Blank cells sort last whichever way the column is sorted.
  assert.match(sources.app, /if \(leftBlank !== rightBlank\) return leftBlank \? 1 : -1;/);
});

test("numeric inputs can be cleared and retyped (#8)", () => {
  assert.match(sources.numberField, /export function NumberField\(/);
  assert.match(sources.numberField, /if \(text\.trim\(\) === ""\) return emptyValue;/);
  assert.match(sources.numberField, /onBlur=\{\(event: FocusEvent<HTMLInputElement>\) => \{ setDraft\(null\);/);
  // The snap-to-zero pattern is gone from every owned form except the two that keep string state.
  for (const [name, source] of [["operations-suite", sources.suite], ["reference-picker", sources.picker]]) {
    assert.doesNotMatch(source, /\bNumber\(event\.target\.value\)/, `${name} still binds a numeric input through Number(event.target.value)`);
  }
  const composer = sources.app.slice(sources.app.indexOf("function AdvancedCreateOrderDialog("), sources.app.indexOf("type CommandPanelProps"));
  assert.doesNotMatch(composer, /\bNumber\(event\.target\.value\)/);
  const commandFields = sources.app.slice(sources.app.indexOf("function CommandFields("), sources.app.indexOf("function ImpactPreview("));
  assert.doesNotMatch(commandFields, /\bNumber\(e(vent)?\.target\.value\)/);
});

test("Escape closes an open picker list, and only then the dialog (#9)", () => {
  assert.match(sources.dismiss, /if \(target\?\.closest\('\[aria-expanded="true"\]'\)\) return;/);
  assert.match(sources.picker, /event\.key === "Escape" && open\) \{\s*\/\/[^\n]*\n\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setOpen\(false\);/);
  // Only the last dialog on the stack hands the page its scrolling back.
  assert.match(sources.dismiss, /if \(!dismissStack\.length\) \{\s*document\.removeEventListener\("keydown", handleEscape, true\);\s*document\.body\.style\.overflow = pageOverflow;/);
});

test("the order composer validates every required field itself (#10)", () => {
  assert.match(sources.app, /<form ref=\{formRef\} onSubmit=\{submit\} noValidate>/);
  for (const field of ["partnerId", "shipToName", "shipToAddressLine1", "shipToCity", "shipToRegion", "shipToPostalCode", "shipToCountry", "date", "dueDate"]) {
    assert.match(sources.app, new RegExp(`data-field="${field}"`), `${field} is not addressable for focus`);
    assert.match(sources.app, new RegExp(`fieldError\\("${field}"\\)`), `${field} has no inline message`);
  }
  assert.match(sources.app, /if \(problems\.length\) \{ focusField\(problems\[0\]\.field\); return; \}/);
  assert.match(sources.app, /className="error-list"/);
  assert.match(sources.css, /\.required-mark \{/);
  // The activation forms and the command dialog no longer rely on native tooltips either.
  assert.match(sources.app, /<form className="draft-activation" onSubmit=\{submit\} noValidate>/);
  assert.match(sources.app, /<form className="draft-activation" onSubmit=\{confirm\} noValidate>/);
  assert.match(sources.app, /aria-label="Close dialog" onClick=\{onClose\}>×<\/button><\/div><form onSubmit=\{submit\} noValidate>/);
});

test("a line's configuration snapshot is the product, not its price hint (#11)", () => {
  assert.doesNotMatch(sources.app, /\$\{product\.label\} · \$\{product\.detail\}/);
  assert.match(sources.app, /configurationSnapshot: configurationSnapshotFor\(line\.productId\)/);
  assert.match(sources.app, /\[option\?\.dimensions \?\? catalog\?\.dimensions, option\?\.finish \?\? catalog\?\.finish, option\?\.material \?\? catalog\?\.material\]/);
});

test("rejected purchase orders can be edited and resubmitted (#16)", () => {
  assert.match(sources.app, /const isDraft = \["draft", "rejected"\]\.includes\(po\.lifecycle\.toLowerCase\(\)\);/);
  assert.match(sources.suite, /workflowStatusIs\(record\.status, "rejected"\) \? "Open to edit" : "Open"/);
  assert.match(sources.suite, /onOpenOrder\?: \(record: \{ id: string; number: string \}\) => void/);
});

test("permissions gate product editing, quick-create rows, and price allowances (#18)", () => {
  assert.doesNotMatch(sources.app, /onEdit=\{snapshot\.viewer\.permissions\.canAdminister \? \(\) => setEditingProduct/);
  assert.match(sources.app, /onEdit=\{snapshot\.viewer\.permissions\.canApprove \? \(\) => setEditingProduct/);
  assert.match(sources.counts, /canCreateProduct=\{canApprove\}/);
  assert.match(sources.picker, /customer: "canApprove", vendor: "canApprove", partner: "canApprove", product: "canApprove", location: "canApprove", assetType: "canApprove",\s*uom: "canAdminister", priceList: "canAdminister"/);
  assert.match(sources.picker, /const offerCreate = quickCreatePermitted\(quickCreate, usePickerPermissions\(permissions\)\) \? quickCreate : undefined;/);
  assert.match(sources.app, /<PickerPermissionsContext\.Provider value=\{snapshot\.viewer\.permissions\}>/);
  assert.match(sources.app, /const financialOnly = value === "allowance" && !canPostFinancial;/);
});

test("a fully shipped sales order offers no dead fulfillment buttons (#20)", () => {
  assert.match(sources.app, /const fulfillmentOpen = confirmed && so\.open > 0;/);
  assert.match(sources.app, /\{canShip \? <button className=\{canPostFinancial \? "button secondary" : "button primary"\} onClick=\{onShip\}>Post shipment<\/button> : null\}/);
  assert.match(sources.app, /\{canReserve \? <button className="button secondary" onClick=\{onReserve\} disabled=\{reserveBlocked\}/);
  assert.match(sources.app, /Fully shipped: no fulfillment actions remain\./);
});

test("multi-line receipts start at zero with a fill-all action (#22)", () => {
  assert.match(sources.app, /const startEmpty = openLines\.length > 1;/);
  assert.match(sources.app, /quantity: startEmpty \? 0 : fullOpenQuantity\(line\)/);
  assert.match(sources.app, /onClick=\{receiveAllOpenLines\}>Receive all open lines<\/button>/);
});

test("a typed custom reason survives blur and Enter (#24)", () => {
  assert.match(sources.picker, /const commitTyped = \(\) => \{\s*if \(!allowCustom \|\| !open\) return;\s*if \(exact\) setValue\(exact\.id, exact\);\s*else if \(custom\) setValue\(custom\);/);
  assert.match(sources.picker, /onBlur=\{\(\) => \{ commitTyped\(\); window\.setTimeout\(\(\) => setOpen\(false\), 140\); \}\}/);
  assert.match(sources.picker, /preferred: custom \? filtered\.length : undefined/);
  assert.match(sources.picker, /choose\(preferred != null && !navigated \? preferred : active\);/);
});

test("location types include Yard and vendor returns search stocked locations (#25, #13)", () => {
  assert.match(sources.suite, /\{ id: "yard", label: "Yard" \}/);
  assert.match(sources.app, /<ReferenceSearchSelect kind="locations" role="stocked" warehouseId=\{warehouseId\} value=\{postingLocationId\}/);
});

test("count sessions handle conflicts, rejections, and blind lines (#4, #35)", () => {
  assert.match(sources.counts, /expectedQuantity: number \| null;/);
  assert.match(sources.counts, /action\("refreshLine", \{ lineId: line\.id \}/);
  assert.match(sources.counts, /action\("cancelSession", \{\}/);
  assert.doesNotMatch(sources.counts, /session\.postedCount === 0 \? <button/);
  assert.match(sources.counts, /const locked = line\.status === "posted" \|\| \(Boolean\(line\.approvalId\) && !rejected\);/);
  assert.match(sources.counts, /const noVariance = bookKnown && Math\.abs\(Number\(variance \?\? 0\)\) < 0\.000001;/);
  assert.match(sources.counts, /\{bookKnown \? line\.expectedQuantity : "—"\}/);
});

test("lint-sensitive effects and dead code are gone (#28)", () => {
  assert.match(sources.email, /useEffect\(\(\) => \{ const timer = window\.setTimeout\(\(\) => void load\(\), 0\); return \(\) => window\.clearTimeout\(timer\); \}, \[load\]\);/);
  assert.doesNotMatch(sources.email, /void load\(\)\.catch\(/);
  assert.doesNotMatch(sources.app, /function CountsView\(/);
});

test("navigation and picker options carry accessible names (#38)", () => {
  assert.match(sources.app, /aria-label=\{item\.key === "expected-receipts" && snapshot\.summary\.lateReceipts > 0 \? `\$\{item\.label\}, \$\{snapshot\.summary\.lateReceipts\} late`/);
  assert.match(sources.picker, /data-active=\{index === active\} aria-selected=\{isSelected\} aria-label=\{name\}/);
});

test("counter sale keeps its idempotency key through a conflict (review item 7)", () => {
  assert.match(sources.app, /if \(typeof result\.error === "object" && result\.error\?\.code === "IDEMPOTENCY_CONFLICT"\) \{\s*setAlreadyPosted\(true\);/);
  assert.match(sources.app, /onClick=\{\(\) => \{ attemptKey\.current = ""; setAlreadyPosted\(false\); setError\(""\); setLines\(\[newLine\(\)\]\); \}\}>Start a new sale<\/button>/);
  // A quantity change no longer discards the chosen location, lot, and serial.
  assert.match(sources.app, /onChange=\{\(event\) => updateLine\(line\.id, \{ quantity: Number\(event\.target\.value\) \}\)\} required \/><\/label>/);
});
