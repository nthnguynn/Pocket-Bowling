import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Luật tách site: mỗi game là một site độc lập trong sites/, chỉ được dùng chung qua packages/party-kit.
 * - site không import site khác (riêng kho game được đọc `@pocket/<game>/meta`);
 * - site không với ra ngoài thư mục của mình bằng đường dẫn tương đối;
 * - party-kit không import bất kỳ site nào.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const IMPORT = /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(full);
    return /\.(ts|css)$/.test(entry.name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].map((match) => match[1] ?? match[2] ?? match[3]!).filter(Boolean);
}

const sites = fs.readdirSync(path.join(ROOT, 'sites'));

describe('ranh giới giữa các site', () => {
  it.each(sites)('%s chỉ dùng code của chính nó và party-kit', (site) => {
    const siteDir = path.join(ROOT, 'sites', site);
    const problems: string[] = [];
    for (const file of sourceFiles(siteDir)) {
      for (const specifier of importsOf(file)) {
        const where = `${path.relative(ROOT, file)} → ${specifier}`;
        if (specifier.startsWith('.')) {
          const target = path.resolve(path.dirname(file), specifier);
          if (!target.startsWith(siteDir + path.sep)) problems.push(where);
        } else if (specifier.startsWith('@pocket/') && !specifier.startsWith('@pocket/party-kit')) {
          const metaOnly = site === 'pocket-arcade' && /^@pocket\/[a-z]+\/meta$/.test(specifier);
          if (!metaOnly) problems.push(where);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('party-kit không biết tới game nào', () => {
    const kitDir = path.join(ROOT, 'packages', 'party-kit');
    const problems = sourceFiles(kitDir).flatMap((file) => importsOf(file)
      .filter((specifier) => specifier.startsWith('@pocket/') || path.resolve(path.dirname(file), specifier).includes(`${path.sep}sites${path.sep}`))
      .map((specifier) => `${path.relative(ROOT, file)} → ${specifier}`));
    expect(problems).toEqual([]);
  });
});
