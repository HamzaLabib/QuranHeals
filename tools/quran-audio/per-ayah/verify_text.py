"""Does each per-ayah file contain the ayah it is named for? Automated text evidence (torchaudio MMS_FA, GPU), for the
risk classification (classify.mjs). It never approves anything: a person decides by ear.

For every SSSAAA.mp3 (AAA = 000: the Basmala file before ayah 1) the CTC emissions are computed once, then scored
against several texts with forced alignment (star tokens at both ends, so audio outside the text costs nothing):
  expected   the canonical text of that ayah (the Basmala for AAA = 000; ayah 1 without its Basmala, as align_mms.py)
  prev/next  the neighbouring ayahs (a file holding the wrong ayah scores better on one of them)
  control    a far ayah of similar length in another surah: the wrong-text baseline for calibration
  ayah 1 files also: the Basmala + ayah 1 (is the Basmala recited inside the ayah-1 file as well?)
  AAA = 000 also: the isti'adha and ayah 1 (what else could the file hold?)
Per text: mean character probability (`score`, as align_mms.py / completeness.py), the score of the first and second
half of the text, ms per letter of the aligned span, and the VOICED audio left outside it at the start and the end
(a file holding more than its ayah). Plus a greedy CTC transcription, compared with each text (similarity 0..1).
A text longer than the audio can hold cannot be aligned at all: reported as such (the recording is incomplete).

usage: <gpu python> -I -X utf8 verify_text.py <quran-uthmani.txt> <files dir> <out.json> [--only SSSAAA,...]
       (torch, torchaudio, uroman, miniaudio, numpy; textnorm.py from ../alignment)
"""
import json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'alignment'))
import numpy as np, torch, torchaudio, miniaudio  # noqa: E402
from textnorm import load_quran  # noqa: E402
from align_mms import words_of, BASMALA, STRIP  # noqa: E402
from textnorm import normalize  # noqa: E402

ISTIADHA = 'أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ'
LETTER = re.compile('[ء-يٱ]')


def strip_basmala(q, surah, text):
    ws, bas = text.split(), q[(1, 1)].split()
    if surah not in (1, 9) and [STRIP.sub('', normalize(w)) for w in ws[:4]] == [STRIP.sub('', normalize(w)) for w in bas]:
        return ' '.join(ws[4:]), True
    return text, False


def levenshtein_ratio(a, b):
    if not a and not b:
        return 1.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return round(1 - prev[-1] / max(len(a), len(b)), 3)


