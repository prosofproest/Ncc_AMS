import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Scripts safety check', () => {
  const allowed = new Set([
    'setup.mjs',
    'migrate.mjs',
    'reset-password.mjs',
    'check-env.mjs',
    'test-cloudinary.mjs',
    'make-icons.mjs'
  ]);

  it('no unauthorised scripts access collections or create tokens', () => {
    const root = process.cwd();
    const dirs = ['scripts', 'firebase'];
    const forbidden = ['.collection(', 'createToken'];

    for (const dir of dirs) {
      const fullDir = path.join(root, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir);
      for (const file of files) {
        if (!file.endsWith('.mjs') && !file.endsWith('.js')) continue;
        if (allowed.has(file)) continue;

        const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
        for (const pattern of forbidden) {
          expect(content.includes(pattern), `${dir}/${file} should not contain "${pattern}"`).toBe(false);
        }
      }
    }
  });
});

