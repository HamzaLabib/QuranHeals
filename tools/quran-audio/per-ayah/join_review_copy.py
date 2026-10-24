"""One surah of a per-ayah recording as ONE local review copy, for the audio review dashboard: the files played in the
app's order (the Basmala file SSS000 first where the surah has one, then SSS001..SSSnnn), end to end.

The copy is never published and the files are never re-encoded:
  - same sample rate and channels throughout: the MP3 audio frames of every file, joined in order (ID3 tags and any
    Xing/Info header frame dropped). Each file then starts exactly at the sum of the frames before it (1152 samples per
    MPEG-1 Layer III frame), which is the review timeline;
  - otherwise (a surah mixing formats, e.g. 4:60-87 at 11 kHz mono among 44.1 kHz stereo files): a 16-bit PCM WAV
    decode of every file at one rate (miniaudio), the offsets counted in decoded samples.
Prints JSON: {file, kind: 'mp3-frames' | 'wav', bytes, sha256, durationMs, segments: [{name, startMs, endMs}]}.

usage: python -I -X utf8 join_review_copy.py <files dir> <surah> <out path without extension> [--basmala|--no-basmala]
"""
import hashlib, json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pylib'))
sys.path.insert(0, os.path.join(HERE, '..', 'audit'))
import numpy as np, miniaudio  # noqa: E402
from mp3frames import parse  # noqa: E402

WAV_RATE = 22050


def main():
    files_dir, surah, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    basmala = '--no-basmala' not in sys.argv and surah not in (1, 9)
    names = sorted(f for f in os.listdir(files_dir) if f.startswith(f'{surah:03d}') and f.endswith('.mp3') and len(f) == 10)
    names = [n for n in names if n != f'{surah:03d}000.mp3' or basmala]
    infos = [parse(os.path.join(files_dir, n)) for n in names]
    audio = [(i['frames'][1:] if i['seekHeader']['kind'] else i['frames']) for i in infos]
    formats = {(f[3], f[5], f[6]) for fr in audio for f in fr}
    segments = []
    if len(formats) == 1:
        rate = next(iter(formats))[0]
        path = out + '.mp3'
        h = hashlib.sha256()
        samples = 0
        with open(path + '.part', 'wb') as w:
            for n, info, fr in zip(names, infos, audio):
                with open(info['path'], 'rb') as f:
                    b = f.read()
                start = samples
                for (o, size, *_rest) in fr:
                    chunk = b[o:o + size]
                    w.write(chunk)
                    h.update(chunk)
                samples += sum(f[4] for f in fr)
                segments.append({'name': n, 'startMs': round(start * 1000 / rate), 'endMs': round(samples * 1000 / rate)})
        os.replace(path + '.part', path)
        kind, duration = 'mp3-frames', round(samples * 1000 / rate)
    else:
        path = out + '.wav'
        frames = 0
        with open(path + '.part', 'wb') as w:
            w.write(b'\0' * 44)
            for n in names:
                d = miniaudio.decode_file(os.path.join(files_dir, n), output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=WAV_RATE)
                x = np.asarray(d.samples, dtype=np.int16)
                start = frames
                w.write(x.tobytes())
                frames += len(x)
                segments.append({'name': n, 'startMs': round(start * 1000 / WAV_RATE), 'endMs': round(frames * 1000 / WAV_RATE)})
            data = frames * 2
            w.seek(0)
            w.write(b'RIFF' + struct.pack('<I', 36 + data) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, WAV_RATE, WAV_RATE * 2, 2, 16) + b'data' + struct.pack('<I', data))
        os.replace(path + '.part', path)
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        kind, duration = 'wav', round(frames * 1000 / WAV_RATE)
    print(json.dumps({'file': path, 'kind': kind, 'bytes': os.path.getsize(path), 'sha256': h.hexdigest(), 'durationMs': duration,
                      'formats': sorted(f'{r} Hz {"mono" if m else "stereo"}' for r, m, _v in formats), 'segments': segments}))


if __name__ == '__main__':
    main()
