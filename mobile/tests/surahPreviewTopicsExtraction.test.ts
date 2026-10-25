import { describe, expect, it } from 'vitest';

// The import tool's extraction rules (tools/surah-preview/quranpedia-topics.mjs), on SYNTHETIC HTML shaped like the
// source's (never its text).
const { basairTopics, citation, lines, topics } = await import('../../tools/surah-preview/quranpedia-topics.mjs');

describe('Surah Preview topics: extraction from the source HTML (rules only, never rewording)', () => {
  it('keeps the numbered items verbatim, without their numbering or ayah range; drops the lead-in and the citation', () => {
    const html = '<p> جاءت الموضوعات على الترتيب الآتي:</p><p>1. موضوع أول (١-٨).</p><p>2. موضوع ثانٍ، وتتمته (٩-٣١).</p><p>ينظر: "كتاب مرجعي" لمجموعة من العلماء (4 /289). </p>';
    expect(topics(html)).toEqual(['موضوع أول', 'موضوع ثانٍ، وتتمته']);
    expect(citation(html)).toBe('ينظر: "كتاب مرجعي" لمجموعة من العلماء (4 /289).');
  });

  it('keeps only the top-level headings of a nested outline (a sub-section lies inside its heading\'s ayah range)', () => {
    const html = '<p>عنوان أول (١-٣٩).</p><p>قسم منه (١-٢٠).</p><p>قسم آخر منه (٢١- ٣٩).</p><p>عنوان ثانٍ (٤٠-١٦٢).قسم من الثاني (٤٠-٤٨).</p><p>عنوان ثالث (١٦٣-٢٨٦).</p>';
    expect(topics(html)).toEqual(['عنوان أول', 'عنوان ثانٍ', 'عنوان ثالث']);
  });

  it('a single-ayah reference «(١٨)» is removed like a range, and a single-ayah sub-section of a heading is dropped', () => {
    expect(topics('<p>1. بند (١-١٧).</p><p>2. خاتمة (١٨).</p>')).toEqual(['بند', 'خاتمة']);
    expect(topics('<p>1. عنوان جامع (٢٨-٥٩).</p><p>2. قسم (٢٨-٣٤).</p><p>3. قسم من آية واحدة (٣٥).</p><p>4. بند بعده (٦٠-٧٣).</p>')).toEqual(['عنوان جامع', 'بند بعده']);
  });

  it('«بصائر ذوي التمييز»: the «معظم مقصود السورة» sentence, verbatim and whole, from that chapter only', () => {
    const contents = [
      { chapter_id: 7, text: 'بصيرة فى.. سورة. السّورة مكِّيّة. معظم مقصود السّورة: بيان أول، وبيان ثانٍ فى قوله: نص . الناسخ والمنسوخ: فيها …' },
      { chapter_id: 8, text: 'معظم مقصود السورة: نص فصل آخر . (الناسخ والمنسوخ: …)' },
    ];
    expect(basairTopics(contents, 7)).toEqual(['بيان أول، وبيان ثانٍ فى قوله: نص.']);
    expect(basairTopics(contents, 8)).toEqual(['نص فصل آخر.']);
    expect(basairTopics(contents, 9)).toBeNull();
  });

  it('splits a run-on item at the end of an ayah range', () => {
    expect(lines('<p>بند (٤٠-١٦٢).بند تالٍ (٤٠-٤٨).</p>')).toEqual(['بند (٤٠-١٦٢).', 'بند تالٍ (٤٠-٤٨).']);
  });

  it('ordinal items are list items; quoted prose after them is not', () => {
    const html = '<p>اشتملت السورة على موضوعات:</p><p>أولًا: الأول.</p><p>ثانيًا: الثاني.</p><p>وفي ذلك يقول عالمٌ: «كلامٌ منقول طويل».</p>';
    expect(topics(html)).toEqual(['الأول', 'الثاني']);
  });

  it('two items with the same range are both kept; the same heading twice in a row is shown once', () => {
    expect(topics('<p>1. قصة (٣٢-٤٤).</p><p>2. تعقيب على القصة (٣٢-٤٤).</p>')).toEqual(['قصة', 'تعقيب على القصة']);
    expect(topics('<p>1. عنوان (١-٥).</p><p>2. عنوان (٦-٩).</p>')).toEqual(['عنوان']);
  });

  it('no topics in the source: null (the sheet then says they are not available), never an empty filler', () => {
    expect(topics(null)).toBeNull();
    expect(topics('<p>نص بلا بنود.</p>')).toBeNull();
  });
});
