"""MP3 format and tags of every cached whole-surah file of one source (surah-sources/fetch.mjs output), for the source
comparison: bitrate mode (CBR/VBR, from the frames and any Xing/Info/VBRI header), sample rate, channels, frame-exact
duration, ID3 text tags, and problems in the stream. Reads the files only.

usage: python -I -X utf8 formats.py <source cache dir> <out.json>   (../pylib, ../audit/mp3frames.py, ../per-ayah/scan.py)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'audit'))
sys.path.insert(0, os.path.join(HERE, '..', 'per-ayah'))
from mp3frames import parse, summary  # noqa: E402
from scan import id3_tags  # noqa: E402


def main():
    src, outp = sys.argv[1], sys.argv[2]
    out = {}
    for name in sorted(f for f in os.listdir(src) if f.endswith('.mp3') and len(f) == 7):
        p = os.path.join(src, name)
        try:
            s = summary(parse(p))
            mode = 'vbr' if s['distinctBitrates'] > 1 or s['seekHeader'] in ('Xing', 'VBRI') else 'cbr'
            out[int(name[:3])] = {'mode': mode, 'kbps': s['kbpsMin'] if mode == 'cbr' else round(s['kbpsMean']), 'kbpsRange': [s['kbpsMin'], s['kbpsMax']], 'sampleRates': s['sampleRates'],
                                   'channels': s['channels'], 'seekHeader': s['seekHeader'], 'durationMs': round(s['durationS'] * 1000), 'problems': s['problems'], 'junkBytes': s['junkBytes'],
                                   'id3v2': s['id3v2'], 'tags': id3_tags(p)}
        except Exception as e:  # noqa: BLE001
            out[int(name[:3])] = {'error': str(e)}
    with open(outp, 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'{len(out)} files -> {outp}')


if __name__ == '__main__':
    main()
