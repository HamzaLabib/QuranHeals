"""Make a VBR MP3 seekable to an exact ayah (Phase 4.3). Writes a NEW file; the source is never modified.

  mllt  LOSSLESS. Adds an exact seek table (ID3v2 MLLT, one reference per audio frame) and the duration (TLEN) to the
        file's existing ID3v2.3 tag. Every other byte - the Xing/LAME header frame (gapless info) and every audio
        frame - is copied unchanged, so the decoded audio and its timeline are identical. androidx.media3 (Android)
        prefers MLLT over the Xing table (Mp3Extractor.computeSeeker: "Metadata takes priority"). iOS AVFoundation is
        not known to read MLLT: iOS seeking is unchanged by this mode.
  cbr   LOSSY (re-encode). Decodes the file and encodes constant-bitrate MP3 (LAME via lameenc) at the same sample rate
        and channel count, at a bitrate at or above the source's mean; adds an ID3 iTunSMPB comment with the measured
        encoder delay so players that honour it start on the source's sample 0. Constant bitrate is seekable by byte
        arithmetic on every player.

usage: python -I -X utf8 vbr_recover.py mllt <in.mp3> <out.mp3>
       <venv python> -X utf8 vbr_recover.py cbr <in.mp3> <out.mp3> <kbps>     (needs lameenc)
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import mp3frames  # noqa: E402


def synchsafe(n):
    return bytes([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127])


def id3v23_frame(fid, payload):
    return fid.encode('ascii') + struct.pack('>I', len(payload)) + b'\x00\x00' + payload


def mllt_payload(info):
    """One reference per audio frame (positions and millisecond times exact; times rounded per reference)."""
    audio, duration = mp3frames.audio_frames(info)
    bytes_d, ms_d = [], []
    prev_pos, prev_ms = audio[0][0], 0
    for pos, t, _ in audio[1:]:
        ms = round(t * 1000)
        bytes_d.append(pos - prev_pos)
        ms_d.append(ms - prev_ms)
        prev_pos, prev_ms = pos, ms
    b0, m0 = min(bytes_d), min(ms_d)
    bb = max(1, max(d - b0 for d in bytes_d).bit_length())
    mb = max(1, max(d - m0 for d in ms_d).bit_length())
    if bb + mb < 8:  # Id3Decoder counts references as floor(bits / bitsPerReference): keep padding below one reference
        bb = 8 - mb
    bits = []
    for d, m in zip(bytes_d, ms_d):
        bits.append(format(d - b0, f'0{bb}b'))
        bits.append(format(m - m0, f'0{mb}b'))
    s = ''.join(bits)
    s += '0' * (-len(s) % 8)
    refs = int(s, 2).to_bytes(len(s) // 8, 'big') if s else b''
    head = struct.pack('>H', 1) + b0.to_bytes(3, 'big') + m0.to_bytes(3, 'big') + bytes([bb, mb])
    assert (8 * len(refs)) // (bb + mb) == len(bytes_d), 'reference count would be misread'
    return head + refs, {'references': len(bytes_d), 'bitsPerReference': bb + mb, 'durationMs': round(duration * 1000)}


def insert_id3_frames(data, frames):
    """Insert ID3v2.3 frames after the existing frames (before any padding) and fix the tag size."""
    assert data[:3] == b'ID3' and data[3] == 3 and data[5] == 0, 'expects an ID3v2.3 tag without flags'
    size = (data[6] & 127) << 21 | (data[7] & 127) << 14 | (data[8] & 127) << 7 | (data[9] & 127)
    p, end = 10, 10 + size
    while p + 10 <= end and data[p:p + 4] != b'\x00\x00\x00\x00':
        fid = data[p:p + 4]
        for existing in frames:
            assert fid != existing[:4], f'tag already has a {fid.decode()} frame'
        p += 10 + struct.unpack('>I', data[p + 4:p + 8])[0]
    add = b''.join(frames)
    return data[:6] + synchsafe(size + len(add)) + data[10:p] + add + data[p:], len(add)


def mllt(src, dst):
    with open(src, 'rb') as fh:
        data = fh.read()
    info = mp3frames.parse(src)
    payload, meta = mllt_payload(info)
    tlen = id3v23_frame('TLEN', b'\x00' + str(meta['durationMs']).encode('ascii'))
    out, added = insert_id3_frames(data, [id3v23_frame('MLLT', payload), tlen])
    old_tag = info['id3v2Bytes']
    assert out[old_tag + added:] == data[old_tag:], 'bytes after the tag must be unchanged'
    with open(dst, 'wb') as fh:
        fh.write(out)
    meta.update({'addedBytes': added, 'mode': 'mllt'})
    return meta


def cbr(src, dst, kbps):
    import lameenc
    import miniaudio
    import numpy as np
    d = miniaudio.mp3_read_file_s16(src)
    pcm = np.frombuffer(d.samples, dtype=np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(int(kbps))
    enc.set_in_sample_rate(d.sample_rate)
    enc.set_channels(d.nchannels)
    enc.set_quality(2)  # 2 = high quality (slow)
    body = enc.encode(pcm.tobytes()) + enc.flush()
    with open(dst, 'wb') as fh:
        fh.write(bytes(body))
    return {'mode': 'cbr', 'kbps': int(kbps), 'sampleRate': d.sample_rate, 'channels': d.nchannels, 'sourceSamples': len(pcm) // d.nchannels}


if __name__ == '__main__':
    mode, src, dst = sys.argv[1:4]
    if os.path.abspath(src) == os.path.abspath(dst):
        sys.exit('refusing to overwrite the source')
    print(mllt(src, dst) if mode == 'mllt' else cbr(src, dst, sys.argv[4]))
