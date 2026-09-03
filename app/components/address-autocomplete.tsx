"use client";

import { useEffect, useRef, useState } from "react";
import { addressFieldsFromGoogleComponents, type AddressFields, type GoogleAddressComponent } from "@/lib/address-components";

type GooglePlace = {
  addressComponents?: GoogleAddressComponent[];
  fetchFields(options: { fields: string[] }): Promise<void>;
};

type GooglePlacePrediction = { toPlace(): GooglePlace };
type GooglePlaceSelectEvent = Event & { placePrediction?: GooglePlacePrediction };

type PlaceAutocompleteElement = HTMLElement & {
  value: string;
  placeholder: string;
  disabled: boolean;
  description?: string;
  includedPrimaryTypes?: string[];
  requestedLanguage?: string;
  requestedRegion?: string;
};

type PlaceAutocompleteConstructor = new (options?: Record<string, unknown>) => PlaceAutocompleteElement;
type PlacesLibrary = { PlaceAutocompleteElement: PlaceAutocompleteConstructor };
type GoogleMapsGlobal = { maps: { importLibrary(name: "places"): Promise<PlacesLibrary> } };

declare global {
  interface Window { google?: GoogleMapsGlobal }
}

let apiKeyPromise: Promise<string> | undefined;
let placesLibraryPromise: Promise<PlacesLibrary> | undefined;

async function googleMapsApiKey() {
  apiKeyPromise ??= fetch("/api/google-maps/config", { headers: { accept: "application/json" } })
    .then(async (response) => {
      const result = await response.json().catch(() => ({})) as { apiKey?: string | null; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Google address suggestions are unavailable.");
      return String(result.apiKey ?? "").trim();
    });
  return apiKeyPromise;
}

async function loadPlacesLibrary() {
  placesLibraryPromise ??= (async () => {
    if (window.google?.maps?.importLibrary) return window.google.maps.importLibrary("places");

    const apiKey = await googleMapsApiKey();
    if (!apiKey) throw new Error("Google address suggestions are not configured.");

    await new Promise<void>((resolve, reject) => {
      const callbackName = "__paneflowGoogleMapsReady";
      const browserWindow = window as unknown as Record<string, unknown>;
      browserWindow[callbackName] = () => {
        delete browserWindow[callbackName];
        resolve();
      };

      const parameters = new URLSearchParams({
        key: apiKey,
        loading: "async",
        libraries: "places",
        v: "weekly",
        callback: callbackName,
        auth_referrer_policy: "origin",
      });
      const script = document.createElement("script");
      script.async = true;
      script.dataset.paneflowGoogleMaps = "true";
      script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
      script.addEventListener("error", () => {
        delete browserWindow[callbackName];
        reject(new Error("Google address suggestions could not be loaded."));
      }, { once: true });
      document.head.appendChild(script);
    });

    if (!window.google?.maps?.importLibrary) throw new Error("Google address suggestions did not initialize.");
    return window.google.maps.importLibrary("places");
  })();
  return placesLibraryPromise;
}

function requestedRegion(country: string) {
  const normalized = country.trim().toUpperCase();
  if (normalized === "GB" || normalized === "UNITED KINGDOM") return "uk";
  if (normalized === "CA" || normalized === "CANADA") return "ca";
  if (normalized === "US" || normalized === "USA" || normalized === "UNITED STATES") return "us";
  return /^[A-Z]{2}$/.test(normalized) ? normalized.toLowerCase() : undefined;
}

export function AddressAutocomplete({
  value,
  country,
  onChange,
  onAddressSelected,
  disabled = false,
  required = false,
  placeholder = "Start typing a street address",
  ariaInvalid,
  ariaDescribedBy,
}: {
  value: string;
  country?: string;
  onChange: (value: string) => void;
  onAddressSelected: (address: AddressFields) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<PlaceAutocompleteElement | null>(null);
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);
  const selectedRef = useRef(onAddressSelected);
  const [mode, setMode] = useState<"loading" | "ready" | "fallback">("loading");

  valueRef.current = value;
  changeRef.current = onChange;
  selectedRef.current = onAddressSelected;

  useEffect(() => {
    let disposed = false;
    let widget: PlaceAutocompleteElement | null = null;
    const host = hostRef.current;

    void loadPlacesLibrary().then(({ PlaceAutocompleteElement }) => {
      if (disposed || !host) return;
      widget = new PlaceAutocompleteElement({
        value: valueRef.current,
        placeholder,
        includedPrimaryTypes: ["street_address"],
        requestedLanguage: "en",
        requestedRegion: requestedRegion(country ?? ""),
      });
      widget.description = "Street address. Start typing and choose a Google address suggestion.";
      widget.setAttribute("aria-label", "Street address");
      if (required) widget.setAttribute("aria-required", "true");

      const handleInput = () => changeRef.current(widget?.value ?? "");
      const handleBlur = () => changeRef.current(widget?.value ?? "");
      const handleSelect = (event: Event) => {
        const prediction = (event as GooglePlaceSelectEvent).placePrediction;
        if (!prediction) return;
        void (async () => {
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ["addressComponents"] });
          if (!place.addressComponents?.length || disposed) return;
          const address = addressFieldsFromGoogleComponents(place.addressComponents);
          widget!.value = address.addressLine1;
          changeRef.current(address.addressLine1);
          selectedRef.current(address);
        })().catch(() => setMode("fallback"));
      };
      const handleError = () => setMode("fallback");

      widget.addEventListener("input", handleInput);
      widget.addEventListener("focusout", handleBlur);
      widget.addEventListener("gmp-select", handleSelect);
      widget.addEventListener("gmp-error", handleError);
      widgetRef.current = widget;
      host.appendChild(widget);
      setMode("ready");

      return () => {
        widget?.removeEventListener("input", handleInput);
        widget?.removeEventListener("focusout", handleBlur);
        widget?.removeEventListener("gmp-select", handleSelect);
        widget?.removeEventListener("gmp-error", handleError);
      };
    }).catch(() => {
      if (!disposed) setMode("fallback");
    });

    return () => {
      disposed = true;
      widgetRef.current = null;
      widget?.remove();
    };
    // The widget instance is retained; changing values and options are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    if (widget.value !== value) widget.value = value;
    widget.disabled = disabled;
    widget.placeholder = placeholder;
    widget.requestedRegion = requestedRegion(country ?? "");
    if (ariaInvalid) widget.setAttribute("aria-invalid", "true"); else widget.removeAttribute("aria-invalid");
    if (ariaDescribedBy) widget.setAttribute("aria-describedby", ariaDescribedBy); else widget.removeAttribute("aria-describedby");
  }, [ariaDescribedBy, ariaInvalid, country, disabled, placeholder, value]);

  return <div className="address-autocomplete" onKeyDown={(event) => event.stopPropagation()}>
    <div className="address-autocomplete-widget" ref={hostRef} hidden={mode !== "ready"} />
    {mode !== "ready" ? <input
      className="address-autocomplete-fallback"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      autoComplete="street-address"
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    /> : null}
    {mode === "fallback" ? <small className="address-autocomplete-note">Address suggestions unavailable; enter the address manually.</small> : null}
  </div>;
}
