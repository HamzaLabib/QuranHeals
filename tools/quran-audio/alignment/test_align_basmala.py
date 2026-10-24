"""Regression tests for align_mms.py's optional --no-basmala (Phase 4.8).

Haram prayer recordings do not recite the Basmala aloud; the aligner's forced Basmala segment then ate up to 3.2 s of
ayah 1 (Phase 4.7). The option drops that segment. The tests check that:
  - by default the segments are exactly as before (Basmala as label 0 before ayah 1, surahs 1 and 9 without one);
  - with the option only the Basmala segment goes: ayah 1's words (the Basmala removed) and every other ayah are the same;
  - (optional, GPU) re-aligning recordings reproduces earlier outputs: without the option the Phase 4.1 / 4.7 runs of the
    unchanged aligner, with it the Phase 4.7 scratch variant; and with it ayah 1 starts at the measured voice onset.

usage: python -I -X utf8 test_align_basmala.py   (the aligner's GPU environment: torch, torchaudio, uroman, miniaudio)
  QH_ALIGN_REGRESSION=<json>  runs the end-to-end comparisons listed in that file:
    {"quran": <quran-uthmani.txt>, "cases": [{"surah": 95, "audio": <mp3>, "expected": <nostar.json>, "expectedStar": <star.json>,
      "noBasmala": false, "voiceOnsetMs": 3020}, ...]}
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import align_mms  # noqa: E402
from textnorm import load_quran  # noqa: E402

QURAN = os.path.join(HERE, '..', '..', '..', 'backend', 'data', 'quran', 'quran-uthmani.txt')  # the aligner's text (run-batch.mjs)


class Segments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.q = load_quran(QURAN)

    def test_default_keeps_the_basmala_segment(self):
        n, segs = align_mms.build_segments(self.q, 95)
        self.assertEqual(n, 8)
        self.assertEqual([lab for lab, _ in segs], [0, 1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(segs[0][1], align_mms.words_of(95, 0, self.q[(1, 1)], False))

    def test_no_basmala_drops_only_that_segment(self):
        for surah in (2, 14, 29, 36, 87, 95, 104, 114):
            n, with_b = align_mms.build_segments(self.q, surah)
            m, without = align_mms.build_segments(self.q, surah, basmala=False)
            self.assertEqual(n, m)
            self.assertEqual(with_b[0][0], 0, surah)
            self.assertEqual(with_b[1:], without, surah)  # ayah 1 (Basmala words removed) and the rest identical
            self.assertEqual([lab for lab, _ in without], list(range(1, n + 1)))

    def test_surahs_1_and_9_are_unaffected(self):
        for surah in (1, 9):
            self.assertEqual(align_mms.build_segments(self.q, surah), align_mms.build_segments(self.q, surah, basmala=False))
            self.assertNotEqual(align_mms.build_segments(self.q, surah)[1][0][0], 0)


def comparable(path):
    """An alignment output without its compute time (the only field that differs between identical runs), and without
    an empty 'windows' (added for long files during Phase 4.1, after its first short files were aligned)."""
    with open(path, encoding='utf8') as f:
        d = json.load(f)
    d.pop('gpu_s', None)
    if d.get('windows') is None:
        d.pop('windows', None)
    return d


@unittest.skipUnless(os.environ.get('QH_ALIGN_REGRESSION'), 'set QH_ALIGN_REGRESSION to run the GPU regression')
class EndToEnd(unittest.TestCase):
    def test_reproduces_earlier_outputs(self):
        spec = json.load(open(os.environ['QH_ALIGN_REGRESSION'], encoding='utf8'))
        for c in spec['cases']:
            with self.subTest(surah=c['surah'], audio=os.path.basename(c['audio']), no_basmala=c.get('noBasmala', False)), tempfile.TemporaryDirectory() as tmp:
                a, b = os.path.join(tmp, 'nostar.json'), os.path.join(tmp, 'star.json')
                args = [sys.executable, '-X', 'utf8', os.path.join(HERE, 'align_mms.py'), spec['quran'], str(c['surah']), c['audio'], a, '--no-star-between', '--both', b]
                if c.get('noBasmala'):
                    args.append('--no-basmala')
                subprocess.run(args, check=True, capture_output=True)
                self.assertEqual(comparable(a), comparable(c['expected']))
                if c.get('expectedStar'):
                    self.assertEqual(comparable(b), comparable(c['expectedStar']))
                if c.get('voiceOnsetMs') is not None:
                    first = comparable(a)['ayahs'][0]
                    self.assertIsNone(comparable(a)['intro'])
                    self.assertLessEqual(abs(first['start_ms'] - c['voiceOnsetMs']), 100)


if __name__ == '__main__':
    unittest.main()
