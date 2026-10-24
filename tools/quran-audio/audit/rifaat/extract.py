"""Cut [from_s, to_s] of an audio file to 16 kHz mono WAV (diagnostic extracts of the alternative transfers) and
report digital silence (exact zeros, runs >= 50 ms) and band energy 2-3 / 3-4 kHz re 300-1000 Hz.
usage: python -I extract.py <in> <from_s> <to_s> <out.wav>"""
import sys, wave, numpy as np, miniaudio
src, a, b, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
d = miniaudio.decode_file(src, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=44100)
x = np.asarray(d.samples, dtype=np.float32); full = x[int(a * 44100):int(b * 44100)]
z = np.abs(full) < 1e-5; runs = 0; zero = 0; i = 0; n = len(z)
edges = np.flatnonzero(np.diff(np.r_[0, z.astype(np.int8), 0]))
for s0, s1 in zip(edges[::2], edges[1::2]):
    if s1 - s0 >= 0.05 * 44100: runs += 1; zero += s1 - s0
F = np.abs(np.fft.rfft(full[:len(full) // 4096 * 4096].reshape(-1, 4096) * np.hanning(4096), axis=1)) ** 2
f = np.fft.rfftfreq(4096, 1 / 44100); band = lambda lo, hi: F[:, (f >= lo) & (f < hi)].sum()
ref = band(300, 1000)
print(f"{src.split('/')[-1][:60]} {a:.0f}-{b:.0f}s: silence {zero / len(full):.0%} ({runs} runs); 2-3k {10*np.log10(band(2000,3000)/ref):.0f} dB, 3-4k {10*np.log10(band(3000,4000)/ref):.0f} dB")
if out == "-": sys.exit(0)
d16 = miniaudio.decode_file(src, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=16000)
y = np.asarray(d16.samples, dtype=np.int16)[int(a * 16000):int(b * 16000)]
with wave.open(out, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(y.tobytes())
