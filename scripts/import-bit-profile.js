#!/usr/bin/env node
// CLI wrapper around src/dxf-profile.js.
// Usage: node scripts/import-bit-profile.js <file.dxf> [output.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { importDxfProfile } from '../src/dxf-profile.js';

export { importDxfProfile } from '../src/dxf-profile.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/import-bit-profile.js <file.dxf> [output.json]');
    process.exit(1);
  }
  const dxfText = readFileSync(inputPath, 'utf8');
  const points = importDxfProfile(dxfText);
  const json = JSON.stringify({ type: 'points', points }, null, 2);

  const outputPath = process.argv[3];
  if (outputPath) {
    writeFileSync(outputPath, json);
    console.error(`Wrote ${points.length} points to ${outputPath}`);
  } else {
    console.log(json);
  }
}
