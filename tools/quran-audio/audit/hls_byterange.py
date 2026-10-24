"""An HLS media playlist that describes an UNMODIFIED MP3 file as byte-range segments (Phase 4.4 experiment).

Each segment is a run of whole MPEG audio frames (about `seconds` long) of the original file, addressed with
EXT-X-BYTERANGE on the original URL; EXTINF is the segment's exact duration (frames x samples per frame / sample rate).
The first segment starts at byte 0, so it carries the file's ID3 tag and Xing/LAME header frame. No audio byte is
copied or changed: only this text (metadata) would be hosted.

Caveat: RFC 8216 requires each packed-audio segment to start with an ID3 PRIV timestamp; original MP3 bytes have none.
androidx.media3 falls back to the playlist time (HlsMediaChunk.prepareExtraction); iOS AVPlayer behaviour is unverified.

usage: python -I -X utf8 hls_byterange.py <file.mp3> <original url> <out.m3u8> [seconds=6]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp3frames  # noqa: E402


def playlist(path, url, seconds=6.0):
    info = mp3frames.parse(path)
    audio, _ = mp3frames.audio_frames(info)
    f0 = audio[0][2]
    spf, rate = f0[4], f0[3]
    per = max(1, round(seconds * rate / spf))
    segs = []
    start_byte = 0  # the first segment includes the ID3 tag and the seek-header frame
    for i in range(0, len(audio), per):
        chunk = audio[i:i + per]
        end = chunk[-1][2][0] + chunk[-1][2][1]
        segs.append((len(chunk) * spf / rate, end - start_byte, start_byte))
        start_byte = end
    lines = ['#EXTM3U', '#EXT-X-VERSION:4', f'#EXT-X-TARGETDURATION:{math.ceil(max(s[0] for s in segs))}', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD']
    for dur, length, offset in segs:
        lines += [f'#EXTINF:{dur:.6f},', f'#EXT-X-BYTERANGE:{length}@{offset}', url]
    lines.append('#EXT-X-ENDLIST')
    return '\n'.join(lines) + '\n', {'segments': len(segs), 'framesPerSegment': per, 'bytes': start_byte, 'fileBytes': info['length']}


if __name__ == '__main__':
    text, meta = playlist(sys.argv[1], sys.argv[2], float(sys.argv[4]) if len(sys.argv) > 4 else 6.0)
    open(sys.argv[3], 'w', encoding='ascii', newline='\n').write(text)
    print(meta)
