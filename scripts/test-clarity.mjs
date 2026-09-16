import { readFileSync } from 'fs';
import { homedir } from 'os';

const raw = readFileSync(`${homedir()}/.claude/.mateando-clarity`, 'utf-8');
const token = raw.match(/CLARITY_API_TOKEN=(.+)/)?.[1]?.trim();

if (!token) {
  console.error('❌ No se encontró CLARITY_API_TOKEN en ~/.claude/.mateando-clarity');
  process.exit(1);
}

const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights');
url.searchParams.set('numOfDays', '3');

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
});

if (!res.ok) {
  console.error(`❌ Clarity API error ${res.status}:`, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log('✅ Clarity OK — métricas de los últimos 3 días:\n');
console.log(JSON.stringify(data, null, 2));
