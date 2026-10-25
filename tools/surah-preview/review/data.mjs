/**
 * The 114 review records: what the reviewer sees for each Surah. Read only: the generated dataset
 * (mobile/assets/surah-preview/surah-preview.json), Tanzil's Surah names, topics-review.json, and the pinned sources
 * cached by import.mjs (Quranpedia's dump, «بصائر ذوي التمييز»). Nothing here changes any of them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { basairTopics, citation, lines, topicItems, topics } from '../quranpedia-topics.mjs';
import { LONG_LIST, selectionProposal, splitProposal } from './proposals.mjs';
import { topicsSha } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const TOOL_DIR = resolve(here, '..');
const ROOT = resolve(here, '../../..');

/** The priority cases the owner named (2026-10-24), with why. Long lists are added to these automatically. */
export const PRIORITY = {
  1: 'Missing source citation: the topics are Quranpedia\'s own framing (no «ينظر»).',
  18: 'Item 1 reads «الحمد الله»: verify the apparent typo for «الحمد لله» (kept as the source has it).',
  21: 'The source\'s last ayah range reads «(١٠٧- ١٢١)» for a Surah of 112 ayahs (ranges are not shown in the app).',
  22: 'The heading «المجادلة بغير علم» appears twice (the source uses it for two passages, 3–4 and 8–16).',
  42: 'One long sentence from «بصائر ذوي التمييز»; includes «محبة أهل البيت», one interpretation of «إلا المودة في القربى» on which scholars differ.',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** All 114 records, and anything missing that limits them (e.g. a source cache not yet downloaded). */
export function loadRecords(options = {}) {
  const datasetPath = options.datasetPath ?? join(ROOT, 'mobile/assets/surah-preview/surah-preview.json');
  const dataset = readJson(datasetPath);
  const names = readJson(join(ROOT, 'backend/assets/quran/surah-names.json')).surahs;
  const review = readJson(join(TOOL_DIR, 'topics-review.json')).surahs;
  const lock = readJson(join(TOOL_DIR, 'quranpedia.lock.json'));
  const missing = [];
  const dumpPath = join(TOOL_DIR, 'source/quranpedia-surahs.json.gz');
  const dump = existsSync(dumpPath) ? JSON.parse(gunzipSync(readFileSync(dumpPath)).toString('utf8')) : (missing.push(dumpPath), null);
  const bookPath = join(TOOL_DIR, 'source/quranpedia-book-186.json');
  const book = existsSync(bookPath) ? readJson(bookPath) : (missing.push(bookPath), null);
  const sources = new Map((dataset.sources ?? []).map((source) => [source.id, source]));
  // The owner's editorial approval (owner-approval.json): shown beside, never mixed with, the scholarly decisions.
  const ownerPath = join(TOOL_DIR, 'owner-approval.json');
  const owner = existsSync(ownerPath) ? readJson(ownerPath) : null;
  const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

  const records = dataset.surahs.map((entry, i) => {
    const n = i + 1;
    const name = names[i];
    const flags = review[i]?.flags ?? [];
    // An empty field («<p> </p>», Surahs 42 and 44) counts as none.
    const rawHtml = dump?.data[i]?.information?.topics?.value ?? null;
    const html = rawHtml && lines(rawHtml).length ? rawHtml : null;
    const chapter = lock.basair?.chapters?.[String(n)] ?? null;
    let sourceKind = null;
    let sourceText = [];
    if (html) {
      sourceKind = 'quranpedia';
      sourceText = lines(html);
    } else if (chapter && book) {
      sourceKind = 'basair';
      const text = book.contents.filter((c) => c.chapter_id === chapter.id).map((c) => String(c.text).replace(/<[^>]+>/g, ' ')).join(' ').replace(/\s+/g, ' ');
      const start = text.indexOf('معظم مقصود');
      const end = text.indexOf('الناسخ', start);
      sourceText = [chapter.title, start >= 0 ? text.slice(start, end > start ? end : start + 1500).trim() : text.slice(0, 1500)];
    }
    // Under review: the topics as the pinned source gives them (what import.mjs would show without a decision), so a
    // decision stays bound to the source text even after it has been applied to the app.
    const current = sourceKind === 'quranpedia' ? topics(html) : sourceKind === 'basair' ? basairTopics(book.contents, chapter.id) : null;
    const proposal = sourceKind === 'quranpedia' ? selectionProposal(topicItems(html)) : sourceKind === 'basair' && n === 42 ? splitProposal(current) : null;
    const priority = [
      ...(PRIORITY[n] ? [PRIORITY[n]] : []),
      ...(current && current.length > LONG_LIST ? [`Long list: ${current.length} topics (more than ${LONG_LIST}).`] : []),
    ];
    return {
      surah: n,
      nameAr: name.nameArabic,
      nameEn: name.nameEnglish,
      ayahCount: entry.ayahCount,
      revelation: entry.revelation,
      purpose: entry.purpose?.ar ?? null,
      current,
      inApp: entry.themes?.ar ?? null,
      inAppStatus: entry.status?.themesAr ?? 'unavailable',
      currentSha: topicsSha(current),
      sourceKind,
      sourceText,
      references: {
        citation: html ? citation(html) : review[i]?.citation ?? null,
        sources: (entry.sources ?? []).filter((id) => id !== 'mukhtasar-quranenc' && id !== 'tanzil').map((id) => sources.get(id) ?? { id }),
        dumpVersion: lock.version,
        dumpSha256: lock.sha256,
        basairSha256: lock.basair?.sha256 ?? null,
      },
      ownerApproval: owner?.surahs?.[i] ? {
        by: owner.approvedBy,
        on: owner.approvedOn,
        purpose: sha(entry.purpose?.ar ?? '') === owner.surahs[i].purposeArSha256,
        topics: entry.themes?.ar != null && sha(JSON.stringify(entry.themes.ar)) === owner.surahs[i].themesArSha256,
      } : null,
      warnings: [...flags, ...(review[i]?.note ? [review[i].note] : [])],
      priority,
      proposal,
    };
  });
  return { records, missing };
}
