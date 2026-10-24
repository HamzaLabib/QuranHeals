"""Regression tests for flag_boundaries.py's boundary placement (Phase 4.2). Synthetic audio, no network.

The defect: for a very short ayah, the longest pause in the snapping window was the pause AFTER it (the next
boundary's), so the ayah's start was put at its own end and the next ayah got no length (Yasser Salama 90:13, Saleh
Al-Talib 86:14). The rule: a start boundary lies after the previous boundary and before the ayah's own aligned end.

usage: python -I -X utf8 test_flag_boundaries.py      (uses ../pylib: miniaudio, numpy)
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000


def write_audio(path, voiced):
    """A tone in each [start, end] ms span, silence elsewhere (16 kHz mono WAV)."""
    total = voiced[-1][1] + 2000
    x = np.zeros(SR * total // 1000, dtype=np.float32)
    t = np.arange(len(x)) / SR
    for a, b in voiced:
        i, j = SR * a // 1000, SR * b // 1000
        x[i:j] = 0.3 * np.sin(2 * np.pi * 180 * t[i:j]) * (1 + 0.3 * np.sin(2 * np.pi * 5 * t[i:j]))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    return total


def alignment(ayahs, total, snapped):
    """align_mms.py output: ayahs [(ayah, start, end)], the snapped boundary of each (as align_mms.py chose it)."""
    out = []
    prev_end = None
    for k, (a, s, e) in enumerate(ayahs):
        out.append({'ayah': a, 'start_ms': s, 'end_ms': e, 'boundary_ms': s if prev_end is None else (prev_end + s) // 2, 'score': 0.6,
                    'snapped_ms': snapped.get(a)})
        prev_end = e
    return {'surah': 108, 'duration_ms': total, 'intro': None, 'ayahs': out, 'missing': []}


class BoundaryPlacement(unittest.TestCase):
    def run_case(self, voiced, ayahs, snapped):
        with tempfile.TemporaryDirectory() as d:
            audio = os.path.join(d, 'a.wav')
            total = write_audio(audio, voiced)
            a = os.path.join(d, 'a.json')
            json.dump(alignment(ayahs, total, snapped), open(a, 'w'))
            out = os.path.join(d, 'out.json')
            counts = os.path.join(d, 'counts.json')
            json.dump([3] * 114, open(counts, 'w'))
            subprocess.run([sys.executable, '-I', '-X', 'utf8', os.path.join(HERE, 'flag_boundaries.py'), audio, a, out, '--counts', counts], check=True, capture_output=True)
            return json.load(open(out, encoding='utf8'))

    def test_short_ayah_keeps_the_pause_before_it(self):
        # Ayah 1 0-3 s; pause 3.0-3.3 s (300 ms); ayah 2 (short) 3.3-4.5 s; pause 4.5-5.0 s (500 ms, longer); ayah 3 5.0-8 s.
        voiced = [(0, 3000), (3300, 4500), (5000, 8000)]
        ayahs = [(1, 0, 3000), (2, 3300, 4480), (3, 5000, 8000)]
        # As align_mms.py snapped it: both boundaries in the longer pause after ayah 2 (the defect).
        r = self.run_case(voiced, ayahs, {2: 4750, 3: 4750})
        b2, b3 = r['boundaries']
        self.assertTrue(r['structure']['ok'], r['structure'])
        self.assertIn('past-own-end', b2['flags'])
        self.assertTrue(3000 <= b2['chosen_ms'] <= 3300, b2)  # inside the pause before ayah 2
        self.assertTrue(4500 <= b3['chosen_ms'] <= 5000, b3)  # ayah 3 keeps its own pause
        self.assertNotIn('reordered', b3['flags'])

    def test_correct_boundaries_are_unchanged(self):
        voiced = [(0, 3000), (3500, 6000), (6500, 9000)]
        ayahs = [(1, 0, 3000), (2, 3500, 6000), (3, 6500, 9000)]
        r = self.run_case(voiced, ayahs, {2: 3250, 3: 6250})
        self.assertEqual([b['chosen_ms'] for b in r['boundaries']], [3250, 6250])
        self.assertEqual([b['flags'] for b in r['boundaries']], [[], []])

    def test_no_pause_left_falls_back_inside_the_limits(self):
        # Joined ayahs (no pause before ayah 2): snapped to the pause after it -> the aligned onset, flagged.
        voiced = [(0, 4500), (5000, 8000)]
        ayahs = [(1, 0, 3200), (2, 3200, 4480), (3, 5000, 8000)]
        r = self.run_case(voiced, ayahs, {2: 4750, 3: 4750})
        b2 = r['boundaries'][0]
        self.assertIn('past-own-end', b2['flags'])
        self.assertLess(b2['chosen_ms'], 4480)
        self.assertTrue(r['structure']['ok'], r['structure'])


if __name__ == '__main__':
    unittest.main()
