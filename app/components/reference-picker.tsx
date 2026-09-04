"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { NumberField } from "./number-field";
import { AddressAutocomplete } from "./address-autocomplete";
import { useDialogDismiss } from "./use-dialog-dismiss";

export type PickerOption = {
  id: string; label: string; detail?: string; version?: number; status?: string; data?: Record<string, unknown>;
  // Carried so a just-created partner can populate a ship-to block without a round trip.
  addressLine1?: string; addressLine2?: string; city?: string; region?: string; postalCode?: string; country?: string;
  currency?: string; paymentTerms?: string;
  // Credit standing travels with the chosen partner so the composer can keep showing it. In the
  // option list alone it vanished the moment the customer was picked.
  creditHold?: boolean; creditLimitCents?: number;
};

/** Lists longer than this get a type-to-filter combobox instead of a native select. */
export const SEARCHABLE_THRESHOLD = 5;

export type QuickCreateKind = "customer" | "vendor" | "partner" | "product" | "location" | "uom" | "priceList" | "assetType";

/** Server-searched reference tables. Mirrors REFERENCE_LOOKUPS in lib/server/inventory-domain. */
export type LookupKind =
  | "products" | "partners" | "locations" | "warehouses" | "uoms" | "priceLists" | "priceListAssignments" | "priceListEntries" | "assetTypes"
  | "salesOrders" | "purchaseOrders" | "salesOrderLines" | "purchaseOrderLines"
  | "customerInvoices" | "vendorBills" | "costLayers" | "partnerAddresses" | "inventoryLots" | "inventoryUnits";

type RawLookupItem = Record<string, unknown>;
type LookupCacheEntry = { expiresAt: number; items: RawLookupItem[] };

// A picker is opened repeatedly while an order is entered. Keep the last few server results in
// memory so returning to the same customer, vendor, or item search is instant. The short lifetime
// still lets live price and availability changes flow through without turning browser state into
// an authoritative copy of inventory.
const LOOKUP_CACHE_TTL_MS = 30_000;
const LOOKUP_CACHE_LIMIT = 100;
const lookupCache = new Map<string, LookupCacheEntry>();
const lookupRequests = new Map<string, Promise<RawLookupItem[]>>();

function cachedLookupItems(key: string) {
  const cached = lookupCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) { lookupCache.delete(key); return undefined; }
  // Refresh insertion order so the least-recently used result is discarded first.
  lookupCache.delete(key);
  lookupCache.set(key, cached);
  return cached.items;
}

function storeLookupItems(key: string, items: RawLookupItem[]) {
  lookupCache.set(key, { items, expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS });
  while (lookupCache.size > LOOKUP_CACHE_LIMIT) {
    const oldest = lookupCache.keys().next().value as string | undefined;
    if (!oldest) break;
    lookupCache.delete(oldest);
  }
}

async function fetchLookupItems(params: URLSearchParams) {
  const key = params.toString();
  const cached = cachedLookupItems(key);
  if (cached) return cached;
  const pending = lookupRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store" });
    const raw = await response.json() as { items?: RawLookupItem[]; error?: { message?: string } };
    if (!response.ok) throw new Error(raw.error?.message ?? "Reference lookup unavailable.");
    const items = raw.items ?? [];
    storeLookupItems(key, items);
    return items;
  })();
  lookupRequests.set(key, request);
  try { return await request; }
  finally { if (lookupRequests.get(key) === request) lookupRequests.delete(key); }
}

const quickCreateLookupKind: Record<QuickCreateKind, LookupKind> = {
  customer: "partners", vendor: "partners", partner: "partners", product: "products", location: "locations",
  uom: "uoms", priceList: "priceLists", assetType: "assetTypes",
};

function invalidateLookupKind(kind: LookupKind) {
  const prefix = `lookup=${encodeURIComponent(kind)}&`;
  for (const key of lookupCache.keys()) if (key.startsWith(prefix)) lookupCache.delete(key);
}

/** Offered anywhere an order, bill, or partner records terms, so the lists cannot drift apart. */
export const PAYMENT_TERMS = ["Due on receipt", "Net 15", "Net 30", "Net 45", "Net 60"];

