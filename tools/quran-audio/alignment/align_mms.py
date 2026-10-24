"""Experimental CTC forced alignment of a whole-surah recitation to the canonical text (torchaudio MMS_FA).

usage: python -X utf8 align_mms.py <quran-uthmani.txt> <surah> <audio.mp3> <out.json> [--no-star-between] [--anchors primary.json]
                                    [--no-basmala]
  --both star.json: also the star-token configuration, from the same emissions (one process; primary = this run)
  --anchors: align in windows of at most 15 min of audio, cut between ayahs of another alignment of the same file
  (for surahs too long for one alignment on the GPU); 'windows' in the output lists them.
  --no-basmala (Phase 4.8, OFF by default): no Basmala segment before ayah 1, for recordings that do not recite it
  aloud (Haram prayer recordings, Phase 4.7: the forced segment ate up to 3.2 s of ayah 1). The Basmala words are still
  removed from ayah 1's text, as by default; nothing else changes. Without the option the output is unchanged.
out: {surah, duration_ms, intro: [start,end] | null, ayahs: [{ayah, start_ms, end_ms, boundary_ms, score}], gpu_s}
  start/end: first/last aligned character of the ayah; boundary_ms: the middle of the gap from the previous ayah's last
  character to this ayah's first (ayah 1: from the intro's end or the file start); score: mean character probability.
"""
import json, re, sys, time
import numpy as np, torch, torchaudio, miniaudio
from textnorm import load_quran, normalize, romanize_word

LETTERS = {'ا': 'alif', 'ل': 'laam', 'م': 'miim', 'ص': 'saad', 'ر': 'raa', 'ك': 'kaaf', 'ه': 'haa', 'ي': 'yaa', 'ى': 'yaa', 'ع': "'ayn",
           'ط': 'taa', 'س': 'siin', 'ح': 'haa', 'ق': 'qaaf', 'ن': 'nuun'}
OPENING = {2, 3, 7, 10, 11, 12, 13, 14, 15, 19, 20, 26, 27, 28, 29, 30, 31, 32, 36, 38, 40, 41, 42, 43, 44, 45, 46, 50, 68}
WINDOW_S = 900  # --anchors: the longest run of audio aligned in one piece
LONG_S = 3000  # --both: longer recordings get the windowed comparison run
BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'
STRIP = re.compile('[ً-ٰٓۖ-ۭ]')


def words_of(surah, ayah, text, first_of_surah):
    out = []
    for i, w in enumerate(text.split()):
        bare = STRIP.sub('', normalize(w))
        if not bare:
            continue
        spelled = (first_of_surah and i == 0 and surah in OPENING) or (surah == 42 and ayah == 2)
        if spelled and len(bare) <= 5 and all(c in LETTERS for c in bare):
            out += [LETTERS[c] for c in bare]
        else:
            r = romanize_word(w.replace('ٓ', ''))
            if r:
                out.append(r)
    return out


def build_segments(q, surah, basmala=True):
    """The surah's ayah count and its segments [(label, words)]: the Basmala as label 0 when the text opens with it
    (every surah but 1 and 9) and `basmala` is true, then ayahs 1..n. The Basmala words never belong to ayah 1."""
    n = max(a for (s, a) in q if s == surah)
    segs = []  # (label, words)
    for a in range(1, n + 1):
        t = q[(surah, a)]
        if a == 1 and surah not in (1, 9):
            ws, bas = t.split(), q[(1, 1)].split()
            if [STRIP.sub('', normalize(w)) for w in ws[:4]] == [STRIP.sub('', normalize(w)) for w in bas]:
                if basmala:
                    segs.append((0, words_of(surah, 0, q[(1, 1)], False)))
                t = ' '.join(ws[4:])
        segs.append((a, words_of(surah, a, t, a == 1)))
    return n, segs


