"""Diagnostic (Phase 4.2): what is recited, independently of the expected text.

Transcribes the file in 20 s windows (10 s hop) with a Whisper model given as a local folder - Phase 4.2 used
tarteel-ai/whisper-base-ar-quran (Apache-2.0), Phase 4.5 openai/whisper-large-v3-turbo (MIT) - skipping windows that are mostly silence, then locates each window's transcript in the WHOLE
Quran (all 6,236 ayahs, diacritics removed) by character-trigram similarity. Output per window: the transcript, the
best-matching ayahs anywhere in the Quran, and their similarity. This identifies the surah, the ayah order, repetitions,
omissions and non-Quran audio (introductions, speech) without trusting the expected surah.

usage: python -X utf8 transcribe.py <quran-uthmani.txt> <audio> <out.json> <model dir>
"""
import json, re, sys
from collections import Counter
import numpy as np, torch, miniaudio
from transformers import WhisperForConditionalGeneration, WhisperProcessor

q_path, audio, out_path = sys.argv[1:4]
MODEL = sys.argv[4] if len(sys.argv) > 4 else None
DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')


def norm(t):
    t = DIAC.sub('', t)
    t = t.replace('ٱ', 'ا').replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    return re.sub('[^ء-ي ]', '', t)


ayahs = []
for line in open(q_path, encoding='utf8'):
    p = line.rstrip('\n').split('|')
    if len(p) == 3 and p[0].isdigit():
        ayahs.append((int(p[0]), int(p[1]), norm(p[2]).replace(' ', '')))
grams = lambda s: Counter(s[i:i + 3] for i in range(len(s) - 2))
index = [(s, a, grams(t), len(t)) for s, a, t in ayahs]

dev = torch.device('cuda')
import os
name = MODEL
proc = WhisperProcessor.from_pretrained(name)
model = WhisperForConditionalGeneration.from_pretrained(name, torch_dtype=torch.float16).to(dev).eval()
SR = 16000
d = miniaudio.decode_file(audio, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
x = np.asarray(d.samples, dtype=np.float32)
WIN, HOP = 20 * SR, 10 * SR
out = []
for s0 in range(0, max(1, len(x) - HOP), HOP):
    w = x[s0:s0 + WIN]
    if (np.abs(w) > 1e-3).mean() < 0.15:
        continue
    feats = proc(w, sampling_rate=SR, return_tensors='pt').input_features.to(dev, torch.float16)
    with torch.inference_mode():
        ids = model.generate(feats, max_new_tokens=200, language='ar', task='transcribe')
    text = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    t = norm(text).replace(' ', '')
    g = grams(t)
    matches = []
    if len(t) >= 6:
        tot = sum(g.values())
        for s, a, ag, ln in index:
            common = sum((g & ag).values())
            if common:
                # share of the window's trigrams found in the ayah (windows can hold part of a long ayah)
                matches.append((round(common / tot, 3), s, a))
        matches.sort(reverse=True)
    out.append({'from_s': s0 // SR, 'text': text, 'best': matches[:3]})
    print(f'{s0 // SR:5d}s  {text[:70]}  ->  {matches[:2]}', flush=True)
json.dump({'audio': audio, 'windows': out}, open(out_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