const quickCreateLabels: Record<QuickCreateKind, string> = {
  customer: "New customer",
  vendor: "New vendor",
  partner: "New customer / vendor",
  product: "New product",
  location: "New location",
  uom: "New unit of measure",
  priceList: "New price list",
  assetType: "New returnable asset type",
};

/** The viewer's capability flags, as the snapshot reports them. */
export type PickerPermissions = { canOperate?: boolean; canPostFinancial?: boolean; canApprove?: boolean; canAdminister?: boolean };

/**
 * Which capability each inline create command needs. Mirrors `workflowCapabilities` in
 * lib/server/advanced-domain: createBusinessPartner / createProduct / createLocation /
 * createReturnableAssetType need "approve"; units and price lists need "administer". Offering
 * "+ New customer" to an operator only moved the refusal to a server error after they had
 * keyed the whole record.
 */
const quickCreateCapability: Record<QuickCreateKind, keyof PickerPermissions> = {
  customer: "canApprove", vendor: "canApprove", partner: "canApprove", product: "canApprove", location: "canApprove", assetType: "canApprove",
  uom: "canAdminister", priceList: "canAdminister",
};

/** Set once at the application root so every picker beneath it knows what the viewer may create. */
export const PickerPermissionsContext = createContext<PickerPermissions | undefined>(undefined);

export function quickCreatePermitted(kind: QuickCreateKind | undefined, permissions: PickerPermissions | undefined): kind is QuickCreateKind {
  if (!kind) return false;
  return permissions?.[quickCreateCapability[kind]] === true;
}

/** The permissions a picker consults: an explicit prop wins over the root context. */
function usePickerPermissions(explicit?: PickerPermissions) {
  const fromContext = useContext(PickerPermissionsContext);
  return explicit ?? fromContext;
}

/** The name assistive technology reads for an option row: the label, then the detail. */
function optionName(label: string, detail?: string) {
  return detail ? `${label}, ${detail}` : label;
}

/**
 * Arrow / Enter / Escape handling shared by both pickers. Rows are addressed by index so the
 * inline "create new" and "use what I typed" actions are reachable from the keyboard like any
 * other option — order entry at this volume is a typing job, not a pointing job.
 */
