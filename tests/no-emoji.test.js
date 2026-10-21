import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2190}-\u{21FF}]/u;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git' || e.name === 'tests') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

describe('no-emoji regression test', () => {
  it('scans app/, lib/ and public/ for emoji and symbol-icons', () => {
    const targets = ['app', 'lib', 'public'].flatMap(d => {
      const p = path.join(process.cwd(), d);
      return fs.existsSync(p) ? walk(p) : [];
    });

    const matches = [];

    for (const file of targets) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (EMOJI_REGEX.test(line)) {
          matches.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    if (matches.length > 0) {
      console.error(`Found ${matches.length} emoji/symbol matches:\n${matches.join('\n')}`);
    }

    expect(matches).toEqual([]);
  });
});
