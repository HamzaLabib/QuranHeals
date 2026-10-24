"""Waveform and quiet regions of one recording, for the review dashboard (review/dashboard/server.mjs).

Reads the UNMODIFIED audio file and writes what the page draws; it never changes the audio:
  - identity: size and SHA-256 of the file;
  - durationMs and a waveform (min/max per 5 ms, int8, base64) on the decoded timeline: miniaudio, 16 kHz mono, the
    same decoder and rate the aligner (alignment/align_mms.py) times boundaries on;
  - quiet regions by the rule of review/manual/prepare.py (10 ms frames, 30 dB under the median level, at least
    300 ms, or 200 ms of digital silence). They are places to listen, never boundaries.
The decode is streamed, so a two-hour surah needs a few MB of memory.

--pcm <out.wav>: also writes a lossless 16-bit PCM decode at the file's own rate and channels. The dashboard plays it
instead of the MP3 only for VBR files, which a browser cannot seek exactly; it is a local review copy, never published.

usage: python -I peaks.py <audio> <out.json> [--pcm <out.wav>]   (numpy + miniaudio from ../../pylib)
"""
import base64, hashlib, json, os, struct, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'pylib'))
import numpy as np, miniaudio  # noqa: E402

SR, BIN_MS, FRAME = 16000, 5, 160  # 16 kHz; 5 ms waveform bins (80 samples); 10 ms quiet-rule frames


def main():
    audio, outp = sys.argv[1], sys.argv[2]
    pcm = sys.argv[sys.argv.index('--pcm') + 1] if '--pcm' in sys.argv else None
    h = hashlib.sha256()
    with open(audio, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    size = os.path.getsize(audio)

    bin_n = SR * BIN_MS // 1000
    mins, maxs, dbs, zero = [], [], [], []
    carry = np.zeros(0, dtype=np.float32)
    total = 0
    for chunk in miniaudio.stream_file(audio, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR, frames_to_read=SR * 10):
        x = np.concatenate([carry, np.asarray(chunk, dtype=np.float32)])
        total += len(chunk)
        n = len(x) // FRAME * FRAME  # FRAME is a multiple of bin_n
        if n:
            b = x[:n].reshape(-1, bin_n)
            mins.append(b.min(1)); maxs.append(b.max(1))
            fr = x[:n].reshape(-1, FRAME)
            zero.append((np.abs(fr) < 1e-5).all(1)); dbs.append(10 * np.log10((fr.astype(np.float64) ** 2).mean(1) + 1e-12))
        carry = x[n:]
    if len(carry):
        pad = np.zeros(FRAME, dtype=np.float32); pad[:len(carry)] = carry
        b = pad[:(len(carry) + bin_n - 1) // bin_n * bin_n].reshape(-1, bin_n)
        mins.append(b.min(1)); maxs.append(b.max(1))
    cat = lambda xs, dt: np.concatenate(xs) if xs else np.zeros(0, dtype=dt)
    mins, maxs, dbs, zero = cat(mins, np.float32), cat(maxs, np.float32), cat(dbs, np.float64), cat(zero, bool)
    q = lambda v: base64.b64encode(np.clip(np.round(v * 127), -127, 127).astype(np.int8).tobytes()).decode()

    med = np.median(dbs[~zero]) if (~zero).any() else -40
    quiet = zero | (dbs < med - 30)
    qe = np.flatnonzero(np.diff(np.r_[0, quiet.astype(np.int8), 0]))
    regions = []
    for a, b in zip(qe[::2], qe[1::2]):
        length = (b - a) * 10
        if (zero[a:b].all() and length >= 200) or length >= 300:
            regions.append({'fromMs': int(a * 10), 'toMs': int(b * 10), 'kind': 'digital silence' if zero[a:b].all() else 'quiet dip'})

    out = {
        'kind': 'review-waveform', 'version': 1, 'bytes': size, 'sha256': h.hexdigest(),
        'durationMs': int(total * 1000 / SR),
        'timeline': 'decoded audio (miniaudio, 16 kHz mono: the aligner\'s timeline); the browser may differ by up to one MP3 frame (26 ms) on CBR files',
        'peaks': {'binMs': BIN_MS, 'min': q(mins), 'max': q(maxs)},
        'quiet': regions, 'quietRule': '10 ms frames 30 dB under the median level for >= 300 ms, or digital silence >= 200 ms (review/manual/prepare.py)',
    }

    if pcm:
        info = miniaudio.get_file_info(audio)
        ch, rate = info.nchannels, info.sample_rate
        tmp = pcm + '.part'
        frames = 0
        with open(tmp, 'wb') as w:
            w.write(b'\0' * 44)
            for chunk in miniaudio.stream_file(audio, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=ch, sample_rate=rate, frames_to_read=rate * 10):
                w.write(chunk.tobytes()); frames += len(chunk) // ch
            data = frames * ch * 2
            w.seek(0)
            w.write(b'RIFF' + struct.pack('<I', 36 + data) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, ch, rate, rate * ch * 2, ch * 2, 16) + b'data' + struct.pack('<I', data))
        os.replace(tmp, pcm)
        out['pcm'] = {'file': os.path.basename(pcm), 'sampleRate': rate, 'channels': ch, 'durationMs': int(frames * 1000 / rate),
                      'note': 'lossless 16-bit PCM decode of the unmodified file (miniaudio), for exact seeking of a VBR file; local review copy only'}

    tmp = outp + '.part'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(out, f)
    os.replace(tmp, outp)
    print(json.dumps({'durationMs': out['durationMs'], 'quiet': len(regions), 'sha256': out['sha256'][:12], 'pcm': bool(pcm)}))


if __name__ == '__main__':
    main()