function useListboxKeys({ open, setOpen, count, choose, preferred }: { open: boolean; setOpen: (open: boolean) => void; count: number; choose: (index: number) => void; preferred?: number }) {
  const [active, setActive] = useState(0);
  // Whether the highlight has been moved on purpose since the list last changed. Until it has,
  // Enter takes `preferred` (the "Use what I typed" row) over the first partial match.
  const [navigated, setNavigated] = useState(false);
  const [listSignature, setListSignature] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // Adjusted during render rather than in an effect: filtering to three rows while the cursor
  // sits on row nine must not paint one frame with the cursor off the end of the list.
  const signature = `${open}:${count}`;
  if (listSignature !== signature) { setListSignature(signature); setActive(0); setNavigated(false); }
  useEffect(() => { if (open) listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  const highlight = (index: number) => { setActive(index); setNavigated(true); };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      if (count) highlight((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" && open && count) {
      // Without this the surrounding order form submits instead of taking the highlighted row,
      // and a quick-create dialog listening for Enter would post its half-filled record.
      event.preventDefault();
      event.stopPropagation();
      choose(preferred != null && !navigated ? preferred : active);
    } else if (event.key === "Escape" && open) {
      // The key belongs to the list: closing it must not also close the dialog behind it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if ((event.key === "Home" || event.key === "End") && open && count) {
      event.preventDefault();
      highlight(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Tab") setOpen(false);
  };
  return { active, setActive: highlight, listRef, onKeyDown };
}

/**
 * Select over a known option array. Renders a native select for short lists and a
 * filterable listbox once the list can realistically outgrow a glance. Both forms can
 * offer an inline "create new" action so a missing record never dead-ends the task.
 */
export function SearchableSelect({ label, value, options, setValue, disabled = false, quickCreate, onCreated, placeholder, hideLabel = false, className, allowCustom = false, required = allowCustom, permissions }: {
  label: string;
  value: string;
  options: PickerOption[];
  setValue: (value: string, option?: PickerOption) => void;
  disabled?: boolean;
  quickCreate?: QuickCreateKind;
  onCreated?: () => void | Promise<void>;
  placeholder?: string;
  /** Compact contexts (a filter toolbar) carry their own heading, so the label goes to assistive tech only. */
  hideLabel?: boolean;
  className?: string;
  /** Keeps a typed value that matches no option. Reason lists can never enumerate a real day. */
  allowCustom?: boolean;
  /** Makes required choices visible and exposes their requirement to assistive technology. Typed custom values are reasons in this app and therefore required by default. */
  required?: boolean;
  /** The viewer's capabilities; defaults to the PickerPermissionsContext set at the app root. */
  permissions?: PickerPermissions;
}) {
  const listboxId = useId();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === value);
  // Only offered when the viewer can actually post the create command.
  const offerCreate = quickCreatePermitted(quickCreate, usePickerPermissions(permissions)) ? quickCreate : undefined;
  const searchable = options.length > SEARCHABLE_THRESHOLD || Boolean(offerCreate) || allowCustom;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 50);
    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [options, query]);
  const term = query.trim();
  const exact = term ? options.find((option) => option.label.toLowerCase() === term.toLowerCase()) : undefined;
  const custom = allowCustom && term && !exact ? term : "";
  const rows = filtered.length + (custom ? 1 : 0) + (offerCreate ? 1 : 0);

  const created = async (option: PickerOption) => { setCreating(false); setValue(option.id, option); setQuery(""); setOpen(false); await onCreated?.(); };
  const choose = (index: number) => {
    setOpen(false);
    if (index < filtered.length) { setQuery(""); return setValue(filtered[index].id, filtered[index]); }
    if (custom && index === filtered.length) { setQuery(""); return setValue(custom); }
    if (offerCreate) setCreating(true);
  };
  /**
   * A typed reason used to survive only if the "Use …" row was picked. Clicking the submit
   * button instead blurred the field and lost it, so the command posted with the old reason
   * or none. Whatever is typed when focus leaves (or Escape closes the list) is the value.
   */
  const commitTyped = () => {
    if (!allowCustom || !open) return;
    if (exact) setValue(exact.id, exact);
    else if (custom) setValue(custom);
  };
  // Enter takes the typed text itself while it matches no option exactly, rather than whichever
  // partial match happened to sort first.
  const { active, setActive, listRef, onKeyDown } = useListboxKeys({ open, setOpen, count: rows, choose, preferred: custom ? filtered.length : undefined });

  if (!searchable) {
    return <label className={className}>{hideLabel ? <span className="sr-only">{label}</span> : <span>{label}{required ? <span className="required-mark" aria-hidden="true"> *</span> : null}</span>}<select value={value} onChange={(event) => setValue(event.target.value, options.find((option) => option.id === event.target.value))} disabled={disabled} required={required} aria-required={required || undefined}>
      {/* Only prompt when nothing is chosen yet. Controls that always carry a value — a
          sort order, a filter defaulting to "All" — would otherwise show a dead first row. */}
      {selected ? null : <option value="" disabled>{options.length ? `Select ${label.toLowerCase()}` : "No records available"}</option>}
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>;
  }

  // aria-label is explicit: the row sits inside the field's <label>, and the tree read it as a
  // bare "option" with no name.
  const row = (index: number, key: string, className: string, children: ReactNode, isSelected: boolean, name: string) => <button
    type="button" role="option" key={key} id={`${listboxId}-row-${index}`} className={className}
    data-active={index === active} aria-selected={isSelected} aria-label={name}
    onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}
  >{children}</button>;

  return <><label className={`reference-search ${className ?? ""}`}>{hideLabel ? <span className="sr-only">{label}</span> : <span>{label}{required ? <span className="required-mark" aria-hidden="true"> *</span> : null}</span>}
    <input
      role="combobox"
      value={open ? query : selected?.label ?? (allowCustom ? value : "")}
      disabled={disabled}
      placeholder={placeholder ?? `Search ${label.toLowerCase()}`}
      autoComplete="off"
      aria-controls={listboxId}
      aria-expanded={open}
      aria-autocomplete="list"
      aria-activedescendant={open && rows ? `${listboxId}-row-${active}` : undefined}
      required={required}
      aria-required={required || undefined}
      onFocus={() => { setQuery(""); setOpen(true); }}
      onBlur={() => { commitTyped(); window.setTimeout(() => setOpen(false), 140); }}
      onKeyDown={(event) => { if (event.key === "Escape") commitTyped(); onKeyDown(event); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
    />
    {open ? <div id={listboxId} ref={listRef} className="reference-results" role="listbox" aria-label={label}>
      {filtered.map((option, index) => row(index, option.id, "", <><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</>, option.id === value, optionName(option.label, option.detail)))}
      {!filtered.length && !custom ? <span className="reference-status">No matching records</span> : null}
      {custom ? row(filtered.length, "custom", "reference-create", <>Use “{custom}”</>, false, `Use “${custom}”`) : null}
      {offerCreate ? row(rows - 1, "create", "reference-create", <>+ {quickCreateLabels[offerCreate]}</>, false, quickCreateLabels[offerCreate]) : null}
    </div> : null}
  </label>
  {creating && offerCreate ? <QuickCreateDialog kind={offerCreate} onClose={() => setCreating(false)} onCreated={created} /> : null}</>;
}

/**
 * Server-backed picker for the tables too large to ship to the browser. Opening it always
 * lists the first page rather than re-searching whatever is already selected.
 */
export function RemoteSearchSelect({ kind, role, partnerId, productId, lineId, locationId, quantity, warehouseId, currency, exchangeRateToBase, label, placeholder, value, valueLabel, initialOptions, onSelect, quickCreate, mapItem, hideLabel, required = false, onCreated, permissions }: {
  kind: LookupKind;
  role?: string;
  partnerId?: string;
  productId?: string;
  lineId?: string;
  locationId?: string;
  quantity?: number;
  warehouseId?: string;
  currency?: string;
  exchangeRateToBase?: number;
  label?: string;
  placeholder: string;
  value: string;
  /** Shown for a value set programmatically that no fetched option has described yet. */
  valueLabel?: string;
  initialOptions: PickerOption[];
  onSelect: (option: PickerOption) => void;
  quickCreate?: QuickCreateKind;
  mapItem: (item: Record<string, unknown>) => PickerOption;
  hideLabel?: boolean;
  required?: boolean;
  onCreated?: () => void | Promise<void>;
  /** The viewer's capabilities; defaults to the PickerPermissionsContext set at the app root. */
  permissions?: PickerPermissions;
}) {
  const listboxId = useId();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PickerOption[]>(initialOptions.slice(0, 25));
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [known, setKnown] = useState<Record<string, PickerOption>>(() => Object.fromEntries(initialOptions.map((option) => [option.id, option])));
  const mapRef = useRef(mapItem);
  const fallbackRef = useRef(initialOptions);
  const offerCreate = quickCreatePermitted(quickCreate, usePickerPermissions(permissions)) ? quickCreate : undefined;
  // A value chosen elsewhere (a product's sales unit, a rule's price list) is not necessarily on
  // any page this picker has fetched; the caller's own label keeps the field from reading blank.
  const selectedLabel = known[value]?.label ?? initialOptions.find((option) => option.id === value)?.label ?? (value ? valueLabel ?? "" : "");

  // Both kept in refs: callers build these inline, so a fresh identity on every parent render
  // would otherwise restart the lookup — a refetch per keystroke in a neighbouring field.
  useEffect(() => { mapRef.current = mapItem; fallbackRef.current = initialOptions; });

  const lookupParams = (nextQuery: string) => {
    const params = new URLSearchParams({ lookup: kind, q: nextQuery, limit: "25" });
    if (role) params.set("role", role);
    if (partnerId) params.set("partnerId", partnerId);
    if (productId) params.set("productId", productId);
    if (lineId) params.set("lineId", lineId);
    if (locationId) params.set("locationId", locationId);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (kind === "products") {
      params.set("quantity", String(Math.max(quantity ?? 1, 1)));
      if (currency) params.set("currency", currency);
      if (exchangeRateToBase != null) params.set("exchangeRateToBase", String(exchangeRateToBase));
    }
    return params;
  };

  useEffect(() => {
    if (!open) return;
    let current = true;
    const params = lookupParams(query);
    const cached = cachedLookupItems(params.toString());
    const fallback = query.trim() ? [] : fallbackRef.current.slice(0, 25);
    if (cached) {
      const mapped = cached.map((item) => mapRef.current(item));
      setOptions(mapped);
      setLookupError("");
      setLoading(false);
      setKnown((knownOptions) => ({ ...knownOptions, ...Object.fromEntries(mapped.map((option) => [option.id, option])) }));
      return;
    }
    if (fallback.length) { setOptions(fallback); setLoading(false); }
    else setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const mapped = (await fetchLookupItems(params)).map((item) => mapRef.current(item));
        if (current) {
          setOptions(mapped);
          setLookupError("");
          setKnown((knownOptions) => ({ ...knownOptions, ...Object.fromEntries(mapped.map((option) => [option.id, option])) }));
        }
      } catch (error) {
        if (current) {
          setOptions(fallbackRef.current.slice(0, 25));
          setLookupError(error instanceof Error ? error.message : "Reference lookup unavailable.");
        }
      } finally {
        // A superseded request must not clear the pending state of the newer query.
        if (current) setLoading(false);
      }
    }, query.trim() ? 120 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [currency, exchangeRateToBase, kind, lineId, locationId, open, partnerId, productId, quantity, query, role, warehouseId]);

  const beginLookup = (nextQuery: string) => {
    const cached = cachedLookupItems(lookupParams(nextQuery).toString());
    const fallback = nextQuery.trim() ? [] : fallbackRef.current.slice(0, 25);
    if (cached) setOptions(cached.map((item) => mapRef.current(item)));
    else if (fallback.length) setOptions(fallback);
    setQuery(nextQuery);
    setLookupError("");
    setLoading(!cached && !fallback.length);
    setOpen(true);
  };

  const choose = (option: PickerOption) => { setKnown((current) => ({ ...current, [option.id]: option })); onSelect(option); setOpen(false); };
  const rows = loading ? 0 : options.length + (offerCreate ? 1 : 0);
  const chooseRow = (index: number) => { if (index < options.length) return choose(options[index]); if (!offerCreate) return; setOpen(false); setCreating(true); };
  const { active, setActive, listRef, onKeyDown } = useListboxKeys({ open, setOpen, count: rows, choose: chooseRow });
  const row = (index: number, key: string, className: string, children: ReactNode, isSelected: boolean, name: string) => <button
    type="button" role="option" key={key} id={`${listboxId}-row-${index}`} className={className}
    data-active={index === active} aria-selected={isSelected} aria-label={name}
    onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseRow(index)}
  >{children}</button>;

  const field = <div className="reference-search">
    <input
      role="combobox"
      value={open ? query : selectedLabel}
      placeholder={placeholder}
      autoComplete="off"
      aria-controls={listboxId}
      aria-expanded={open}
      aria-autocomplete="list"
      aria-activedescendant={open && rows ? `${listboxId}-row-${active}` : undefined}
      aria-label={hideLabel ? label : undefined}
      required={required}
      aria-required={required || undefined}
      onFocus={() => beginLookup("")}
      onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      onKeyDown={onKeyDown}
      onChange={(event) => beginLookup(event.target.value)}
    />
    {open ? <div id={listboxId} ref={listRef} className="reference-results" role="listbox" aria-label={label ?? placeholder} aria-busy={loading}>
      {loading ? <span className="reference-status">Searching…</span> : options.map((option, index) => row(index, option.id, "", <><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</>, option.id === value, optionName(option.label, option.detail)))}
      {!loading && lookupError ? <span className="reference-status" role="alert">{lookupError} Type again to retry.</span> : null}
      {!loading && !lookupError && !options.length ? <span className="reference-status">No matching active records</span> : null}
      {offerCreate && !loading ? row(rows - 1, "create", "reference-create", <>+ {quickCreateLabels[offerCreate]}</>, false, quickCreateLabels[offerCreate]) : null}
    </div> : null}
  </div>;

  return <>{label && !hideLabel ? <label className="reference-field"><span>{label}{required ? <span className="required-mark" aria-hidden="true"> *</span> : null}</span>{field}</label> : field}
    {creating && offerCreate ? <QuickCreateDialog kind={offerCreate} onClose={() => setCreating(false)} onCreated={async (option) => { invalidateLookupKind(quickCreateLookupKind[offerCreate]); choose(option); setCreating(false); await onCreated?.(); }} /> : null}</>;
}

