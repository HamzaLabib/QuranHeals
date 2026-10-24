"""Where does playback really start when the app seeks an MP3 to time T? (Phase 4.3)

Reproduces the seek arithmetic of androidx.media3 1.9.0 (the version expo-audio 57 uses on Android; ProgressiveMediaSource
with default extractor flags, SeekParameters.EXACT):
  1. the seeker maps T to a byte position (XingSeeker: 100-entry TOC; ConstantBitrateSeeker: Info/first-frame bitrate;
     MlltSeeker: ID3 MLLT references);
  2. Mp3Extractor resynchronises to the first frame at or after that byte and labels it seeker.getTimeUs(position);
  3. the player decodes forward and drops audio labelled before T.
So the audio heard at label T is really at  T + (true time of that frame - its label).  Returns that error per target.
True frame times come from the frame list (mp3frames.py), on the decoder timeline that skips the seek-header frame.
This is a simulation of the extractor's arithmetic, not a device measurement; iOS (AVPlayer) is not covered.

usage: python -I -X utf8 seek_sim.py <file.mp3> <t_ms> [<t_ms> ...]
"""
import bisect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp3frames  # noqa: E402


class Model:
    def __init__(self, info, mllt=None):
        self.info = info
        self.audio, self.duration = mp3frames.audio_frames(info)
        self.starts = [f[0] for f in self.audio]
        self.times = [t for _, t, _ in self.audio]
        seek = info['seekHeader']
        first = info['frames'][0]
        self.mllt = mllt
        if mllt:
            self.kind = 'MLLT'
        elif seek['kind'] == 'Xing' and seek.get('toc') and seek.get('frames'):
            self.kind = 'Xing'
            self.data_start = seek['offset']  # XingSeeker: the position of the Xing frame itself
            self.xing_frame = first[1]
            self.data_size = seek['bytes']
            self.toc = seek['toc']
            spf, rate = first[4], first[3]
            self.dur_us = (seek['frames'] * spf * 1_000_000) // rate
        elif seek['kind'] == 'Info' and seek.get('frames') and seek.get('bytes'):
            self.kind = 'Info'
            spf, rate = first[4], first[3]
            dur_us = (seek['frames'] * spf * 1_000_000) // rate
            self.first_pos = seek['offset'] + first[1]
            audio_len = seek['bytes'] - first[1]
            self.bitrate = round(audio_len * 8 * 1_000_000 / dur_us)
            self.frame_size = round(audio_len / seek['frames'])
        else:
            self.kind = 'CBR'
            f = self.audio[0][2]
            self.first_pos = f[0]
            self.bitrate = f[2] * 1000
            self.frame_size = f[1]

    # --- seekers ---------------------------------------------------------------------------------------
    def _xing_position(self, t_us):
        t_us = min(max(t_us, 0), self.dur_us)
        pct = t_us * 100.0 / self.dur_us
        if pct <= 0:
            scaled = 0.0
        elif pct >= 100:
            scaled = 256.0
        else:
            i = int(pct)
            a = self.toc[i]
            b = 256 if i == 99 else self.toc[i + 1]
            scaled = a + (pct - i) * (b - a)
        off = round(scaled / 256 * self.data_size)
        off = min(max(off, self.xing_frame), self.data_size - 1)
        return self.data_start + off

    def _xing_time(self, pos):
        off = pos - self.data_start
        if off <= self.xing_frame:
            return 0
        scaled = off * 256.0 / self.data_size
        i = max(0, bisect.bisect_right(self.toc, int(scaled)) - 1)
        prev_t = (i * self.dur_us) // 100
        next_t = ((i + 1) * self.dur_us) // 100
        a = self.toc[i]
        b = 256 if i == 99 else self.toc[i + 1]
        frac = 0 if a == b else (scaled - a) / (b - a)
        return prev_t + round(frac * (next_t - prev_t))

    def _cbr_position(self, t_us):
        off = (t_us * self.bitrate) // (1_000_000 * 8)
        off = (off // self.frame_size) * self.frame_size
        return self.first_pos + max(off, 0)

    def _cbr_time(self, pos):
        return max(0, pos - self.first_pos) * 8 * 1_000_000 // self.bitrate

    def _mllt_refs(self):
        if not hasattr(self, '_refs'):
            first = self.starts[0]
            pos, ms = [first], [0]
            for db, dm in zip(self.mllt['bytes'], self.mllt['ms']):
                pos.append(pos[-1] + db)
                ms.append(ms[-1] + dm)
            self._refs = (pos, ms)
        return self._refs

    @staticmethod
    def _interp(x, xs, ys):
        i = max(0, bisect.bisect_right(xs, x) - 1)
        if i + 1 == len(xs):
            return x, ys[i]
        p = 0.0 if xs[i + 1] == xs[i] else (x - xs[i]) / (xs[i + 1] - xs[i])
        return x, int(p * (ys[i + 1] - ys[i])) + ys[i]

    def seek(self, t_ms):
        """-> (label of the frame where decoding resumes in ms, its true time in ms)."""
        t_us = round(t_ms * 1000)
        if self.kind == 'Xing':
            p = self._xing_position(t_us)
        elif self.kind == 'MLLT':
            pos, ms = self._mllt_refs()
            t = min(max(t_ms, 0), self.duration * 1000)
            p = self._interp(int(t), ms, pos)[1]
        else:
            p = self._cbr_position(t_us)
        k = bisect.bisect_left(self.starts, p)  # resynchronise: first frame at or after p
        k = min(k, len(self.starts) - 1)
        q = self.starts[k]
        if self.kind == 'Xing':
            label = self._xing_time(q) / 1000
        elif self.kind == 'MLLT':
            pos, ms = self._mllt_refs()
            label = self._interp(q, pos, ms)[1]
        else:
            label = self._cbr_time(q) / 1000
        return label, self.times[k] * 1000

    def error_ms(self, t_ms):
        """Audio heard when asked for t_ms is really at t_ms + error (positive: starts late, ayah head skipped)."""
        label, true = self.seek(t_ms)
        if label > t_ms:  # resumed after the target: the player starts there (it cannot go back)
            return true - t_ms
        return true - label


def mllt_table(info, every):
    """An exact MLLT for this file: one reference every `every` audio frames, millisecond times rounded per reference."""
    audio, _ = mp3frames.audio_frames(info)
    refs = list(range(every, len(audio), every))
    bytes_d, ms_d = [], []
    prev_pos, prev_ms = audio[0][0], 0
    for k in refs:
        pos, t = audio[k][0], round(audio[k][1] * 1000)
        bytes_d.append(pos - prev_pos)
        ms_d.append(t - prev_ms)
        prev_pos, prev_ms = pos, t
    return {'every': every, 'bytes': bytes_d, 'ms': ms_d}


if __name__ == '__main__':
    info = mp3frames.parse(sys.argv[1])
    m = Model(info)
    print(m.kind, [round(m.error_ms(float(t))) for t in sys.argv[2:]])
