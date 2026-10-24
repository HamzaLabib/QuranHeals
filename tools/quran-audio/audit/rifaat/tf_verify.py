"""Teacher-forced content check (diagnostic): Whisper large-v3-turbo scores, for each 30 s window (hop TF_HOP, default 10 s), how
likely each candidate text is given the audio - every run of 1-3 (TF_MAXSPAN) consecutive ayahs of the EXPECTED surah, and the same
for a CONTROL surah (different text, similar style). Nothing is decoded freely, so hallucinations cannot appear; but a
model forced to read a text always gives some score, so only the margin over the control counts as evidence.
Scores are made relative (PMI): each candidate's log-prob minus its mean log-prob on BASELINE audio (windows of the same
reciter reciting other surahs), which removes the text's own prior likelihood. Per window: best expected span, its
relative score, best control score. Silent windows skipped.
usage: python -X utf8 tf_verify.py <quran.txt> <model dir> <audio> <surah> <control surah> <out.json> <baseline audio>..."""
import json, sys, re, numpy as np, torch, miniaudio
from transformers import WhisperForConditionalGeneration, WhisperProcessor
qp, mp, audio, s, c, outp = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
BASE = sys.argv[7:]
import os
KS = tuple(range(1, int(os.environ.get('TF_MAXSPAN', '3')) + 1)); HOP = int(os.environ.get('TF_HOP', '10'))
DIAC = re.compile('[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]')
def plain(t):
    t = DIAC.sub('', t).replace('ٱ', 'ا')
    return re.sub('[^ء-ي ]', '', t).strip()
Q = {}
for line in open(qp, encoding='utf8'):
    p = line.rstrip('\n').split('|')
    if len(p) == 3 and p[0].isdigit(): Q.setdefault(int(p[0]), []).append(plain(p[2]))
def spans(su):
    a = Q[su]; return [((su, i + 1, i + k), ' '.join(a[i:i + k])) for k in KS for i in range(len(a) - k + 1)]
cands = spans(s) + spans(c)
dev = torch.device(os.environ.get('TF_DEVICE', 'cuda')); DT = torch.float16 if dev.type == 'cuda' else torch.float32
proc = WhisperProcessor.from_pretrained(mp)
model = WhisperForConditionalGeneration.from_pretrained(mp, torch_dtype=DT).to(dev).eval()
tok = proc.tokenizer
prefix = tok.convert_tokens_to_ids(['<|startoftranscript|>', '<|ar|>', '<|transcribe|>', '<|notimestamps|>'])
enc_t = [tok.encode(' ' + t, add_special_tokens=False) + [tok.eos_token_id] for _, t in cands]
SR = 16000
load = lambda p: np.asarray(miniaudio.decode_file(p, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR).samples, dtype=np.float32)
def score(w):
    f = proc(w, sampling_rate=SR, return_tensors='pt').input_features.to(dev, DT)
    with torch.inference_mode():
        e = model.model.encoder(f).last_hidden_state
        scores = []
        for b in range(0, len(enc_t), 48):
            batch = enc_t[b:b + 48]; L = max(map(len, batch))
            ids = torch.full((len(batch), 4 + L), tok.eos_token_id, device=dev)
            mask = torch.zeros((len(batch), 4 + L), device=dev)
            for i, t in enumerate(batch):
                ids[i, :4] = torch.tensor(prefix); ids[i, 4:4 + len(t)] = torch.tensor(t); mask[i, 4:4 + len(t)] = 1
            logits = model(encoder_outputs=(e.expand(len(batch), -1, -1),), decoder_input_ids=ids[:, :-1]).logits.float()
            lp = torch.log_softmax(logits, -1).gather(2, ids[:, 1:, None])[..., 0] * mask[:, 1:]
            scores += (lp.sum(1) / mask[:, 1:].sum(1)).tolist()
    return np.array(scores)
def windows(x):
    for s0 in range(0, max(1, len(x) - 10 * SR), HOP * SR):
        w = x[s0:s0 + 30 * SR]
        if (np.abs(w) > 1e-3).mean() >= 0.2: yield s0 / SR, w
base = []
for p in BASE:
    ws = list(windows(load(p))); base += [score(w) for _, w in ws[1:-1][::max(1, len(ws) // 6)][:6]]
base = np.mean(base, 0)
out = []
for t, w in windows(load(audio)):
    r = score(w) - base
    best = lambda su: max(((r[i], k) for i, (k, _) in enumerate(cands) if k[0] == su), key=lambda z: z[0])
    (es, ek), (cs, ck) = best(s), best(c)
    out.append({'t': t, 'span': [ek[1], ek[2]], 'rel': round(float(es), 3), 'control': [ck[0], ck[1], ck[2]], 'controlRel': round(float(cs), 3)})
    print(f"{t:6.0f}s  {s}:{ek[1]}-{ek[2]} {es:6.2f}   control {c}:{ck[1]}-{ck[2]} {cs:6.2f}   margin {es-cs:5.2f}", flush=True)
json.dump(out, open(outp, 'w'), indent=1)
