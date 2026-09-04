export type AddressFields = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  /** Business or venue name returned for an establishment search. */
  placeName?: string;
};

export type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

function findComponent(components: GoogleAddressComponent[], type: string) {
  return components.find((component) => component.types?.includes(type));
}

function componentText(components: GoogleAddressComponent[], type: string, short = false) {
  const component = findComponent(components, type);
  return String(short ? component?.shortText ?? component?.longText ?? "" : component?.longText ?? component?.shortText ?? "").trim();
}

/** Converts the Places API's international component list into PaneFlow's address fields. */
export function addressFieldsFromGoogleComponents(components: GoogleAddressComponent[]): AddressFields {
  const completeStreet = componentText(components, "street_address");
  const streetNumber = componentText(components, "street_number");
  const route = componentText(components, "route", true);
  const premise = componentText(components, "premise");
  const postalCode = componentText(components, "postal_code");
  const postalCodeSuffix = componentText(components, "postal_code_suffix");

  return {
    addressLine1: completeStreet || [streetNumber, route].filter(Boolean).join(" ") || premise,
    addressLine2: [componentText(components, "subpremise"), componentText(components, "floor")].filter(Boolean).join(", "),
    city: componentText(components, "locality")
      || componentText(components, "postal_town")
      || componentText(components, "sublocality_level_1")
      || componentText(components, "administrative_area_level_2"),
    region: componentText(components, "administrative_area_level_1", true),
    postalCode: postalCodeSuffix ? `${postalCode}-${postalCodeSuffix}` : postalCode,
    country: componentText(components, "country", true).toUpperCase(),
  };
}

/** Preserves a selected business name while normalizing its postal address. */
export function addressFieldsFromGooglePlace(place: { addressComponents?: GoogleAddressComponent[]; displayName?: string }): AddressFields {
  const address = addressFieldsFromGoogleComponents(place.addressComponents ?? []);
  const placeName = String(place.displayName ?? "").trim();
  return placeName ? { ...address, placeName } : address;
}
