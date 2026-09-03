import assert from "node:assert/strict";
import test from "node:test";

import { addressFieldsFromGoogleComponents } from "../lib/address-components";

const component = (longText, shortText, ...types) => ({ longText, shortText, types });

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
