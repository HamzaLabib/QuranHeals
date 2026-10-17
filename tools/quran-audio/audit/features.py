"""Log-spectral features and template location, shared by align_everyayah.py (and usable from the command line).

Features: 16 kHz mono, 25 ms Hann frames every 10 ms, 32 log band energies (300-5000 Hz, geometric bands), each band
z-scored over the file. They are robust to re-encoding (bitrate, sample rate, mono/stereo), unlike raw waveforms.
`locate(X, T)`: the Pearson correlation of template T's feature matrix with X's at every lag (one row per 10 ms).

usage: python -I -X utf8 features.py <recording.mp3> <clip.mp3>...   (prints where each clip fits best, and the
       best score at least 2 s away from it: two recordings of the same audio score about 0.8-1, others below 0.6)
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402
import numpy as np  # noqa: E402

SR, HOP, WIN, NB = 16000, 160, 400, 32


def feats(path):
    """(z-scored features [frames x 32], duration in s, frame energy in dB)."""
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    x = np.asarray(d.samples, dtype=np.float32)
    n = 1 + max(0, (len(x) - WIN) // HOP)
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(WIN).astype(np.float32), 512)) ** 2
    fr = np.fft.rfftfreq(512, 1 / SR)
    edges = np.geomspace(300, 5000, NB + 1)
    bands = np.stack([spec[:, (fr >= edges[b]) & (fr < edges[b + 1])].sum(1) for b in range(NB)], 1)
    F = np.log(bands + 1e-9)
    energy_db = 10 * np.log10(bands.sum(1) + 1e-12)
    return (F - F.mean(0)) / (F.std(0) + 1e-9), len(x) / SR, energy_db


def _xcorr(a, b):
    N = 1 << (len(a) + len(b)).bit_length()
    return np.fft.irfft(np.fft.rfft(a, N) * np.conj(np.fft.rfft(b, N)), N)[:len(a) - len(b) + 1]


def locate(X, T):
    """Correlation of T with X at every lag 0..len(X)-len(T)."""
    n, B = len(T), X.shape[1]
    num = sum(_xcorr(X[:, b], T[:, b]) for b in range(B))
    s1 = np.concatenate([[0], np.cumsum(X.sum(1))])
    s2 = np.concatenate([[0], np.cumsum((X * X).sum(1))])
    sx, sxx, m = s1[n:] - s1[:-n], s2[n:] - s2[:-n], n * B
    st, stt = T.sum(), (T * T).sum()
    return (num - sx * st / m) / np.sqrt(np.maximum((sxx - sx * sx / m) * (stt - st * st / m), 1e-9))


if __name__ == '__main__':
    X, dur, _ = feats(sys.argv[1])
    print(os.path.basename(sys.argv[1]), f'{dur:.2f}s')
    for f in sys.argv[2:]:
        T, td, _ = feats(f)
        r = locate(X, T)
        i = int(np.argmax(r))
        far = np.abs(np.arange(len(r)) - i) > 200
        j = int(np.argmax(np.where(far, r, -1)))
        print(f'  {os.path.basename(f):42s} {i * 10:8d}-{i * 10 + td * 1000:8.0f} ms  score {r[i]:.3f}  2nd {r[j]:.3f}')
