"""Neighbour-aware boundary evidence for per-ayah files (torchaudio MMS_FA, GPU), for severity.mjs. It never approves
anything: a person decides by ear.

verify_text.py scores each file against whole texts (its ayah, the neighbours, a far control). This adds what a whole-text
score cannot show, word by word, at the file's two edges:
  expected   the ayah's own words, each with its probability and aligned span: a word squeezed into almost no audio
             (far below the file's own pace) with a low probability is ABSENT; at the first / last word, a cut edge
  prevTail   the previous ayah's last K words + the ayah: does the file BEGIN with the end of the previous ayah?
  nextHead   the ayah + the next ayah's first K words: does the file END with the beginning of the next ayah?
  prevFull   the whole previous ayah + the ayah: is the previous ayah repeated in this file?
  nextFull   the ayah + the whole next ayah: does the file run on into the next ayah?
  ctrlTail / ctrlHead   the same with K words of a far ayah (another surah): what "not there" looks like (calibration)
Words that are really recited take real time at the reciter's pace and score well; words that are not there are squeezed
into a few frames with a low score. Each added word span also reports how much of it is voiced audio.

usage: <gpu python> -I -X utf8 boundary_check.py <quran-uthmani.txt> <files dir> <list.txt> <out.json>
       list.txt: one SSSAAA per line (AAA = 000: the Basmala file, scored on its own words only)
"""
import json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'alignment'))
sys.path.insert(0, HERE)
import numpy as np, torch, torchaudio, miniaudio  # noqa: E402
from textnorm import load_quran  # noqa: E402
from align_mms import words_of, BASMALA  # noqa: E402
from verify_text import strip_basmala  # noqa: E402

K = 3  # neighbour words at each edge
LETTER = re.compile('[ء-يٱ]')


