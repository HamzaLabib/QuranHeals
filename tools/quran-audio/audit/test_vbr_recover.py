"""Regression tests for the VBR seek recovery (Phase 4.3): mp3frames.py, seek_sim.py, vbr_recover.py (mllt).

A synthetic VBR file is built from silent MPEG-1 Layer III frames of varying bitrate behind an Xing header with a
100-entry TOC and an ID3v2.3 tag, as in the MP3Quran files. No network, no real recordings.
usage: python -I -X utf8 test_vbr_recover.py
"""
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp3frames  # noqa: E402
import seek_sim  # noqa: E402
import vbr_recover  # noqa: E402

KBPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]


def frame(kbps, payload=b''):
    """One MPEG-1 Layer III 44.1 kHz stereo frame of the given bitrate (silent side info, no padding)."""
    idx = [0] + KBPS
    hdr = bytes([0xFF, 0xFB, (idx.index(kbps) << 4) | (0 << 2), 0x00])
    size = 144 * kbps * 1000 // 44100
    body = payload + b'\x00' * (size - 4 - len(payload))
    return hdr + body


def build(path, n=3000, seed=7):
    import random
    rnd = random.Random(seed)
    # strongly variable bitrate in blocks, so a 100-entry TOC is inaccurate
    rates = []
    while len(rates) < n:
        rates += [rnd.choice([32, 64, 320, 128])] * rnd.randint(5, 120)
    rates = rates[:n]
    audio = b''.join(frame(k) for k in rates)
    total = len(audio)
    toc, acc, sizes = [], 0, [144 * k * 1000 // 44100 for k in rates]
    cum = [0]
    for sz in sizes:
        cum.append(cum[-1] + sz)
    for i in range(100):
        k = int(n * i / 100)
        toc.append(min(255, int(cum[k] * 256 / total)))
    xing = b'\x00' * 32 + b'Xing' + struct.pack('>I', 7) + struct.pack('>I', n) + struct.pack('>I', total + 417) + bytes(toc)
    xing += b'LAME3.100' + b'\x00' * 12 + bytes([0x24, 0x02, 0x40])  # encoder string, delay 576, padding 576
    head = frame(128, xing)
    tag_body = vbr_recover.id3v23_frame('TIT2', b'\x00test')
    tag = b'ID3\x03\x00\x00' + vbr_recover.synchsafe(len(tag_body) + 64) + tag_body + b'\x00' * 64
    with open(path, 'wb') as fh:
        fh.write(tag + head + audio)
    return rates


class VbrRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls.dir.name, 'vbr.mp3')
        cls.rates = build(cls.src)
        cls.dst = os.path.join(cls.dir.name, 'mllt.mp3')
        cls.meta = vbr_recover.mllt(cls.src, cls.dst)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_parser_reads_frames_and_xing(self):
        info = mp3frames.parse(self.src)
        s = mp3frames.summary(info)
        self.assertEqual(s['seekHeader'], 'Xing')
        self.assertEqual(s['audioFrames'], len(self.rates))
        self.assertEqual(s['headerFrames'], len(self.rates))
        self.assertEqual(s['lame'], {'encoder': 'LAME3.100', 'delay': 576, 'padding': 576})
        self.assertEqual(s['kbpsMin'], 32)
        self.assertEqual(s['kbpsMax'], 320)

    def test_original_xing_seeking_is_inaccurate(self):
        m = seek_sim.Model(mp3frames.parse(self.src))
        self.assertEqual(m.kind, 'Xing')
        worst = max(abs(m.error_ms(t)) for t in range(1000, 75000, 997))
        self.assertGreater(worst, 100)

    def test_mllt_copy_keeps_every_audio_byte_and_the_lame_header(self):
        with open(self.src, 'rb') as f1, open(self.dst, 'rb') as f2:
            src, dst = f1.read(), f2.read()
        a, b = mp3frames.parse(self.src), mp3frames.parse(self.dst)
        self.assertEqual(dst[b['id3v2Bytes']:], src[a['id3v2Bytes']:])
        self.assertEqual(b['seekHeader']['lame'], a['seekHeader']['lame'])
        self.assertEqual(self.meta['references'], len(self.rates) - 1)

    def test_mllt_seeking_is_within_one_frame(self):
        info = mp3frames.parse(self.dst)
        tab = seek_sim.mllt_table(info, 1)
        m = seek_sim.Model(info, mllt=tab)
        errors = [m.error_ms(t) for t in range(0, 75000, 331)]
        self.assertGreaterEqual(min(errors), -1.0)
        self.assertLessEqual(max(errors), 26.2)  # at most one 1152-sample frame late, as constant-bitrate files

    def test_refuses_to_overwrite_and_second_mllt(self):
        with self.assertRaises(AssertionError):
            vbr_recover.mllt(self.dst, os.path.join(self.dir.name, 'twice.mp3'))  # already has an MLLT frame


if __name__ == '__main__':
    unittest.main()
