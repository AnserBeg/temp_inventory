import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { addressFieldsFromGoogleComponents, addressFieldsFromGooglePlace } from "../lib/address-components";

const component = (longText, shortText, ...types) => ({ longText, shortText, types });
const autocompleteSource = await readFile(new URL("../app/components/address-autocomplete.tsx", import.meta.url), "utf8");
const inventorySource = await readFile(new URL("../app/inventory-app.tsx", import.meta.url), "utf8");

test("maps a Canadian street address into every PaneFlow address field", () => {
  assert.deepEqual(addressFieldsFromGoogleComponents([
    component("104", "104", "street_number"),
    component("Main Street Northwest", "Main St NW", "route"),
    component("Edmonton", "Edmonton", "locality"),
    component("Alberta", "AB", "administrative_area_level_1"),
    component("Canada", "CA", "country"),
    component("T5J 1A1", "T5J 1A1", "postal_code"),
    component("220", "220", "subpremise"),
  ]), {
    addressLine1: "104 Main St NW",
    addressLine2: "220",
    city: "Edmonton",
    region: "AB",
    postalCode: "T5J 1A1",
    country: "CA",
  });
});

test("handles international city and postal-code component variants", () => {
  assert.deepEqual(addressFieldsFromGoogleComponents([
    component("10 Downing Street", "10 Downing St", "street_address"),
    component("London", "London", "postal_town"),
    component("England", "ENG", "administrative_area_level_1"),
    component("United Kingdom", "GB", "country"),
    component("SW1A", "SW1A", "postal_code"),
    component("2AA", "2AA", "postal_code_suffix"),
  ]), {
    addressLine1: "10 Downing Street",
    addressLine2: "",
    city: "London",
    region: "ENG",
    postalCode: "SW1A-2AA",
    country: "GB",
  });
});

test("preserves an establishment name while mapping its postal address", () => {
  assert.deepEqual(addressFieldsFromGooglePlace({
    displayName: "McDonald's",
    addressComponents: [
      component("10065", "10065", "street_number"),
      component("Jasper Avenue", "Jasper Ave", "route"),
      component("Edmonton", "Edmonton", "locality"),
      component("Alberta", "AB", "administrative_area_level_1"),
      component("Canada", "CA", "country"),
      component("T5J 3B1", "T5J 3B1", "postal_code"),
    ],
  }), {
    addressLine1: "10065 Jasper Ave",
    addressLine2: "",
    city: "Edmonton",
    region: "AB",
    postalCode: "T5J 3B1",
    country: "CA",
    placeName: "McDonald's",
  });
});

test("searches businesses and street addresses with a browser-location bias", () => {
  assert.match(autocompleteSource, /includedPrimaryTypes:\s*\["establishment", "street_address"\]/);
  assert.match(autocompleteSource, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(autocompleteSource, /widget\.locationBias = bias/);
});

test("sales-order ship-to starts with address search and identifies the internal ship-from location", () => {
  const composerStart = inventorySource.indexOf("function AdvancedCreateOrderDialog");
  const composerEnd = inventorySource.indexOf("type CommandPanelProps", composerStart);
  const composer = inventorySource.slice(composerStart, composerEnd);
  assert.ok(composer.indexOf("Business or street address") < composer.indexOf("Use a saved customer delivery address"));
  assert.match(composer, /Ship-from bin \/ yard/);
});
