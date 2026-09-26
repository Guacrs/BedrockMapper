/**
 * PR38 — print / write the non-full-cube geometry coverage audit.
 *
 *   npm run report-model-coverage
 *   npm run report-model-coverage -- --json
 *   npm run report-model-coverage -- --markdown docs/model-coverage-audit.md
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  auditCatalog,
  groupRoadmapByCategory,
  roadmapEntries,
  summarizeGeometryAudit,
  type GeometryAuditEntry,
  type GeometryAuditSummary,
} from '../renderer/3d/models/geometry-audit.ts';

function parseArgs(argv: string[]): { json: boolean; markdown: string | null } {
  let json = false;
  let markdown: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    if (a === '--markdown') {
      markdown = argv[i + 1] ?? 'docs/model-coverage-audit.md';
      i++;
    }
  }
  return { json, markdown };
}

function formatSummary(summary: GeometryAuditSummary): string {
  const lines = [
    `# Model geometry coverage audit (PR38)`,
    ``,
    `Catalog size: **${summary.total}** block ids (appearance ∪ block-colors).`,
    ``,
    `## Buckets`,
    ``,
    `| Bucket | Count | Meaning |`,
    `| --- | ---: | --- |`,
    `| explicit_ok | ${summary.byBucket.explicit_ok} | Dedicated model family already |`,
    `| intentional_full_cube | ${summary.byBucket.intentional_full_cube} | True / intentional cube mesh |`,
    `| intentional_fallback | ${summary.byBucket.intentional_fallback} | Safe full-cube stand-in (J) |`,
    `| known_incorrect | ${summary.byBucket.known_incorrect} | Non-cube evidence; still cube mesh |`,
    `| suspected_incorrect | ${summary.byBucket.suspected_incorrect} | Heuristic non-cube; needs research |`,
    ``,
    `**Incorrect / suspected total: ${summary.incorrectTotal}** (plus ${summary.byBucket.intentional_fallback} intentional fallbacks).`,
    ``,
    `## Priority backlog (incorrect + fallback)`,
    ``,
    `| Priority | Count | Role |`,
    `| --- | ---: | --- |`,
    `| p0 | ${summary.byPriority.p0} | High-frequency build visuals (chests, chains, campfires) |`,
    `| p1 | ${summary.byPriority.p1} | Attachment / redstone / thin deco |`,
    `| p2 | ${summary.byPriority.p2} | Functional furniture / rods |`,
    `| p3 | ${summary.byPriority.p3} | Vegetation / clusters / cakes (incl. candle cakes) |`,
    `| p4 | ${summary.byPriority.p4} | Rare / complex / heuristic |`,
    ``,
    `Candles (PR39), standing/wall signs (PR40), hanging signs (PR41), and chests (PR42) are **explicit_ok**. Next family PR starts at **PR43** (chains).`,
    ``,
  ];
  return lines.join('\n');
}

function formatRoadmap(
  groups: ReturnType<typeof groupRoadmapByCategory>,
): string {
  const lines = [
    `## Suggested family PR sequence`,
    ``,
    `Do **not** implement this list blindly — each PR still needs Bedrock state research.`,
    `One family (or tightly related group) per PR.`,
    ``,
  ];
  let n = 43; // PR39–42 done; next backlog starts at chains
  for (const g of groups) {
    lines.push(
      `### ${g.priority.toUpperCase()} — \`${g.category}\` (${g.count} ids) → candidate PR${n}`,
    );
    lines.push(``);
    lines.push(`Samples: ${g.samples.map((s) => `\`${s}\``).join(', ')}`);
    lines.push(``);
    n++;
  }
  lines.push(`## Lighting`);
  lines.push(``);
  lines.push(
    `Deferred until the model-coverage milestone. Next lighting phase is **research / BlockLight extraction**, not ad-hoc emissive tweaks.`,
  );
  lines.push(``);
  return lines.join('\n');
}

function formatFullIncorrectList(entries: readonly GeometryAuditEntry[]): string {
  const rows = roadmapEntries(entries);
  const lines = [
    `## Full incorrect / fallback inventory`,
    ``,
    `| Priority | Category | Bucket | Block |`,
    `| --- | --- | --- | --- |`,
  ];
  for (const e of rows) {
    lines.push(`| ${e.priority} | ${e.category} | ${e.bucket} | \`${e.name}\` |`);
  }
  lines.push(``);
  return lines.join('\n');
}

function main(): void {
  const { json, markdown } = parseArgs(process.argv.slice(2));
  const entries = auditCatalog();
  const summary = summarizeGeometryAudit(entries);
  const groups = groupRoadmapByCategory(entries);

  if (json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary,
      roadmap: groups,
      incorrect: roadmapEntries(entries),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const md = [
    formatSummary(summary),
    formatRoadmap(groups),
    formatFullIncorrectList(entries),
  ].join('\n');

  if (markdown) {
    const out = path.resolve(markdown);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
    process.stderr.write(`Wrote ${out}\n`);
  }
  process.stdout.write(md);
}

main();
