"""Automated scan of one per-ayah recording (EveryAyah SSSAAA.mp3 files), for the risk classification (classify.mjs).

For every file in <files dir>: MP3 structure (audio/mp3frames.py: frames, bitrate mode, sample rate, channels, seek
header, junk), ID3 tags (title, artist, album, track, comment), and a decode (miniaudio, 16 kHz mono, the review
dashboard's timeline): duration, level, peak, clipping, leading / trailing silence, the longest internal silence, the
share of voiced audio, and whether sound runs right up to either end of the file (a possibly cut beginning or end).
Plus a coarse loudness envelope per file, for the near-duplicate check (same audio under two names).

It reads the files only; nothing is changed. It never decides anything: classify.mjs turns this into risk.

usage: python -I -X utf8 scan.py <files dir> <out.json>        (numpy + miniaudio from ../pylib)
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pylib'))
sys.path.insert(0, os.path.join(HERE, '..', 'audit'))
import numpy as np, miniaudio  # noqa: E402
from mp3frames import parse, summary  # noqa: E402

SR = 16000
FRAME = 160  # 10 ms
ENV_POINTS = 64  # near-duplicate envelope


def id3_tags(path):
    """ID3v2.3/2.4 text frames (TIT2, TPE1, TALB, TRCK, TCON, COMM) and ID3v1 title/artist, as plain strings."""
    out = {}
    with open(path, 'rb') as f:
        b = f.read(1 << 16)
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 128))
        tail = f.read(128)
    if b[:3] == b'ID3':
        ver = b[3]
        end = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127))
        i = 10
        while i + 10 <= min(end, len(b)):
            fid = b[i:i + 4]
            if not fid.strip(b'\0') or not fid.isalnum():
                break
            n = int.from_bytes(b[i + 4:i + 8], 'big') if ver == 3 else ((b[i + 4] & 127) << 21 | (b[i + 5] & 127) << 14 | (b[i + 6] & 127) << 7 | (b[i + 7] & 127))
            data = b[i + 10:i + 10 + n]
            i += 10 + n
            k = fid.decode('latin1')
            if k not in ('TIT2', 'TPE1', 'TALB', 'TRCK', 'TCON', 'COMM', 'TYER', 'TPE2') or not data:
                continue
            enc, body = data[0], data[1:]
            if k == 'COMM':
                body = body[3:]
            codec = {0: 'latin1', 1: 'utf-16', 2: 'utf-16-be', 3: 'utf-8'}.get(enc, 'latin1')
            try:
                text = body.decode(codec, 'replace')
            except Exception:  # noqa: BLE001
                text = body.decode('latin1', 'replace')
            out[k] = text.replace('\x00', ' ').strip()
    if tail[:3] == b'TAG':
        out['v1title'] = tail[3:33].split(b'\0')[0].decode('latin1', 'replace').strip()
        out['v1artist'] = tail[33:63].split(b'\0')[0].decode('latin1', 'replace').strip()
    return out


def acoustic(path):
    d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
    x = np.asarray(d.samples, dtype=np.float32)
    n = len(x)
    if n < FRAME * 5:
        return {'decodedMs': int(n * 1000 / SR), 'error': 'too short to analyse'}
    m = n // FRAME
    fr = x[:m * FRAME].reshape(m, FRAME).astype(np.float64)
    db = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
    peak = float(np.abs(x).max())
    loud = np.percentile(db, 95)
    # Voiced: within 35 dB of the file's loud level (95th percentile) and above -60 dBFS.
    thr = max(loud - 35, -60)
    voiced = db > thr
    idx = np.flatnonzero(voiced)
    lead = int(idx[0] * 10) if len(idx) else None
    trail = int((m - 1 - idx[-1]) * 10) if len(idx) else None
    # Longest internal silence (between the first and last voiced frame).
    longest = 0
    if len(idx) > 1:
        gaps = np.diff(idx) - 1
        longest = int(gaps.max() * 10)
    # Sound right at the edges: level of the first / last 30 ms relative to the loud level.
    edge = lambda seg: float(10 * np.log10((seg.astype(np.float64) ** 2).mean() + 1e-12) - loud)
    head_db = edge(x[:SR * 30 // 1000])
    tail_db = edge(x[-SR * 30 // 1000:])
    clip = float((np.abs(x) > 0.985).mean())
    # Envelope for near-duplicates: voiced span resampled to ENV_POINTS (z-scored dB).
    if len(idx) > 1:
        span = db[idx[0]:idx[-1] + 1]
        env = np.interp(np.linspace(0, len(span) - 1, ENV_POINTS), np.arange(len(span)), span)
        env = (env - env.mean()) / (env.std() + 1e-9)
    else:
        env = np.zeros(ENV_POINTS)
    return {
        'decodedMs': int(n * 1000 / SR), 'loudDb': round(float(loud), 1), 'medianDb': round(float(np.median(db)), 1), 'peak': round(peak, 4),
        'clipShare': round(clip, 5), 'leadSilenceMs': lead, 'trailSilenceMs': trail, 'longestInternalSilenceMs': longest,
        'voicedShare': round(float(voiced.mean()), 3), 'voicedMs': int(voiced.sum() * 10), 'headEdgeDb': round(head_db, 1), 'tailEdgeDb': round(tail_db, 1),
        'env': [round(float(v), 2) for v in env],
    }


def main():
    files_dir, outp = sys.argv[1], sys.argv[2]
    names = sorted(f for f in os.listdir(files_dir) if f.lower().endswith('.mp3'))
    out = {'kind': 'per-ayah-scan', 'version': 1, 'decoder': f'miniaudio {miniaudio.__version__}, {SR} Hz mono', 'files': {}}
    for k, name in enumerate(names):
        p = os.path.join(files_dir, name)
        rec = {'bytes': os.path.getsize(p)}
        with open(p, 'rb') as f:
            rec['sha256'] = hashlib.sha256(f.read()).hexdigest()
        try:
            s = summary(parse(p))
            rec['mp3'] = {k2: s[k2] for k2 in ('id3v2', 'trailer', 'seekHeader', 'audioFrames', 'sampleRates', 'channels', 'kbpsMin', 'kbpsMax', 'kbpsMean', 'distinctBitrates', 'durationS', 'problems', 'junkBytes', 'lame')}
        except Exception as e:  # noqa: BLE001
            rec['mp3'] = {'error': str(e)}
        try:
            rec['tags'] = id3_tags(p)
        except Exception as e:  # noqa: BLE001
            rec['tags'] = {'error': str(e)}
        try:
            rec['audio'] = acoustic(p)
        except Exception as e:  # noqa: BLE001
            rec['audio'] = {'error': f'decode failed: {e}'}
        out['files'][name] = rec
        if (k + 1) % 500 == 0:
            print(f'{k + 1}/{len(names)}', flush=True)
    tmp = outp + '.part'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(out, f)
    os.replace(tmp, outp)
    print(f'scanned {len(names)} files -> {outp}')


if __name__ == '__main__':
    main()
