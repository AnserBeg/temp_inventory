"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export type PickerOption = {
  id: string; label: string; detail?: string; version?: number; status?: string; data?: Record<string, unknown>;
  // Carried so a just-created partner can populate a ship-to block without a round trip.
  addressLine1?: string; addressLine2?: string; city?: string; region?: string; postalCode?: string; country?: string;
  currency?: string; paymentTerms?: string;
};

/** Lists longer than this get a type-to-filter combobox instead of a native select. */
export const SEARCHABLE_THRESHOLD = 5;

export type QuickCreateKind = "customer" | "vendor" | "partner" | "product" | "location" | "uom" | "priceList" | "assetType";

/** Server-searched reference tables. Mirrors REFERENCE_LOOKUPS in lib/server/inventory-domain. */
export type LookupKind =
  | "products" | "partners" | "locations" | "warehouses" | "uoms" | "priceLists" | "priceListAssignments" | "priceListEntries" | "assetTypes"
  | "salesOrders" | "purchaseOrders" | "salesOrderLines" | "purchaseOrderLines"
  | "customerInvoices" | "vendorBills" | "costLayers" | "partnerAddresses";

/** Offered anywhere an order, bill, or partner records terms, so the lists cannot drift apart. */
export const PAYMENT_TERMS = ["Due on receipt", "Net 15", "Net 30", "Net 45", "Net 60"];

const quickCreateLabels: Record<QuickCreateKind, string> = {
  customer: "New customer",
  vendor: "New vendor",
  partner: "New vendor / customer",
  product: "New product",
  location: "New location",
  uom: "New unit of measure",
  priceList: "New price list",
  assetType: "New returnable asset type",
};

/**
 * Arrow / Enter / Escape handling shared by both pickers. Rows are addressed by index so the
 * inline "create new" and "use what I typed" actions are reachable from the keyboard like any
 * other option — order entry at this volume is a typing job, not a pointing job.
 */