def main():
    qpath, files_dir, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    q = load_quran(qpath)
    counts = {}
    for (s, a) in q:
        counts[s] = max(counts.get(s, 0), a)
    letters = {k: len(LETTER.findall(v)) for k, v in q.items()}

    def ayah_text(s, a):
        t = q[(s, a)]
        return strip_basmala(q, s, t)[0] if a == 1 else t

    def words(s, a, text=None):
        return words_of(s, a, text if text is not None else ayah_text(s, a), a == 1)

    # Wrong-text controls: for each ayah, the ayah of the nearest letter count in a surah at least 10 surahs away.
    by_len = sorted(((n, k) for k, n in letters.items()), key=lambda x: x[0])
    lens = np.array([n for n, _ in by_len])

    def control_of(s, a):
        n = letters[(s, a)]
        i = int(np.searchsorted(lens, n))
        for d in range(0, len(by_len)):
            for j in (i - d, i + d):
                if 0 <= j < len(by_len):
                    k = by_len[j][1]
                    if abs(k[0] - s) >= 10 and k[1] != 1:
                        return k
        return (114, 1)

    dev = torch.device('cuda')
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True).to(dev).eval()
    dic = bundle.get_dict(star='*')
    labels_of = {v: k for k, v in dic.items()}
    sr = bundle.sample_rate
    star = dic['*']

    def tokens_of(ws):
        return [dic[c] for w in ws for c in w if c in dic]

    def score(em, ws, frame_ms, voiced):
        toks = tokens_of(ws)
        if not toks:
            return {'error': 'no tokens'}
        targets = torch.tensor([[star] + toks + [star]], dtype=torch.int32)
        if targets.shape[1] > em.shape[1]:
            return {'error': 'text longer than the audio can hold', 'tokens': len(toks), 'frames': int(em.shape[1])}
        try:
            lab, sc = torchaudio.functional.forced_align(em.to(dev), targets.to(dev), blank=0)
        except Exception as e:  # noqa: BLE001
            return {'error': f'cannot align: {str(e)[:120]}'}
        spans = torchaudio.functional.merge_tokens(lab[0].cpu(), sc[0].exp().cpu())
        inner = spans[1:-1]
        if len(inner) != len(toks):
            return {'error': f'span count {len(inner)} != tokens {len(toks)}'}
        probs = np.array([float(x.score) for x in inner])
        h = len(probs) // 2 or 1
        a0, a1 = inner[0].start, inner[-1].end
        start_ms, end_ms = a0 * frame_ms, a1 * frame_ms
        n_letters = max(1, sum(1 for w in ws for c in w if c.isalpha()))
        # Voiced audio (10 ms frames) outside the aligned text.
        lead = int(voiced[: int(start_ms // 10)].sum() * 10)
        tail = int(voiced[int(end_ms // 10) + 1:].sum() * 10)
        return {'score': round(float(probs.mean()), 3), 'firstHalf': round(float(probs[:h].mean()), 3), 'secondHalf': round(float(probs[h:].mean()), 3),
                'startMs': int(start_ms), 'endMs': int(end_ms), 'msPerLetter': round((end_ms - start_ms) / n_letters, 1),
                'voicedBeforeMs': lead, 'voicedAfterMs': tail, 'romanized': ''.join(c for w in ws for c in w if c in dic)}

    names = sorted(f for f in os.listdir(files_dir) if re.fullmatch(r'\d{6}\.mp3', f))
    if only:
        names = [n for n in names if n[:6] in only]
    out = {'kind': 'per-ayah-text-verification', 'version': 1, 'model': 'torchaudio MMS_FA (with star)', 'text': os.path.basename(qpath), 'files': {}}
    t0 = time.time()
    for k, name in enumerate(names):
        s, a = int(name[:3]), int(name[3:6])
        rec = {}
        try:
            d = miniaudio.decode_file(os.path.join(files_dir, name), output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=sr)
            x = np.asarray(d.samples, dtype=np.float32)
            wav = torch.tensor(x)
            W, C = 30 * sr, 2 * sr
            ems = []
            with torch.inference_mode():
                for s0 in range(0, len(wav), W):
                    lo0, hi0 = max(0, s0 - C), min(len(wav), s0 + W + C)
                    em, _ = model(wav[lo0:hi0].unsqueeze(0).to(dev))
                    ratio = em.shape[1] / (hi0 - lo0)
                    lo, hi = round((s0 - lo0) * ratio), round((min(len(wav), s0 + W) - lo0) * ratio)
                    ems.append(em[0, lo:hi].cpu())
            emission = torch.cat(ems).unsqueeze(0)
            frame_ms = len(x) / sr * 1000 / emission.shape[1]
            m = len(x) // 160
            db = 10 * np.log10((x[:m * 160].reshape(m, 160).astype(np.float64) ** 2).mean(1) + 1e-12)
            voiced = db > max(np.percentile(db, 95) - 35, -60)
            # Greedy transcription over the real tokens (the star column would win every frame), blank 0 dropped,
            # repeats collapsed.
            best = emission[0, :, :star].argmax(-1).tolist()
            greedy, last = [], None
            for t in best:
                if t != last and t != 0 and t != star:
                    greedy.append(labels_of.get(t, ''))
                last = t
            greedy = ''.join(greedy)
            texts = {}
            if a == 0:
                texts['expected'] = words(1, 1, BASMALA)
                texts['istiadha'] = words(1, 1, ISTIADHA)
                if (s, 1) in q:
                    texts['ayah1'] = words(s, 1)
            else:
                texts['expected'] = words(s, a)
                if a > 1:
                    texts['prev'] = words(s, a - 1)
                if a < counts[s]:
                    texts['next'] = words(s, a + 1)
                cs, ca = control_of(s, a)
                texts['control'] = words(cs, ca)
                rec['controlRef'] = f'{cs}:{ca}'
                if a == 1 and s not in (1, 9):
                    texts['basmalaPlusExpected'] = words(1, 1, BASMALA) + words(s, 1)
            rec['scores'] = {}
            for label, ws in texts.items():
                r = score(emission, ws, frame_ms, voiced)
                if 'romanized' in r:
                    r['greedySimilarity'] = levenshtein_ratio(greedy, r.pop('romanized'))
                rec['scores'][label] = r
            rec['greedy'] = greedy[:400]
            rec['frames'] = int(emission.shape[1])
            rec['decodedMs'] = int(len(x) * 1000 / sr)
        except Exception as e:  # noqa: BLE001
            rec['error'] = f'{type(e).__name__}: {e}'
        out['files'][name] = rec
        if (k + 1) % 250 == 0:
            print(f'{k + 1}/{len(names)} {time.time() - t0:.0f}s', flush=True)
    out['seconds'] = round(time.time() - t0)
    tmp = outp + '.part'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, outp)
    print(f'verified {len(names)} files in {out["seconds"]} s -> {outp}')


if __name__ == '__main__':
    main()
