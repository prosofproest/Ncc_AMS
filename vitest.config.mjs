import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.dirname(fileURLToPath(import.meta.url));

// The app keeps JSX in plain .js files (Next.js style) — teach the test transformer to parse them as JSX.
const jsxInJs = {
  name: 'jsx-in-js', enforce: 'pre',
  async transform(code, id) {
    if (!/\/(app|lib)\/.*\.js$/.test(id) || id.includes('node_modules')) return null;
    const { transform } = await import('esbuild');
    const out = await transform(code, { loader: 'jsx', jsx: 'automatic', sourcemap: true, sourcefile: id, format: 'esm' });
    return { code: out.code, map: out.map };
  },
};
export default defineConfig({
  plugins: [jsxInJs],
  resolve: { alias: { '@': root } },
  test: { environment: 'node', setupFiles: ['tests/setup.js'], fileParallelism: false, include: ['tests/**/*.test.js'], testTimeout: 30000, globals: true },
});
