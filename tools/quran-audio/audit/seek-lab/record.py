"""Records the PC's audio output (WASAPI loopback: what the emulator plays) to <out>.wav, 48 kHz stereo, with the host
clock time (ms) of every 100 ms block in <out>.times.json, until <out>.stop exists or <seconds> pass."""
import json, os, sys, time, wave
import numpy as np
# soundcard 0.4.3 calls numpy.fromstring (binary mode), removed in NumPy 2: same bytes via frombuffer
np.fromstring = lambda b, dtype=float: np.frombuffer(b, dtype=dtype).copy()
import soundcard as sc

out, seconds = sys.argv[1], float(sys.argv[2])
spk = sc.default_speaker()
mic = sc.get_microphone(id=str(spk.name), include_loopback=True)
SR, BLOCK = 48000, 4800
times = []
with wave.open(out + '.wav', 'wb') as w, mic.recorder(samplerate=SR, channels=2, blocksize=BLOCK) as r:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    t0 = time.time()
    n = 0
    while time.time() - t0 < seconds and not os.path.exists(out + '.stop'):
        d = r.record(numframes=BLOCK)
        times.append([n, round(time.time() * 1000, 1)])  # host time when this block was handed over
        n += len(d)
        w.writeframes((np.clip(d, -1, 1) * 32767).astype('<i2').tobytes())
json.dump({'sampleRate': SR, 'blocks': times}, open(out + '.times.json', 'w'))
print('recorded', n / SR, 's')