def main():
    qpath, files_dir, listp, outp = sys.argv[1:5]
    q = load_quran(qpath)
    counts = {}
    for (s, a) in q:
        counts[s] = max(counts.get(s, 0), a)
    letters = {k: len(LETTER.findall(v)) for k, v in q.items()}
    by_len = sorted(((n, k) for k, n in letters.items()), key=lambda x: x[0])
    lens = np.array([n for n, _ in by_len])

    def control_of(s, a):
        n = letters[(s, a)]
        i = int(np.searchsorted(lens, n))
        for d in range(len(by_len)):
            for j in (i - d, i + d):
                if 0 <= j < len(by_len):
                    k = by_len[j][1]
                    if abs(k[0] - s) >= 10 and k[1] != 1:
                        return k
        return (114, 2)

    def ayah_text(s, a):
        t = q[(s, a)]
        return strip_basmala(q, s, t)[0] if a == 1 else t

    def words(s, a):
        return words_of(s, a, ayah_text(s, a), a == 1)

    dev = torch.device('cuda')
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True).to(dev).eval()
    dic = bundle.get_dict(star='*')
    sr = bundle.sample_rate
    star = dic['*']

    def toks(w):
        return [dic[c] for c in w if c in dic]

    def align(em, groups, frame_ms, voiced):
        """groups: [(label, [words])]; returns per-group word lists [(prob, startMs, endMs, letters)] or an error."""
        flat, owner = [], []
        for gi, (_, ws) in enumerate(groups):
            for wi, w in enumerate(ws):
                t = toks(w)
                flat += t
                owner += [(gi, wi)] * len(t)
        if not flat:
            return {'error': 'no tokens'}
        targets = torch.tensor([[star] + flat + [star]], dtype=torch.int32)
        if targets.shape[1] > em.shape[1]:
            return {'error': 'text longer than the audio can hold'}
        try:
            lab, sc = torchaudio.functional.forced_align(em.to(dev), targets.to(dev), blank=0)
        except Exception as e:  # noqa: BLE001
            return {'error': f'cannot align: {str(e)[:100]}'}
        spans = torchaudio.functional.merge_tokens(lab[0].cpu(), sc[0].exp().cpu())[1:-1]
        if len(spans) != len(flat):
            return {'error': f'span count {len(spans)} != tokens {len(flat)}'}
        out = {label: [] for label, _ in groups}
        acc = {}
        for (gi, wi), sp in zip(owner, spans):
            acc.setdefault((gi, wi), []).append(sp)
        for (gi, wi), sps in sorted(acc.items()):
            label, ws = groups[gi]
            st, en = sps[0].start * frame_ms, sps[-1].end * frame_ms
            vf = float(voiced[int(st // 10):int(en // 10) + 1].mean()) if en > st else 0.0
            out[label].append([round(float(np.mean([x.score for x in sps])), 3), int(st), int(en), sum(1 for c in ws[wi] if c in dic), round(vf, 2)])
        return out

    def summary(ws):
        if not ws:
            return None
        lt = max(1, sum(w[3] for w in ws))
        span = ws[-1][2] - ws[0][1]
        return {'prob': round(float(np.mean([w[0] for w in ws])), 3), 'startMs': ws[0][1], 'endMs': ws[-1][2], 'msPerLetter': round(span / lt, 1),
                'voiced': round(float(np.mean([w[4] for w in ws])), 2), 'minWordProb': round(min(w[0] for w in ws), 3)}

    names = [l.strip() for l in open(listp, encoding='utf8') if re.fullmatch(r'\d{6}', l.strip())]
    out = {'kind': 'per-ayah-boundary-check', 'version': 1, 'model': 'torchaudio MMS_FA (with star)', 'neighbourWords': K, 'files': {}}
    t0 = time.time()
    for n, name in enumerate(names):
        s, a = int(name[:3]), int(name[3:])
        rec = {}
        try:
            d = miniaudio.decode_file(os.path.join(files_dir, f'{name}.mp3'), output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=sr)
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
            em = torch.cat(ems).unsqueeze(0)
            frame_ms = len(x) / sr * 1000 / em.shape[1]
            m = len(x) // 160
            db = 10 * np.log10((x[:m * 160].reshape(m, 160).astype(np.float64) ** 2).mean(1) + 1e-12)
            voiced = (db > max(np.percentile(db, 95) - 35, -60)).astype(np.float32)
            rec['durationMs'] = int(len(x) * 1000 / sr)
            rec['voicedFirst100'] = round(float(voiced[:10].mean()), 2)
            rec['voicedLast100'] = round(float(voiced[-10:].mean()), 2)
            if a == 0:
                r = align(em, [('expected', words_of(1, 1, BASMALA, False))], frame_ms, voiced)
                rec['expected'] = r if 'error' in r else r['expected']
            else:
                E = words(s, a)
                cs, ca = control_of(s, a)
                C_ = words(cs, ca)
                rec['controlRef'] = f'{cs}:{ca}'
                runs = {'expected': [('expected', E)], 'ctrlTail': [('added', C_[-K:]), ('expected', E)], 'ctrlHead': [('expected', E), ('added', C_[:K])]}
                if a > 1:
                    P = words(s, a - 1)
                    runs['prevTail'] = [('added', P[-K:]), ('expected', E)]
                    runs['prevFull'] = [('added', P), ('expected', E)]
                if a < counts[s]:
                    N = words(s, a + 1)
                    runs['nextHead'] = [('expected', E), ('added', N[:K])]
                    runs['nextFull'] = [('expected', E), ('added', N)]
                for label, groups in runs.items():
                    r = align(em, groups, frame_ms, voiced)
                    if 'error' in r:
                        rec[label] = r
                    elif label == 'expected':
                        rec['expected'] = r['expected']
                    else:
                        rec[label] = {'added': summary(r['added']), 'expected': summary(r['expected'])}
        except Exception as e:  # noqa: BLE001
            rec['error'] = f'{type(e).__name__}: {e}'
        out['files'][name] = rec
        if (n + 1) % 200 == 0:
            print(f'{n + 1}/{len(names)} {time.time() - t0:.0f}s', flush=True)
    out['seconds'] = round(time.time() - t0)
    tmp = outp + '.part'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(out, f)
    os.replace(tmp, outp)
    print(f'checked {len(names)} files in {out["seconds"]} s -> {outp}')


if __name__ == '__main__':
    main()
