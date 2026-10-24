"""Checks an EXPERIMENTAL forced alignment (align_mms.py) of one whole-surah recording and flags the ayah boundaries a
person must listen to. It never approves anything: its output is a candidate timing marked experimental, the
structural and fingerprint checks, and a listening worklist. Publishing aligned timing needs the listening review and an
explicit approval (README.md, "Publication"); generate-catalog.mjs does not read aligned timing at all.

usage: python -I -X utf8 flag_boundaries.py <audio.mp3> <config-a.json> [config-b.json] <out.json>
          [--counts ../audit-data/ayah-counts.json] [--reference reference.json]
  config-a: the primary alignment (recommended: --no-star-between, which gave the Phase 2 results); config-b: the
  other configuration (with star tokens), compared with it.
  --reference: to MEASURE the flags (evaluation only), per ayah 1..N the independent reference pause before it:
  [end of voice of the previous ayah, onset of this ayah] in ms (e.g. from word-level timing of the same
  performance). A boundary is 'in-pause' inside it, 'edge' within 150 ms of it (the end of a fading word is where
  references and energy detectors disagree), else 'wrong-pause'. A plain number per ayah (a start time) is
  accepted but is weaker: a start time can itself sit in the previous word's tail.

Per boundary (ayah k >= 2), the chosen time is configuration A's pause-snapped boundary. Flags:
  configs-disagree  A and B snapped more than 300 ms apart (or one found no pause)
  no-pause          no pause of >= 150 ms near the aligned onset (A kept its unsnapped estimate)
  short-pause       the chosen pause is under 250 ms
  competing-pause   another pause in the window is at least 60 % as long (>= 250 ms) and more than 400 ms away
  snap-far          the chosen pause middle is more than 1 s from the aligned first character
  low-score         the ayah's mean character probability is under 0.35 (supporting signal only)
  shallow-pause     (Phase 4.1) the chosen pause is under 15 dB below the loud recitation around it (90th percentile of
                    +-3 s) and has no reverberation-tail shape: a dip in continuous recitation (possible joined ayahs)
  anchored          (Phase 4.1) the comparison run was aligned in windows (align_mms.py --anchors) cut at this
                    boundary, so the two configurations are not independent here
  reordered         (Phase 4.1) the snapped pause lay before the previous boundary (very short ayahs)
  past-own-end      (Phase 4.2) the snapped pause lay after this ayah's own aligned end (the next boundary's pause)
                    for both: the longest pause between the previous boundary and this ayah's aligned end is used,
                    else the aligned midpoint, else the aligned onset
  extra-audio       (Phase 4.1) the comparison run (star tokens) leaves more than 1.5 s of sound unassigned between the
                    two ayahs: possibly a repeated phrase, a supplication or other audio that is not this text
Each boundary also gets 'acoustic' (Phase 4.1, evidence in docs/audio/alignment-phase-4-1-2026-10-18.md):
  silence      >= 25 dB below the loud recitation around it (or the energy test: < 0.35 x the window median)
  reverb-tail  a monotone decay of >= 600 ms to >= 10 dB below, then a rise of >= 6 dB within 100 ms: a pause
               whose silence is masked by reverberation (Shuraim: 161 of 823 measured boundaries, 2.1 % of
               points inside recitation; with silence, 76.5 % of boundaries against 54.2 % for the old test)
  shallow      neither
A score alone never clears or approves a boundary.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402
import numpy as np  # noqa: E402

SR, HOP_MS = 16000, 20
LOW, MIN_PAUSE_MS = 0.35, 150
MIN_AYAH_MS = 200
SHALLOW_DB, SILENCE_DB, TAIL_MS, TAIL_DB, TAIL_RISE_DB, EXTRA_MS = 15, 25, 600, 10, 6, 1500
DISAGREE_MS, SHORT_MS, COMPETE_RATIO, COMPETE_MIN_MS, COMPETE_AWAY_MS, FAR_MS, LOW_SCORE = 300, 250, 0.6, 250, 400, 1000, 0.35


def args():
    a = [x for x in sys.argv[1:]]
    opts = {}
    for key in ('--counts', '--reference'):
        if key in a:
            i = a.index(key)
            opts[key] = a[i + 1]
            del a[i:i + 2]
    if len(a) == 3:
        audio, ca, out = a
        cb = None
    elif len(a) == 4:
        audio, ca, cb, out = a
    else:
        sys.exit(__doc__)
    return audio, ca, cb, out, opts


def envelope(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    x = np.asarray(d.samples, dtype=np.float32)
    hop = SR * HOP_MS // 1000
    m = len(x) // hop
    env = np.sqrt((x[:m * hop].reshape(m, hop) ** 2).mean(1)) + 1e-6
    db = 20 * np.log10(np.convolve(env, np.ones(3) / 3, 'same'))
    return np.convolve(env, np.ones(5) / 5, 'same'), round(len(x) / SR * 1000), db


def acoustic(db, env, t):
    """Depth of the pause at t below the loud recitation around it, and its shape (Phase 4.1)."""
    m = len(db)
    c = min(m - 1, int(t / HOP_MS))
    lo, hi = max(0, c - 150), min(m, c + 150)
    loud = float(np.percentile(db[lo:hi], 90))
    a0, a1 = max(0, c - 15), min(m - 1, c + 15)
    k = a0 + int(np.argmin(db[a0:a1 + 1]))
    depth = loud - float(db[k])
    j = k
    while j > lo and db[j - 1] >= db[j] - 1.0 and db[j - 1] - db[k] < 60:
        j -= 1
    decay = (k - j) * HOP_MS
    rise = max(float(db[min(m - 1, k + q + 5)] - db[min(m - 1, k + q)]) for q in range(20))
    ratio = float(env[a0:a1 + 1].min() / np.median(env[lo:hi]))
    kind = 'silence' if depth >= SILENCE_DB or ratio < LOW else 'reverb-tail' if decay >= TAIL_MS and depth >= TAIL_DB and rise >= TAIL_RISE_DB else 'shallow'
    return {'kind': kind, 'depth_db': round(depth, 1), 'decay_ms': decay, 'rise_db': round(rise, 1)}


def active_ms(db, a, b):
    """Time in [a, b] ms within 20 dB of the loud recitation around it."""
    i, j = int(a / HOP_MS), int(b / HOP_MS)
    if j <= i:
        return 0
    lo, hi = max(0, i - 150), min(len(db), j + 150)
    loud = float(np.percentile(db[lo:hi], 90))
    return int((db[i:j] > loud - 20).sum()) * HOP_MS


def pauses_near(env, onset_ms):
    """The pauses (>= 150 ms under 0.35 x the local median) in [onset - 1.5 s, onset + 2 s], as [start, end] ms (align_mms.py's rule)."""
    m = len(env)
    c = int(onset_ms / HOP_MS)
    lo, hi = max(0, c - 75), min(m, c + 100)
    med = np.median(env[max(0, c - 150):min(m, c + 150)])
    quiet = list(env[lo:hi] < LOW * med) + [False]
    out, run = [], None
    for i, v in enumerate(quiet):
        if v and run is None:
            run = i
        if not v and run is not None:
            if (i - run) * HOP_MS >= MIN_PAUSE_MS:
                out.append([(lo + run) * HOP_MS, (lo + i) * HOP_MS])
            run = None
    return out


def fnv1a(entries):
    h = 0x811c9dc5
    for ayah, start, end in sorted(entries):
        for ch in f'{ayah}:{round(start)}:{round(end)};':
            h ^= ord(ch)
            h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}'


