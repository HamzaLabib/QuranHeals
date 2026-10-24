"""Is every surah of a recording the same VOICE? ECAPA speaker embeddings (speechbrain spkrec-ecapa-voxceleb, CPU).

For each file: the mean embedding of up to 4 windows of 8 s (at 20/40/60/80 % of the file, skipping the opening).
Each surah is compared (cosine) with the centroid of all the recording's surahs (leave-one-out), and with control
files of another reciter. Evidence for the attribution being one person throughout; it never proves WHO the person is.

usage: <python with torch, speechbrain, miniaudio> -X utf8 voice.py <selected.json> <out.json> [--control <name> <file> ...]
"""
import json, os, sys

import numpy as np, torch, miniaudio
from speechbrain.inference.speaker import EncoderClassifier

SR, WIN = 16000, 8


def embed(model, path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    x = np.asarray(d.samples, dtype=np.float32)
    n = len(x)
    wins = []
    for f in (0.2, 0.4, 0.6, 0.8):
        a = int(n * f)
        seg = x[a:a + WIN * SR]
        if len(seg) >= 3 * SR:
            wins.append(seg)
    if not wins:
        wins = [x[: WIN * SR]]
    with torch.inference_mode():
        e = [model.encode_batch(torch.tensor(w).unsqueeze(0)).squeeze().numpy() for w in wins]
    v = np.mean(e, 0)
    return v / np.linalg.norm(v)


def main():
    sel = json.load(open(sys.argv[1], encoding='utf8'))
    outp = sys.argv[2]
    controls = []
    if '--control' in sys.argv:
        rest = sys.argv[sys.argv.index('--control') + 1:]
        controls = [(rest[i], rest[i + 1]) for i in range(0, len(rest) - 1, 2)]
    # Offline from a local copy of the model when given (QH_ECAPA_DIR: a Hugging Face snapshot folder), else downloaded.
    model = EncoderClassifier.from_hparams(source=os.environ.get('QH_ECAPA_DIR', 'speechbrain/spkrec-ecapa-voxceleb'), savedir=os.path.join(os.path.expanduser('~'), '.cache', 'speechbrain-ecapa'), run_opts={'device': 'cpu'})
    emb = {}
    for s, x in sorted(sel['surahs'].items(), key=lambda kv: int(kv[0])):
        emb[int(s)] = embed(model, x['file'])
    M = np.array(list(emb.values()))
    total = M.sum(0)
    out = {'model': 'speechbrain/spkrec-ecapa-voxceleb', 'surahs': {}, 'controls': {}}
    for s, v in emb.items():
        c = total - v
        c /= np.linalg.norm(c)
        out['surahs'][s] = {'source': sel['surahs'][str(s)]['source'], 'toCentroid': round(float(v @ c), 3)}
    centroid = total / np.linalg.norm(total)
    for name, f in controls:
        v = embed(model, f)
        out['controls'][name] = round(float(v @ centroid), 3)
    vals = sorted(x['toCentroid'] for x in out['surahs'].values())
    out['summary'] = {'min': vals[0], 'p5': vals[len(vals) // 20], 'median': vals[len(vals) // 2], 'controlsMax': max(out['controls'].values()) if out['controls'] else None}
    json.dump(out, open(outp, 'w', encoding='utf8'), indent=1)
    print(json.dumps(out['summary']), json.dumps(out['controls']))
    print('lowest', sorted(((x['toCentroid'], s, x['source']) for s, x in out['surahs'].items()))[:8])


if __name__ == '__main__':
    main()
