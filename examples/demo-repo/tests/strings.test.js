import test from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/strings.js";

test("titleCase normalizes words", () => {
  assert.equal(titleCase("  hello   WORLD "), "Hello World");
});