function useListboxKeys({ open, setOpen, count, choose }: { open: boolean; setOpen: (open: boolean) => void; count: number; choose: (index: number) => void }) {
  const [active, setActive] = useState(0);
  const [listSignature, setListSignature] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // Adjusted during render rather than in an effect: filtering to three rows while the cursor
  // sits on row nine must not paint one frame with the cursor off the end of the list.
  const signature = `${open}:${count}`;
  if (listSignature !== signature) { setListSignature(signature); setActive(0); }
  useEffect(() => { if (open) listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      if (count) setActive((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" && open && count) {
      // Without this the surrounding order form submits instead of taking the highlighted row.
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if ((event.key === "Home" || event.key === "End") && open && count) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Tab") setOpen(false);
  };
  return { active, setActive, listRef, onKeyDown };
}

/**
 * Select over a known option array. Renders a native select for short lists and a
 * filterable listbox once the list can realistically outgrow a glance. Both forms can
 * offer an inline "create new" action so a missing record never dead-ends the task.
 */
export function SearchableSelect({ label, value, options, setValue, disabled = false, quickCreate, onCreated, placeholder, hideLabel = false, className, allowCustom = false }: {
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
}) {
  const listboxId = useId();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === value);
  const searchable = options.length > SEARCHABLE_THRESHOLD || Boolean(quickCreate) || allowCustom;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 50);
    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(term)).slice(0, 50);
  }, [options, query]);
  const term = query.trim();
  const custom = allowCustom && term && !options.some((option) => option.label.toLowerCase() === term.toLowerCase()) ? term : "";
  const rows = filtered.length + (custom ? 1 : 0) + (quickCreate ? 1 : 0);

  const created = async (option: PickerOption) => { setCreating(false); setValue(option.id, option); setQuery(""); setOpen(false); await onCreated?.(); };
  const choose = (index: number) => {
    setOpen(false);
    if (index < filtered.length) { setQuery(""); return setValue(filtered[index].id, filtered[index]); }
    if (custom && index === filtered.length) { setQuery(""); return setValue(custom); }
    setCreating(true);
  };
  const { active, setActive, listRef, onKeyDown } = useListboxKeys({ open, setOpen, count: rows, choose });

  if (!searchable) {
    return <label className={className}>{hideLabel ? <span className="sr-only">{label}</span> : <span>{label}</span>}<select value={value} onChange={(event) => setValue(event.target.value, options.find((option) => option.id === event.target.value))} disabled={disabled} required>
      {/* Only prompt when nothing is chosen yet. Controls that always carry a value — a
          sort order, a filter defaulting to "All" — would otherwise show a dead first row. */}
      {selected ? null : <option value="" disabled>{options.length ? `Select ${label.toLowerCase()}` : "No records available"}</option>}
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>;
  }

  const row = (index: number, key: string, className: string, children: ReactNode, isSelected: boolean) => <button
    type="button" role="option" key={key} id={`${listboxId}-row-${index}`} className={className}
    data-active={index === active} aria-selected={isSelected}
    onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}
  >{children}</button>;

  return <><label className={`reference-search ${className ?? ""}`}>{hideLabel ? <span className="sr-only">{label}</span> : <span>{label}</span>}
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
      onFocus={() => { setQuery(""); setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      onKeyDown={onKeyDown}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
    />
    {open ? <div id={listboxId} ref={listRef} className="reference-results" role="listbox">
      {filtered.map((option, index) => row(index, option.id, "", <><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</>, option.id === value))}
      {!filtered.length && !custom ? <span className="reference-status">No matching records</span> : null}
      {custom ? row(filtered.length, "custom", "reference-create", <>Use “{custom}”</>, false) : null}
      {quickCreate ? row(rows - 1, "create", "reference-create", <>+ {quickCreateLabels[quickCreate]}</>, false) : null}
    </div> : null}
  </label>
  {creating && quickCreate ? <QuickCreateDialog kind={quickCreate} onClose={() => setCreating(false)} onCreated={created} /> : null}</>;
}

/**
 * Server-backed picker for the tables too large to ship to the browser. Opening it always
 * lists the first page rather than re-searching whatever is already selected.
 */
export function RemoteSearchSelect({ kind, role, partnerId, quantity, warehouseId, currency, exchangeRateToBase, label, placeholder, value, initialOptions, onSelect, quickCreate, mapItem, hideLabel, onCreated }: {
  kind: LookupKind;
  role?: string;
  partnerId?: string;
  quantity?: number;
  warehouseId?: string;
  currency?: string;
  exchangeRateToBase?: number;
  label?: string;
  placeholder: string;
  value: string;
  initialOptions: PickerOption[];
  onSelect: (option: PickerOption) => void;
  quickCreate?: QuickCreateKind;
  mapItem: (item: Record<string, unknown>) => PickerOption;
  hideLabel?: boolean;
  onCreated?: () => void | Promise<void>;
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
  const selectedLabel = known[value]?.label ?? initialOptions.find((option) => option.id === value)?.label ?? "";

  // Both kept in refs: callers build these inline, so a fresh identity on every parent render
  // would otherwise restart the lookup — a refetch per keystroke in a neighbouring field.
  useEffect(() => { mapRef.current = mapItem; fallbackRef.current = initialOptions; });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ lookup: kind, q: query, limit: "25" });
        if (role) params.set("role", role);
        if (partnerId) params.set("partnerId", partnerId);
        if (warehouseId) params.set("warehouseId", warehouseId);
        if (kind === "products") {
          params.set("quantity", String(Math.max(quantity ?? 1, 1)));
          if (currency) params.set("currency", currency);
          if (exchangeRateToBase != null) params.set("exchangeRateToBase", String(exchangeRateToBase));
        }
        const response = await fetch(`/api/snapshot?${params}`, { cache: "no-store", signal: controller.signal });
        const raw = await response.json() as { items?: Array<Record<string, unknown>>; error?: { message?: string } };
        if (!response.ok) throw new Error(raw.error?.message ?? "Reference lookup unavailable.");
        const mapped = (raw.items ?? []).map((item) => mapRef.current(item));
        setOptions(mapped);
        setLookupError("");
        setKnown((current) => ({ ...current, ...Object.fromEntries(mapped.map((option) => [option.id, option])) }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setOptions(fallbackRef.current.slice(0, 25));
          setLookupError(error instanceof Error ? error.message : "Reference lookup unavailable.");
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [currency, exchangeRateToBase, kind, open, partnerId, quantity, query, role, warehouseId]);

  const choose = (option: PickerOption) => { setKnown((current) => ({ ...current, [option.id]: option })); onSelect(option); setOpen(false); };
  const rows = loading ? 0 : options.length + (quickCreate ? 1 : 0);
  const chooseRow = (index: number) => { if (index < options.length) return choose(options[index]); setOpen(false); setCreating(true); };
  const { active, setActive, listRef, onKeyDown } = useListboxKeys({ open, setOpen, count: rows, choose: chooseRow });
  const row = (index: number, key: string, className: string, children: ReactNode, isSelected: boolean) => <button
    type="button" role="option" key={key} id={`${listboxId}-row-${index}`} className={className}
    data-active={index === active} aria-selected={isSelected}
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
      onFocus={() => { setQuery(""); setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 140)}
      onKeyDown={onKeyDown}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
    />
    {open ? <div id={listboxId} ref={listRef} className="reference-results" role="listbox">
      {loading ? <span className="reference-status">Searching…</span> : options.map((option, index) => row(index, option.id, "", <><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</>, option.id === value))}
      {!loading && lookupError ? <span className="reference-status" role="alert">{lookupError} Type again to retry.</span> : null}
      {!loading && !lookupError && !options.length ? <span className="reference-status">No matching active records</span> : null}
      {quickCreate && !loading ? row(rows - 1, "create", "reference-create", <>+ {quickCreateLabels[quickCreate]}</>, false) : null}
    </div> : null}
  </div>;

  return <>{label && !hideLabel ? <label className="reference-field"><span>{label}</span>{field}</label> : field}
    {creating && quickCreate ? <QuickCreateDialog kind={quickCreate} onClose={() => setCreating(false)} onCreated={async (option) => { choose(option); setCreating(false); await onCreated?.(); }} /> : null}</>;
}

/** Minimal create form for the records people discover they are missing mid-task. */
export function QuickCreateDialog({ kind, onClose, onCreated }: { kind: QuickCreateKind; onClose: () => void; onCreated: (option: PickerOption) => void | Promise<void> }) {
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
  const [uomId, setUomId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("usable");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);

  const submit = async () => {
    if (!code.trim() || !name.trim()) return setError("Enter a code and a name.");
    if (kind === "product" && (!uomId || !category.trim() || !material.trim() || !dimensions.trim() || !finish.trim())) return setError("Complete the product classification, material, configuration, finish, and unit of measure.");
    setError(""); setBusy(true);
    const idempotencyKey = crypto.randomUUID();
    const command = isPartner ? "createBusinessPartner"
      : kind === "product" ? "createProduct"
      : kind === "uom" ? "createUnitOfMeasure"
      : kind === "priceList" ? "createPriceList"
      : kind === "assetType" ? "createReturnableAssetType"
      : "createLocation";
    const payload = isPartner
      ? { code, name, partnerType, email, phone, currency, paymentTerms, addressLine1, city, region, postalCode, country, creditLimitCents: 0, creditHold: false }
      : kind === "product"
        ? { sku: code, manufacturerSku, name, category, material, dimensions, finish, trackingPolicy, inventoryPolicy, standardCostCents: Math.round(cost * 100), sellingPriceCents: Math.round(price * 100), reorderPoint, baseUomId: uomId, purchaseUomId: uomId, salesUomId: uomId }
      : kind === "uom" ? { code, name, dimension, precision }
      : kind === "priceList" ? { code, name, currency, priority }
      : kind === "assetType" ? { code, name, assetClass: assetClass.trim() || name, unitDepositCents: Math.round(deposit * 100) }
        : { code, name, warehouseId, locationType: inventoryStatus === "quarantine" ? "quarantine" : "storage", inventoryStatus };
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ command, idempotencyKey, payload }) });
      const result = await response.json() as { recordId?: string; error?: string | { message?: string } };
      if (!response.ok || !result.recordId) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The record could not be created.");
      await onCreated({ id: result.recordId, label: kind === "product" || isSimpleMaster ? `${code} · ${name}` : name, detail: isPartner ? `${code} · ${partnerType}` : code, ...(isPartner ? { addressLine1, city, region, postalCode, country, currency, paymentTerms } : {}) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The record could not be created."); }
    finally { setBusy(false); }
  };

  const field = (labelText: string, node: ReactNode) => <label><span>{labelText}</span>{node}</label>;

  return <div className="modal-overlay quick-create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="command-dialog quick-create-dialog" role="dialog" aria-modal="true" aria-label={`Create ${kind}`}>
      <div className="dialog-header"><h2>{quickCreateLabels[kind]}</h2><button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button></div>
      {/* Deliberately not a <form>: this dialog opens from inside the order composer's form,
          and a nested form submits the outer one instead of posting the new record. */}
      <div onKeyDown={(event) => { if (event.key === "Enter" && !busy) { event.preventDefault(); void submit(); } }}>
        {error ? <div className="error-summary" role="alert"><p>{error}</p></div> : null}
        <div className="command-form form-grid">
          {field(kind === "product" ? "SKU" : "Code", <input value={code} onChange={(event) => setCode(event.target.value)} />)}
          {field("Name", <input value={name} onChange={(event) => setName(event.target.value)} />)}
          {kind === "partner" ? field("Type", <select value={partnerType} onChange={(event) => setPartnerType(event.target.value)}><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select>) : null}
          {isPartner ? <>
            {field("Currency", <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select>)}
            {field("Payment terms", <select value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)}>{PAYMENT_TERMS.map((term) => <option key={term}>{term}</option>)}</select>)}
            {field("Email", <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />)}
            {field("Phone", <input value={phone} onChange={(event) => setPhone(event.target.value)} />)}
            {field("Address", <input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />)}
            {field("City", <input value={city} onChange={(event) => setCity(event.target.value)} />)}
            {field("Province / region", <input value={region} onChange={(event) => setRegion(event.target.value)} />)}
            {field("Postal code", <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} />)}
            {field("Country", <input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} />)}
          </> : null}
          {kind === "product" ? <>
            {/* Routed through the picker rather than a bare select: both tables grow with the
                business and are past a glance long before anyone notices. */}
            <RemoteSearchSelect kind="uoms" label="Unit of measure" placeholder="Search active units" value={uomId} initialOptions={[]} onSelect={(option) => setUomId(option.id)} mapItem={(item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: `${String(item.dimension)} · precision ${String(item.precision)}` })} />
            {field("Manufacturer SKU (optional)", <input value={manufacturerSku} onChange={(event) => setManufacturerSku(event.target.value)} />)}
            {field("Category", <input value={category} onChange={(event) => setCategory(event.target.value)} required />)}
            {field("Material", <input value={material} onChange={(event) => setMaterial(event.target.value)} required />)}
            {field("Dimensions / configuration", <input value={dimensions} onChange={(event) => setDimensions(event.target.value)} required />)}
            {field("Finish", <input value={finish} onChange={(event) => setFinish(event.target.value)} required />)}
            {field("Tracking policy", <select value={trackingPolicy} onChange={(event) => setTrackingPolicy(event.target.value)}><option value="quantity">Quantity</option><option value="lot">Lot</option><option value="serial">Serial</option></select>)}
            {field("Inventory policy", <select value={inventoryPolicy} onChange={(event) => setInventoryPolicy(event.target.value)}><option value="stocked">Stocked</option><option value="special_order">Special order</option><option value="drop_ship">Drop ship</option></select>)}
            {field("Reorder point", <input type="number" min="0" step="0.001" value={reorderPoint} onChange={(event) => setReorderPoint(Number(event.target.value))} />)}
            {field("Standard cost", <input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} />)}
            {field("Selling price", <input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))} />)}
          </> : null}
          {kind === "location" ? <>
            <RemoteSearchSelect kind="warehouses" label="Warehouse" placeholder="Search active warehouses" value={warehouseId} initialOptions={[]} onSelect={(option) => setWarehouseId(option.id)} mapItem={(item) => ({ id: String(item.id), label: `${String(item.code)} · ${String(item.name)}`, detail: String(item.timezone ?? "") })} />
            {field("Inventory status", <select value={inventoryStatus} onChange={(event) => setInventoryStatus(event.target.value)}><option value="usable">Usable</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option></select>)}
          </> : null}
          {kind === "uom" ? <>
            {field("Dimension", <select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="quantity">Quantity</option><option value="length">Length</option><option value="area">Area</option><option value="weight">Weight</option><option value="volume">Volume</option></select>)}
            {field("Decimal precision", <input type="number" min="0" max="3" step="1" value={precision} onChange={(event) => setPrecision(Number(event.target.value))} />)}
          </> : null}
          {kind === "priceList" ? <>
            {field("Currency", <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>CAD</option><option>USD</option><option>EUR</option></select>)}
            {field("Priority", <input type="number" min="0" step="1" value={priority} onChange={(event) => setPriority(Number(event.target.value))} />)}
          </> : null}
          {kind === "assetType" ? <>
            {field("Asset class", <input value={assetClass} onChange={(event) => setAssetClass(event.target.value)} placeholder="Rack, core, stillage, crate…" />)}
            {field("Unit deposit", <input type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(Number(event.target.value))} />)}
          </> : null}
        </div>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="button primary" onClick={() => void submit()} disabled={busy || (kind === "product" && (!uomId || !category.trim() || !material.trim() || !dimensions.trim() || !finish.trim())) || (kind === "location" && !warehouseId)}>{busy ? "Creating…" : "Create and use"}</button></div>
      </div>
    </section>
  </div>;
}