def main():
    audio, ca, cb, out, opts = args()
    A = json.load(open(ca, encoding='utf8'))
    B = json.load(open(cb, encoding='utf8')) if cb else None
    surah = A['surah']
    counts = json.load(open(opts.get('--counts', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'audit-data', 'ayah-counts.json')), encoding='utf8'))
    n = counts[surah - 1]
    env, dur, db = envelope(audio)

    # Structural checks (both configurations): every ayah once, in order, inside the audio.
    problems = []
    for name, cfg in (('A', A), ('B', B)):
        if cfg is None:
            continue
        nums = [a['ayah'] for a in cfg['ayahs']]
        if nums != list(range(1, n + 1)):
            problems.append(f'{name}: ayahs {nums[:3]}..{nums[-3:]} are not 1..{n} (missing {cfg.get("missing")})')
        if cfg['surah'] != surah:
            problems.append(f'{name}: surah {cfg["surah"]} != {surah}')
        if abs(cfg['duration_ms'] - dur) > 1000:
            problems.append(f'{name}: aligned audio is {cfg["duration_ms"]} ms, this file {dur} ms')
        if any(b['start_ms'] < a['end_ms'] - 1 for a, b in zip(cfg['ayahs'], cfg['ayahs'][1:])):
            problems.append(f'{name}: overlapping ayahs')
    b_of = {a['ayah']: a for a in B['ayahs']} if B else {}
    # Windowed comparison run (align_mms.py --anchors): the first ayah of every window after the first.
    anchored = {w[0] for w in ((B or {}).get('windows') or [])[1:]}

    boundaries = []
    prev_start = A['ayahs'][0]['boundary_ms']
    for a in A['ayahs']:
        if a['ayah'] < 2:
            continue
        pauses = pauses_near(env, a['start_ms'])
        chosen = a.get('snapped_ms')
        flags = []
        if chosen is None:
            flags.append('no-pause')
            chosen = a['boundary_ms']
            pause = None
        else:
            pause = min(pauses, key=lambda p: abs((p[0] + p[1]) / 2 - chosen)) if pauses else None
        # A start boundary must lie after the previous boundary and before this ayah's own aligned end. Very short ayahs
        # break this: the snapping window (aligned onset -1.5 s .. +2 s) can reach back before the previous boundary
        # ('reordered'), or forward to the pause AFTER this ayah, which is longer than the one before it ('past-own-end';
        # Phase 4.2: Yasser Salama 90:13, Saleh Al-Talib 86:14, …). Then: the longest pause inside those limits, else
        # the aligned midpoint, else the aligned onset; if none fits, the structure check reports the ayah.
        def valid(t):
            return prev_start + MIN_AYAH_MS < t < a['end_ms']
        moved_from = None
        if not valid(chosen):
            moved_from = chosen
            flags.append('reordered' if chosen <= prev_start + MIN_AYAH_MS else 'past-own-end')
            inside = [p for p in pauses if valid((p[0] + p[1]) / 2)]
            if inside:
                pause = max(inside, key=lambda p: p[1] - p[0])
                chosen = round((pause[0] + pause[1]) / 2)
            else:
                pause = None
                chosen = next((t for t in (a['boundary_ms'], a['start_ms']) if valid(t)), a['start_ms'])
        prev_start = chosen
        if B is not None:
            other = b_of.get(a['ayah'], {}).get('snapped_ms')
            if other is None or abs(other - chosen) > DISAGREE_MS:
                flags.append('configs-disagree')
        if pause is not None:
            length = pause[1] - pause[0]
            if length < SHORT_MS:
                flags.append('short-pause')
            rivals = [p for p in pauses if p is not pause and (p[1] - p[0]) >= max(COMPETE_MIN_MS, COMPETE_RATIO * length) and abs((p[0] + p[1]) / 2 - chosen) > COMPETE_AWAY_MS]
            if rivals:
                flags.append('competing-pause')
            if abs(chosen - a['start_ms']) > FAR_MS:
                flags.append('snap-far')
        if a.get('score', 1) < LOW_SCORE:
            flags.append('low-score')
        sound = acoustic(db, env, chosen)
        if sound['kind'] == 'shallow' and sound['depth_db'] < SHALLOW_DB:
            flags.append('shallow-pause')
        if a['ayah'] in anchored:
            flags.append('anchored')
        prev_b, this_b = b_of.get(a['ayah'] - 1), b_of.get(a['ayah'])
        if prev_b and this_b and active_ms(db, prev_b['end_ms'], this_b['start_ms']) > EXTRA_MS:
            flags.append('extra-audio')
        boundaries.append({'ayah': a['ayah'], 'chosen_ms': chosen, 'pause_ms': pause, 'pauses_in_window': pauses, 'aligned_onset_ms': a['start_ms'], 'score': a.get('score'), 'acoustic': sound, 'flags': flags, **({'moved_from_ms': moved_from} if moved_from is not None else {})})

    # The candidate timing (experimental): ayah k from its boundary to the next; ayah 1 from the aligned onset.
    starts = [A['ayahs'][0]['boundary_ms']] + [b['chosen_ms'] for b in boundaries]
    entries = [(k + 1, starts[k], starts[k + 1] if k + 1 < len(starts) else dur) for k in range(len(starts))]
    if A.get('intro'):
        entries = [(0, A['intro'][0], starts[0])] + entries
    if any(e[2] <= e[1] for e in entries):
        problems.append('a candidate ayah has no length')

    flagged = [b for b in boundaries if b['flags']]
    result = {
        'status': 'experimental',
        'checks': 'flag_boundaries.py 2026-10-18 (Phase 4.1: acoustic depth / reverberation tail, shallow-pause, anchored, extra-audio; Phase 4.2: boundaries kept between the previous boundary and each ayah’s own aligned end)',
        'publishable': False,
        'why_not_publishable': 'Aligned timing is a candidate only: it needs a listening review of every flagged boundary (and a sample of the rest) and explicit approval.',
        'surah': surah, 'audio': os.path.basename(audio), 'duration_ms': dur, 'configs': [os.path.basename(ca)] + ([os.path.basename(cb)] if cb else []),
        'structure': {'ok': not problems, 'problems': problems},
        'candidate': {'fingerprint': fnv1a(entries), 'entries': [[e[0], round(e[1]), round(e[2])] for e in entries]},
        'flags': {'boundaries': len(boundaries), 'flagged': len(flagged), 'by_flag': {f: sum(f in b['flags'] for b in boundaries) for f in ('configs-disagree', 'no-pause', 'short-pause', 'competing-pause', 'snap-far', 'low-score', 'shallow-pause', 'anchored', 'extra-audio', 'reordered', 'past-own-end')}, 'acoustic': {k: sum(b['acoustic']['kind'] == k for b in boundaries) for k in ('silence', 'reverb-tail', 'shallow')}},
        'listening_worklist': [f'{surah}:{b["ayah"] - 1}->{b["ayah"]} at {b["chosen_ms"] / 1000:.2f} s ({", ".join(b["flags"])})' for b in flagged],
        'boundaries': boundaries,
    }

    if '--reference' in opts:
        ref = json.load(open(opts['--reference'], encoding='utf8'))
        EDGE_MS = 150
        for b in boundaries:
            r = ref[b['ayah'] - 1]
            lo, hi = (r, r) if isinstance(r, (int, float)) else r
            c = b['chosen_ms']
            b['reference'] = r
            b['verdict'] = 'in-pause' if lo <= c <= hi else 'edge' if lo - EDGE_MS <= c <= hi + EDGE_MS else 'wrong-pause'
            if isinstance(r, (int, float)):
                # A start time only: the boundary is right if the reference start lies in the chosen pause (+-250 ms).
                p = b['pause_ms']
                b['verdict'] = 'in-pause' if (p and p[0] - 250 <= r <= p[1] + 250) or abs(r - c) <= 300 else 'wrong-pause'
        wrong = [b for b in boundaries if b['verdict'] == 'wrong-pause']
        result['evaluation'] = {
            'in_pause': sum(b['verdict'] == 'in-pause' for b in boundaries),
            'edge': [f'{surah}:{b["ayah"]}' for b in boundaries if b['verdict'] == 'edge'],
            'wrong': len(wrong),
            'wrong_flagged': [f'{surah}:{b["ayah"]} ({", ".join(b["flags"])})' for b in wrong if b['flags']],
            'wrong_unflagged': [f'{surah}:{b["ayah"]} chosen {b["chosen_ms"]} reference {b["reference"]}' for b in wrong if not b['flags']],
            'flagged_but_right': sum(1 for b in boundaries if b['flags'] and b['verdict'] != 'wrong-pause'),
            'flag_rate': round(len(flagged) / max(1, len(boundaries)), 3),
        }
    json.dump(result, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    ev = result.get('evaluation')
    print(f'surah {surah}: structure {"ok" if not problems else problems}; {len(flagged)}/{len(boundaries)} boundaries flagged'
          + (f'; reference: {ev["in_pause"]} in pause, {len(ev["edge"])} edge, {ev["wrong"]} wrong ({len(ev["wrong_flagged"])} flagged)' if ev else '') + ' (experimental, not publishable)')


if __name__ == '__main__':
    main()