def main():
    qpath, surah, audio, outp = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    # Control runs: align the audio against another surah's text (--text-surah N).
    if '--text-surah' in sys.argv:
        surah = int(sys.argv[sys.argv.index('--text-surah') + 1])
    star_between = '--no-star-between' not in sys.argv
    anchors = json.load(open(sys.argv[sys.argv.index('--anchors') + 1], encoding='utf8')) if '--anchors' in sys.argv else None
    q = load_quran(qpath)
    n, segs = build_segments(q, surah, basmala='--no-basmala' not in sys.argv)

    dev = torch.device('cuda')
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True).to(dev).eval()
    dic = bundle.get_dict(star='*')
    sr = bundle.sample_rate
    d = miniaudio.decode_file(audio, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=sr)
    wav = torch.tensor(np.asarray(d.samples, dtype=np.float32))
    dur_ms = round(len(wav) / sr * 1000)
    t0 = time.time()
    # Emissions in 30 s windows with 2 s context each side (only the centre is kept).
    W, C = 30 * sr, 2 * sr
    ems = []
    with torch.inference_mode():
        for s0 in range(0, len(wav), W):
            a0, b0 = max(0, s0 - C), min(len(wav), s0 + W + C)
            em, _ = model(wav[a0:b0].unsqueeze(0).to(dev))
            ratio = em.shape[1] / (b0 - a0)
            lo, hi = round((s0 - a0) * ratio), round((min(len(wav), s0 + W) - a0) * ratio)
            ems.append(em[0, lo:hi].cpu())
    emission = torch.cat(ems).unsqueeze(0)
    frame_ms = len(wav) / sr * 1000 / emission.shape[1]
    def align(em, first, last, star_between):
        """Segments first..last (indexes into segs) against emission frames em: {segment: [start, end, scores]}."""
        # Target: * [words of segment] * [words of next segment] ...
        tokens, owner = [dic['*']], [-1]  # owner: segment index per token (or -1 for star tokens)
        for i in range(first, last + 1):
            for w in segs[i][1]:
                for c in w:
                    if c in dic:
                        tokens.append(dic[c]); owner.append(i)
            if star_between and i < last:
                tokens.append(dic['*']); owner.append(-1)
        tokens.append(dic['*']); owner.append(-1)
        targets = torch.tensor([tokens], dtype=torch.int32)
        labels, scores = torchaudio.functional.forced_align(em.to(dev), targets.to(dev), blank=0)
        spans = torchaudio.functional.merge_tokens(labels[0].cpu(), scores[0].exp().cpu())
        assert len(spans) == len(tokens), (len(spans), len(tokens))
        got = {}
        for o, sp in zip(owner, spans):
            if o < 0:
                continue
            g = got.setdefault(o, [sp.start, sp.end, []])
            g[0], g[1] = min(g[0], sp.start), max(g[1], sp.end); g[2].append(float(sp.score))
        return got

    emission_s = time.time() - t0
    x = wav.numpy(); hop = sr // 50
    m = len(x) // hop
    env = np.sqrt((x[:m * hop].reshape(m, hop) ** 2).mean(1)) + 1e-6
    env = np.convolve(env, np.ones(5) / 5, 'same')

    def produce(star_between, anchors, outp):
        t0 = time.time()
        seg_span, windows = {}, None
        if anchors is None:
            seg_span = align(emission, 0, len(segs) - 1, star_between)
        else:
            # Windowed (--anchors): the surah is cut into runs of ayahs of at most WINDOW_S of audio, at the middle of the
            # pause between two ayahs of the anchor alignment (the primary configuration), and each run is aligned on its
            # own. Used where one whole-surah alignment does not fit the GPU. The boundaries at the cuts are not
            # independent of the anchor: flag_boundaries.py reports them ('anchored').
            lab_index = {lab: i for i, (lab, _) in enumerate(segs)}
            cut_after = []
            start_ms = None
            for x in anchors['ayahs']:
                if start_ms is None:
                    start_ms = x['start_ms']
                if x['end_ms'] - start_ms > WINDOW_S * 1000 and x['ayah'] in lab_index and x['ayah'] + 1 in lab_index:
                    cut_after.append(x['ayah']); start_ms = None
            by_ayah = {x['ayah']: x for x in anchors['ayahs']}
            bounds, first, frame_from = [], 0, 0
            for ayah in cut_after:
                nxt = by_ayah.get(ayah + 1)
                if nxt is None:
                    continue
                cut_ms = (by_ayah[ayah]['end_ms'] + nxt['start_ms']) / 2
                bounds.append((first, lab_index[ayah], frame_from, int(cut_ms / frame_ms)))
                first, frame_from = lab_index[ayah] + 1, int(cut_ms / frame_ms)
            bounds.append((first, len(segs) - 1, frame_from, emission.shape[1]))
            windows = []
            for first, last, f0, f1 in bounds:
                got = align(emission[:, f0:f1], first, last, star_between)
                for o, g in got.items():
                    seg_span[o] = [g[0] + f0, g[1] + f0, g[2]]
                windows.append([segs[first][0], segs[last][0], round(f0 * frame_ms), round(f1 * frame_ms)])
        gpu_s = time.time() - t0 + emission_s
        out = {'surah': surah, 'duration_ms': dur_ms, 'frame_ms': frame_ms, 'gpu_s': round(gpu_s, 1), 'intro': None, 'ayahs': [], 'missing': [], 'windows': windows}
        prev_end = None
        for i, (lab, _) in enumerate(segs):
            sp = seg_span.get(i)
            if sp is None:
                out['missing'].append(lab); continue
            st, en = sp[0] * frame_ms, sp[1] * frame_ms
            if lab == 0:
                out['intro'] = [round(st), round(en)]; prev_end = en; continue
            boundary = (prev_end + st) / 2 if prev_end is not None else st
            out['ayahs'].append({'ayah': lab, 'start_ms': round(st), 'end_ms': round(en), 'boundary_ms': round(boundary), 'score': round(float(np.mean(sp[2])), 3)})
            prev_end = en
        # Pause snapping: the longest pause (smoothed 20 ms RMS < 0.35 x the median of the surrounding 6 s, >= 150 ms) in
        # [aligned onset - 1.5 s, aligned onset + 2 s]; the boundary is its middle. None found: 'snapped' is null.
        for a in out['ayahs']:
            a['snapped_ms'] = None
            if a['ayah'] < 2:
                continue
            c = int(a['start_ms'] / 20); lo, hi = max(0, c - 75), min(m, c + 100)
            med = np.median(env[max(0, c - 150):min(m, c + 150)])
            quiet = env[lo:hi] < 0.35 * med
            best, run = None, None
            for i, v in enumerate(list(quiet) + [False]):
                if v and run is None: run = i
                if not v and run is not None:
                    if (i - run) * 20 >= 150 and (best is None or i - run > best[1] - best[0]): best = (run, i)
                    run = None
            if best:
                a['snapped_ms'] = round((lo + (best[0] + best[1]) / 2) * 20)
                a['pause_ms'] = [round((lo + best[0]) * 20), round((lo + best[1]) * 20)]
        json.dump(out, open(outp, 'w'), ensure_ascii=False)
        print(f'surah {surah}: {len(out["ayahs"])}/{n} ayahs, missing {out["missing"]}, {dur_ms / 1000:.0f} s audio, {gpu_s:.1f} s compute')

        return out

    primary = produce(star_between, anchors, outp)
    if '--both' in sys.argv:
        # --both <star.json>: the comparison configuration (star tokens) from the same emissions, in one process. Long
        # recordings, or a whole alignment that fails, are aligned in windows cut between the primary's ayahs.
        other = sys.argv[sys.argv.index('--both') + 1]
        if dur_ms > LONG_S * 1000:
            produce(True, primary, other)
        else:
            try:
                produce(True, None, other)
            except Exception:
                torch.cuda.empty_cache()
                produce(True, primary, other)


if __name__ == '__main__':
    main()
