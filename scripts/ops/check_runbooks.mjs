#!/usr/bin/env node
// Every alert names a runbook, and every runbook it names exists. Run in CI.
import { readFile, access } from 'node:fs/promises';

const rules = await readFile('infrastructure/monitoring/alerts.yml', 'utf8');
const alerts = [...rules.matchAll(/- alert: (\w+)\n([\s\S]*?)(?=\n\s*- alert:|\n\s*- name:|$)/g)];
const problems = [];
for (const [, name, body] of alerts) {
  const rb = /runbook: "([^"]+)"/.exec(body)?.[1];
  if (!rb) problems.push(`${name} has no runbook`);
  else await access(rb).catch(() => problems.push(`${name} names ${rb}, which doesn't exist`));
}
const index = await readFile('docs/runbooks/README.md', 'utf8');
for (const [, name] of alerts) if (!index.includes(name)) problems.push(`${name} is missing from docs/runbooks/README.md`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${alerts.length} alerts, each with a runbook`);
