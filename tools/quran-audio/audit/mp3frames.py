"""MPEG audio (MP3) frame-level inspection (Phase 4.3): what a player's seeker sees in a file.

parse(path) -> {id3v2Bytes, trailer, frames: [(offset, size, bitrateKbps, sampleRate, samples)], seekHeader: {kind:
'Xing'|'Info'|'VBRI'|None, frames, bytes, toc, lame: {encoder, delay, padding}}, problems: [...]}

The first frame that carries a Xing/Info/VBRI header is a header frame, not audio (players skip it). Frame times are
exact: frame k starts at (sum of the samples of the audio frames before it) / sample rate.
usage: python -I -X utf8 mp3frames.py <file.mp3> [...]   (prints a summary per file)
"""
import struct
import sys

BITRATES = {  # (version bits, layer bits) -> kbps by index
    (3, 1): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],      # MPEG1 Layer III
    (2, 1): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],          # MPEG2 Layer III
    (0, 1): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],          # MPEG2.5 Layer III
}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def header(b, i):
    """Decode a 4-byte MPEG audio frame header at b[i]; None if it is not a valid Layer III header."""
    if i + 4 > len(b) or b[i] != 0xFF or (b[i + 1] & 0xE0) != 0xE0:
        return None
    ver, layer = (b[i + 1] >> 3) & 3, (b[i + 1] >> 1) & 3
    bri, sri, pad = b[i + 2] >> 4, (b[i + 2] >> 2) & 3, (b[i + 2] >> 1) & 1
    if ver == 1 or layer != 1 or bri in (0, 15) or sri == 3:
        return None
    kbps, rate = BITRATES[(ver, layer)][bri], RATES[ver][sri]
    samples = 1152 if ver == 3 else 576
    size = (144 if ver == 3 else 72) * kbps * 1000 // rate + pad
    mono = (b[i + 3] >> 6) == 3
    return {'ver': ver, 'kbps': kbps, 'rate': rate, 'samples': samples, 'size': size, 'mono': mono, 'pad': pad}


def parse(path):
    with open(path, 'rb') as fh:
        b = fh.read()
    i = 0
    id3 = 0
    if b[:3] == b'ID3':
        id3 = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (10 if b[5] & 0x10 else 0)
        i = id3
    end = len(b)
    trailer = []
    if b[-128:-125] == b'TAG':
        end -= 128
        trailer.append('ID3v1')
    if b[end - 32:end - 24] == b'APETAGEX':
        trailer.append('APE')
        end -= 32 + struct.unpack('<I', b[end - 20:end - 16])[0]
    problems = []
    # first frame: must be followed by a second valid header (avoid false syncs in junk)
    start = i
    while i < end:
        h = header(b, i)
        if h and header(b, i + h['size']):
            break
        i += 1
    if i > start:
        problems.append(f'{i - start} bytes of junk before the first frame')
    frames, junk = [], 0
    while i < end:
        h = header(b, i)
        if not h:
            j = i + 1
            while j < end and not (header(b, j) and header(b, j + header(b, j)['size'])):
                j += 1
            if j >= end:
                junk += end - i
                break
            problems.append(f'{j - i} bytes without sync at byte {i}')
            junk += j - i
            i = j
            continue
        frames.append((i, h['size'], h['kbps'], h['rate'], h['samples'], h['mono'], h['ver']))
        i += h['size']
    if frames and frames[-1][0] + frames[-1][1] > end:
        problems.append('last frame truncated')
    seek = {'kind': None}
    if frames:
        o, size, kbps, rate, samples, mono, ver = frames[0]
        side = (21 if mono else 36) if ver == 3 else (13 if mono else 21)
        tag = b[o + side:o + side + 4]
        if tag in (b'Xing', b'Info'):
            p = o + side + 4
            flags = struct.unpack('>I', b[p:p + 4])[0]; p += 4
            seek = {'kind': tag.decode(), 'frames': None, 'bytes': None, 'toc': None, 'offset': o}
            if flags & 1: seek['frames'] = struct.unpack('>I', b[p:p + 4])[0]; p += 4
            if flags & 2: seek['bytes'] = struct.unpack('>I', b[p:p + 4])[0]; p += 4
            if flags & 4: seek['toc'] = list(b[p:p + 100]); p += 100
            if flags & 8: p += 4
            enc = b[p:p + 9]
            if enc[:4] in (b'LAME', b'Lavf', b'Lavc', b'GOGO') or enc[:1].isalpha():
                d = b[p + 21:p + 24]
                seek['lame'] = {'encoder': enc.decode('latin1').strip('\x00 '), 'delay': (d[0] << 4) | (d[1] >> 4), 'padding': ((d[1] & 15) << 8) | d[2]}
        elif b[o + 36:o + 40] == b'VBRI':
            p = o + 36
            seek = {'kind': 'VBRI', 'offset': o, 'bytes': struct.unpack('>I', b[p + 10:p + 14])[0], 'frames': struct.unpack('>I', b[p + 14:p + 18])[0], 'entries': struct.unpack('>H', b[p + 18:p + 20])[0]}
    return {'path': path, 'length': len(b), 'id3v2Bytes': id3, 'trailer': trailer, 'end': end, 'frames': frames, 'seekHeader': seek, 'problems': problems, 'junkBytes': junk}


def audio_frames(info):
    """The audio frames (the seek-header frame excluded) with their exact start times in seconds."""
    fr = info['frames'][1:] if info['seekHeader']['kind'] else info['frames']
    t, out = 0, []
    for f in fr:
        out.append((f[0], t / f[3], f))
        t += f[4]
    return out, t / fr[0][3] if fr else 0


def summary(info):
    fr = info['frames']
    seek = info['seekHeader']
    audio = fr[1:] if seek['kind'] else fr
    kb = [f[2] for f in audio]
    rates = sorted({f[3] for f in audio})
    _, dur = audio_frames(info)
    data = (audio[-1][0] + audio[-1][1] - audio[0][0]) if audio else 0
    return {
        'bytes': info['length'], 'id3v2': info['id3v2Bytes'], 'trailer': info['trailer'], 'seekHeader': seek['kind'],
        'headerFrames': seek.get('frames'), 'audioFrames': len(audio), 'headerBytes': seek.get('bytes'), 'audioBytes': data,
        'toc': seek.get('toc') is not None, 'lame': seek.get('lame'), 'sampleRates': rates, 'channels': sorted({'mono' if f[5] else 'stereo' for f in audio}),
        'kbpsMin': min(kb) if kb else None, 'kbpsMax': max(kb) if kb else None, 'kbpsMean': round(data * 8 / dur / 1000, 1) if dur else None,
        'distinctBitrates': len(set(kb)), 'durationS': round(dur, 3), 'problems': info['problems'][:5], 'junkBytes': info['junkBytes'],
    }


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p.split('/')[-1], summary(parse(p)))
