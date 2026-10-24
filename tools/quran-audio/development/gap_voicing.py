"""What is inside the pauses between ayahs of a measured surah (audit/align_everyayah.py output) in its MP3Quran file.

For each pair of consecutive ayahs, the gap from the previous ayah's voiced end to the next ayah's voiced start, and the
VOICED time inside it: 40 ms frames (20 ms hop) louder than the surah's speech level - 30 dB whose normalised
autocorrelation peak at 70-400 Hz is >= 0.6, after 250 ms margins at both ends. Breathing and room noise are unvoiced;
recitation is voiced. With --controls, also the same measure for synthetic gaps spanning one whole ayah (previous-but-
one ayah's end to the next ayah's start): negative controls, which must always show recitation.

Evidence for supplement-measured.mjs LONG_PAUSE (Phase 4.1, Husary): in 11 production-verified Husary surahs, all 775
gaps (24 of them 4-7 s) held <= 540 ms of voiced sound; in the 11 candidate surahs, 438 of 445 gaps held <= 800 ms
(the 68 longer than 4 s: <= 500 ms) and 7 gaps of 10-81 s held 5.9-55 s (audio that is not in the per-ayah clips);
the 1,198 one-ayah controls held >= 1,440 ms.

usage: python -I -X utf8 gap_voicing.py <measured.json> <audio.mp3> <reciter id> [--controls] > out.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402
import numpy as np  # noqa: E402

SR, HOP, WIN, MARGIN_MS, FLOOR_DB, VOICED_AC = 16000, 320, 640, 250, 30, 0.6


def voiced_ms(x, a, b, floor):
    lo, hi = SR * (a + MARGIN_MS) // 1000, SR * (b - MARGIN_MS) // 1000
    voiced = active = 0
    for i in range(lo, hi - WIN, HOP):
        fr = x[i:i + WIN]
        if 20 * np.log10(np.sqrt((fr ** 2).mean()) + 1e-9) < floor:
            continue
        active += 20
        fr = (fr - fr.mean()) * np.hanning(WIN)
        ac = np.correlate(fr, fr, 'full')[WIN - 1:]
        ac /= ac[0] + 1e-12
        if ac[SR // 400:SR // 70].max() >= VOICED_AC:
            voiced += 20
    return voiced, active


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    measured, audio, reciter = sys.argv[1:4]
    m = json.load(open(measured, encoding='utf8'))
    d = miniaudio.decode_file(audio, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    x = np.asarray(d.samples, dtype=np.float32)
    ay = [a for a in m['ayahs'] if a.get('voiced_start_ms') is not None and a.get('voiced_end_ms') is not None]
    inside = np.concatenate([x[SR * a['voiced_start_ms'] // 1000:SR * a['voiced_end_ms'] // 1000] for a in ay])
    k = len(inside) // HOP
    speech = float(np.median(20 * np.log10(np.sqrt((inside[:k * HOP].reshape(k, HOP) ** 2).mean(1)) + 1e-9)))
    gaps = []
    for step, kind in ((1, 'gap'), (2, 'control')):
        if step == 2 and '--controls' not in sys.argv:
            continue
        for j in range(step, len(ay)):
            p, n = ay[j - step], ay[j]
            if n['ayah'] - p['ayah'] != step:
                continue
            a, b = p['voiced_end_ms'], n['voiced_start_ms']
            v, act = voiced_ms(x, a, b, speech - FLOOR_DB) if b - a > 2 * MARGIN_MS else (0, 0)
            gaps.append({'ayah': n['ayah'], 'kind': kind, 'gapMs': b - a, 'voicedMs': v, 'activeMs': act})
    json.dump({'reciterId': reciter, 'surah': m['surah'], 'speechDb': round(speech, 1), 'method': __doc__.split('\n\n')[1].replace('\n', ' '), 'gaps': gaps}, sys.stdout)


if __name__ == '__main__':
    main()