/** Minimal create form for the records people discover they are missing mid-task. */
export function QuickCreateDialog({ kind, companyReorderPercent, submitLabel = "Create and use", onClose, onCreated }: { kind: QuickCreateKind; companyReorderPercent?: number; submitLabel?: string; onClose: () => void; onCreated: (option: PickerOption) => void | Promise<void> }) {
  const isPartner = kind === "customer" || kind === "vendor" || kind === "partner";
  // Master records with no dependent lookups of their own; they need only their own fields.
  const isSimpleMaster = kind === "uom" || kind === "priceList" || kind === "assetType";
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState("quantity");
  const [precision, setPrecision] = useState(0);
  const [currency, setCurrency] = useState("CAD");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [priority, setPriority] = useState(0);
  const [assetClass, setAssetClass] = useState("");
  const [deposit, setDeposit] = useState(0);
  const [partnerType, setPartnerType] = useState(kind === "vendor" ? "vendor" : kind === "customer" ? "customer" : "customer");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("CA");
  const [cost, setCost] = useState(0);
  const [price, setPrice] = useState(0);
  const [manufacturerSku, setManufacturerSku] = useState("");
  const [category, setCategory] = useState("");
  const [material, setMaterial] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [finish, setFinish] = useState("");
  const [trackingPolicy, setTrackingPolicy] = useState("quantity");
  const [inventoryPolicy, setInventoryPolicy] = useState("stocked");
  const [reorderPoint, setReorderPoint] = useState(0);
  const [maxStockLevel, setMaxStockLevel] = useState(0);
  const [reorderRuleMode, setReorderRuleMode] = useState<"manual" | "global" | "custom">(companyReorderPercent == null ? "manual" : "global");
  const [reorderRulePercent, setReorderRulePercent] = useState(companyReorderPercent ?? 70);
  const [uomId, setUomId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("usable");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useDialogDismiss(onClose, busy);
  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  /**
   * Every field the server will reject the record without, named the way the labels name them.
   * This drives both the disabled state and the hint beneath the buttons, so the button is
   * never dark for a reason the reader has to guess at.
   */
  const missingFields = [
    ...(!code.trim() ? [kind === "product" ? "SKU" : "code"] : []),
    ...(!name.trim() ? ["name"] : []),
    ...(kind === "product" ? [
      ...(!uomId ? ["unit of measure"] : []),
      ...(!category.trim() ? ["category"] : []),
      ...(!material.trim() ? ["material"] : []),
      ...(!dimensions.trim() ? ["dimensions"] : []),
      ...(!finish.trim() ? ["finish"] : []),
    ] : []),
    ...(kind === "location" && !warehouseId ? ["warehouse"] : []),
  ];
  const activeReorderPercent = reorderRuleMode === "global" ? companyReorderPercent ?? 70 : reorderRulePercent;
  const effectiveReorderPoint = reorderRuleMode === "manual" ? reorderPoint : Math.round(maxStockLevel * activeReorderPercent * 10) / 1000;

  const submit = async () => {
    if (missingFields.length) return setError(`Enter the ${missingFields.join(", ")} before creating this record.`);
    if (kind === "product" && inventoryPolicy === "stocked" && maxStockLevel < effectiveReorderPoint) return setError("Maximum stock must be at least the reorder point.");
    if (kind === "product" && reorderRuleMode === "custom" && (reorderRulePercent <= 0 || reorderRulePercent > 100)) return setError("Enter a custom percentage greater than 0 and no more than 100.");
    setError(""); setBusy(true);
    const idempotencyKey = crypto.randomUUID();
    const command = isPartner ? "createBusinessPartner"
      : kind === "product" ? "createProduct"
      : kind === "uom" ? "createUnitOfMeasure"
      : kind === "priceList" ? "createPriceList"
      : kind === "assetType" ? "createReturnableAssetType"
      : "createLocation";
    const payload = isPartner
      ? { code, name, partnerType, email, phone, currency, paymentTerms, addressLine1, addressLine2, city, region, postalCode, country, creditLimitCents: 0, creditHold: false }
      : kind === "product"
        ? { sku: code, manufacturerSku, name, category, material, dimensions, finish, trackingPolicy, inventoryPolicy, standardCostCents: Math.round(cost * 100), sellingPriceCents: Math.round(price * 100), reorderPoint: effectiveReorderPoint, maxStockLevel, reorderRuleMode, reorderRulePercent: reorderRuleMode === "custom" ? reorderRulePercent : undefined, baseUomId: uomId, purchaseUomId: uomId, salesUomId: uomId }
      : kind === "uom" ? { code, name, dimension, precision }
      : kind === "priceList" ? { code, name, currency, priority }
      : kind === "assetType" ? { code, name, assetClass: assetClass.trim() || name, unitDepositCents: Math.round(deposit * 100) }
        : { code, name, warehouseId, locationType: inventoryStatus === "quarantine" ? "quarantine" : "storage", inventoryStatus };
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, payload }) });
      const result = await response.json() as { recordId?: string; error?: string | { message?: string } };
      if (!response.ok || !result.recordId) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The record could not be created.");
      await onCreated({ id: result.recordId, label: kind === "product" || isSimpleMaster ? `${code} · ${name}` : name, detail: isPartner ? `${code} · ${partnerType}` : code, ...(isPartner ? { addressLine1, addressLine2, city, region, postalCode, country, currency, paymentTerms } : {}) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The record could not be created."); }
    finally { setBusy(false); }
  };

  const field = (labelText: string, node: ReactNode, required = false) => <label><span>{labelText}{required ? <span className="required-mark" aria-hidden="true"> *</span> : null}</span>{node}</label>;

  return <div className="modal-overlay quick-create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={`Create ${kind}`}>
      <div className="dialog-header"><h2>{quickCreateLabels[kind]}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
      {/* Deliberately not a <form>: this dialog opens from inside the order composer's form,
          and a nested form submits the outer one instead of posting the new record. */}
      <div onKeyDown={(event) => { if (event.key === "Enter" && !busy) { event.preventDefault(); void submit(); } }}>
        {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
        <div className="command-form form-grid">
          {field(kind === "product" ? "SKU" : "Code", <input ref={firstFieldRef} value={code} onChange={(event) => setCode(event.target.value)} required aria-required="true" />, true)}
          {field("Name", <input value={name} onChange={(event) => setName(event.target.value)} required aria-required="true" />, true)}
          {kind === "partner" ? field("Type", <select value={partnerType} onChange={(event) => setPartnerType(event.target.value)}><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select>) : null}
          {isPartner ? <>
            {field("Currency", <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select>)}
            {field("Payment terms", <select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select>)}
            {field("Email", <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />)}
            {field("Phone", <input value={phone} onChange={(event) => setPhone(event.target.value)} />)}
            {field("Street address", <AddressAutocomplete value={addressLine1} country={country} onChange={setAddressLine1} onAddressSelected={(selected) => { setAddressLine1(selected.addressLine1); setAddressLine2(selected.addressLine2); setCity(selected.city); setRegion(selected.region); setPostalCode(selected.postalCode); setCountry(selected.country || country); }} />)}
            {field("Address line 2", <input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} autoComplete="address-line2" />)}
            {field("City", <input value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" />)}
            {field("Province / region", <input value={region} onChange={(event) => setRegion(event.target.value)} autoComplete="address-level1" />)}
            {field("Postal code", <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} autoComplete="postal-code" />)}
            {field("Country", <input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} autoComplete="country" />)}
          </> : null}
          {kind === "product" ? <>
            {/* Routed through the picker rather than a bare select: both tables grow with the
                business and are past a glance long before anyone notices. */}
            <RemoteSearchSelect kind="uoms" label="Unit of measure" placeholder="Search active units" value={uomId} initialOptions={[]} required onSelect={(option) => setUomId(option.id)} mapItem={(item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: `${String(item.dimension)} · precision ${String(item.precision)}` })} />
            {field("Manufacturer SKU (optional)", <input value={manufacturerSku} onChange={(event) => setManufacturerSku(event.target.value)} />)}
            {field("Category", <input value={category} onChange={(event) => setCategory(event.target.value)} required />, true)}
            {field("Material", <input value={material} onChange={(event) => setMaterial(event.target.value)} required />, true)}
            {field("Dimensions / configuration", <input value={dimensions} onChange={(event) => setDimensions(event.target.value)} required />, true)}
            {field("Finish", <input value={finish} onChange={(event) => setFinish(event.target.value)} required />, true)}
            {field("Tracking policy", <select value={trackingPolicy} onChange={(event) => setTrackingPolicy(event.target.value)}><option value="quantity">Quantity</option><option value="lot">Lot</option><option value="serial">Serial</option></select>)}
            {field("Inventory policy", <select value={inventoryPolicy} onChange={(event) => setInventoryPolicy(event.target.value)}><option value="stocked">Stocked</option><option value="special_order">Special order</option><option value="drop_ship">Drop ship</option></select>)}
            <div className="replenishment-create-heading full-field"><strong>Max stock &amp; reorder point</strong><small>Set the target stock level, then choose when purchasing should reorder.</small></div>
            {field("Maximum stock level", <NumberField min="0" step="0.001" value={maxStockLevel} onChange={setMaxStockLevel} />)}
            {field("Reorder method", <select value={reorderRuleMode} onChange={(event) => setReorderRuleMode(event.target.value as "manual" | "global" | "custom")}><option value="manual">Enter a quantity manually</option>{companyReorderPercent != null ? <option value="global">Use company rule ({companyReorderPercent}% of max)</option> : null}<option value="custom">Use a custom percentage</option></select>)}
            {reorderRuleMode === "manual" ? field("Reorder point", <NumberField min="0" max={maxStockLevel} step="0.001" value={reorderPoint} onChange={setReorderPoint} />) : reorderRuleMode === "custom" ? field("Custom percentage of max", <NumberField min="0.1" max="100" step="0.1" value={reorderRulePercent} onChange={setReorderRulePercent} />) : null}
            <div className="reorder-preview compact full-field"><span>Resulting reorder point</span><strong>{effectiveReorderPoint}</strong><small>{reorderRuleMode === "manual" ? "Manual quantity" : `${activeReorderPercent}% of ${maxStockLevel} maximum`}</small></div>
            {field("Standard cost", <NumberField min="0" step="0.01" value={cost} onChange={setCost} />)}
            {field("Selling price", <NumberField min="0" step="0.01" value={price} onChange={setPrice} />)}
          </> : null}
          {kind === "location" ? <>
            <RemoteSearchSelect kind="warehouses" label="Warehouse" placeholder="Search active warehouses" value={warehouseId} initialOptions={[]} required onSelect={(option) => setWarehouseId(option.id)} mapItem={(item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: String(item.timezone ?? "") })} />
            {field("Inventory status", <select value={inventoryStatus} onChange={(event) => setInventoryStatus(event.target.value)}><option value="usable">Usable</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option></select>)}
          </> : null}
          {kind === "uom" ? <>
            {field("Dimension", <select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="quantity">Quantity</option><option value="length">Length</option><option value="area">Area</option><option value="weight">Weight</option><option value="volume">Volume</option></select>)}
            {field("Decimal precision", <NumberField min="0" max="3" step="1" value={precision} onChange={setPrecision} />)}
          </> : null}
          {kind === "priceList" ? <>
            {field("Currency", <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select>)}
            {field("Priority", <NumberField min="0" step="1" value={priority} onChange={setPriority} />)}
          </> : null}
          {kind === "assetType" ? <>
            {field("Asset class", <input value={assetClass} onChange={(event) => setAssetClass(event.target.value)} placeholder="Rack, core, stillage, crate…" />)}
            {field("Unit deposit", <NumberField min="0" step="0.01" value={deposit} onChange={setDeposit} />)}
          </> : null}
        </div>
        {/* Naming what is still missing. The button used to grey out with no explanation, and
            the `required` attributes above never fired because this is deliberately not a form,
            so the two fields that identify the record were not checked at all. */}
        {missingFields.length ? <p className="read-only-label">Still needed: {missingFields.join(", ")}.</p> : null}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="button primary" onClick={() => void submit()} disabled={busy || missingFields.length > 0}>{busy ? "Creating…" : submitLabel}</button></div>
      </div>
    </section>
  </div>;
}
