#!/usr/bin/env node
// Validate that aces.json and lang/en-US.json agree, so the whole class of
// "ACE parameter language string 'name' missing ..." errors (which otherwise
// only surface when Construct loads the addon) fails the build locally instead.
//
// Checks, for every action / condition / expression in aces.json:
//   - a matching lang entry exists, and
//   - every declared param has a lang `name`.
import { readFileSync } from "node:fs";

const stripBom = (s) => s.replace(/^﻿/, "");
const read = (p) => JSON.parse(stripBom(readFileSync(p, "utf8")));

const aces = read("src/aces.json");
const lang = read("src/lang/en-US.json");

const plugins = lang?.text?.plugins;
const pluginKey = plugins && Object.keys(plugins)[0];
if (!pluginKey) {
  console.error("validate-aces: could not find a plugin under text.plugins in en-US.json");
  process.exit(2);
}
const L = plugins[pluginKey];

const KINDS = ["conditions", "actions", "expressions"];
const problems = [];

for (const [cat, catVal] of Object.entries(aces)) {
  if (cat.startsWith("$")) continue; // skip $schema
  if (!catVal || typeof catVal !== "object") continue;
  for (const kind of KINDS) {
    for (const ace of catVal[kind] ?? []) {
      const le = L?.[kind]?.[ace.id];
      if (!le) {
        problems.push(`${kind}/${ace.id}: missing lang entry (text.plugins.${pluginKey}.${kind}.${ace.id})`);
        continue;
      }
      for (const p of ace.params ?? []) {
        const lp = le.params?.[p.id];
        if (!lp) {
          problems.push(`${kind}/${ace.id}: param "${p.id}" missing lang block`);
        } else if (!lp.name) {
          problems.push(`${kind}/${ace.id}: param "${p.id}" missing lang "name"`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`validate-aces: ${problems.length} problem(s):`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("validate-aces: OK (all ACEs and params have lang strings)");
