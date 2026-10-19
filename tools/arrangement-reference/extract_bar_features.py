import sys, wave, json, numpy as np

N = 2048
H = 256
BANDS = [(20, 150), (150, 600), (600, 2500), (2500, 6000), (6000, 11000)]


def load(path):
    w = wave.open(path)
    sr = w.getframerate()
    raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return raw[0::2], raw[1::2], sr


def stft(x, sr):
    win = np.hanning(N)
    n = (len(x) - N) // H
    idx = np.arange(N)[None, :] + H * np.arange(n)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * win, axis=1)).astype(np.float32)
    return S, np.fft.rfftfreq(N, 1 / sr)


def analyze(path):
    L, R, sr = load(path)
    x = (L + R) / 2
    side = (L - R) / 2
    S, fr = stft(x, sr)
    fps = sr / H
    B = np.stack([S[:, (fr >= lo) & (fr < hi)].sum(1) for lo, hi in BANDS], 1)
    logS = np.log1p(S * 30)
    flux_all = np.maximum(0, np.diff(logS, axis=0)).sum(1)
    kick = np.maximum(0, np.diff(logS[:, (fr >= 40) & (fr < 130)], axis=0)).sum(1)
    hat = np.maximum(0, np.diff(logS[:, (fr >= 6000) & (fr < 11000)], axis=0)).sum(1)
    frame_rms = np.sqrt((S ** 2).sum(1))
    thr = frame_rms.max() * 0.02
    start = int(np.argmax(frame_rms > thr))
    f = flux_all[start:] - flux_all[start:].mean()
    ac = np.correlate(f, f, "full")[len(f) - 1:]
    best = None
    for bpm in np.arange(70, 171, 0.25):
        beat = 60 / bpm
        sc = 0
        for k, wt in ((1, 1.0), (2, 0.8), (4, 1.2), (8, 0.8)):
            li = int(round(k * beat * fps))
            if li < len(ac):
                sc += wt * ac[li]
        if best is None or sc > best[0]:
            best = (sc, bpm)
    bpm = best[1]
    while bpm < 85:
        bpm *= 2
    while bpm > 150:
        bpm /= 2
    barf = 4 * 60 / bpm * fps
    fl = kick[start:]
    best_ph = None
    for ph in np.arange(0, barf, 1.0):
        idxs = (ph + np.arange(0, int(len(fl) / barf)) * barf).astype(int)
        idxs = idxs[idxs < len(fl)]
        sc = fl[idxs].sum()
        if best_ph is None or sc > best_ph[0]:
            best_ph = (sc, ph)
    off = start + best_ph[1]
    nb = int((len(S) - 1 - off) / barf)
    k90 = np.percentile(kick, 90)
    h90 = np.percentile(hat, 90)
    feats = []
    for b in range(nb):
        a = int(off + b * barf)
        e = int(off + (b + 1) * barf)
        bs = B[a:e].mean(0)
        db = 20 * np.log10(bs + 1e-6)
        seg = slice(int(a * H), int(e * H))
        r = np.sqrt((x[seg] ** 2).mean() + 1e-12)
        sd = np.sqrt((side[seg] ** 2).mean() + 1e-12)
        feats.append(dict(
            rms=float(20 * np.log10(r)),
            bands=[float(v) for v in db],
            kick=float((kick[a:e] > k90).sum()),
            hat=float((hat[a:e] > h90).sum()),
            width=float(sd / r),
        ))
    return dict(bpm=float(bpm), bars=nb, start_s=float(start * H / sr), feats=feats, dur=float(len(x) / sr))


if __name__ == "__main__":
    out = {}
    for n in sys.argv[1:]:
        out[n] = analyze(f"st{n}.wav")
        print(n, "bpm", round(out[n]["bpm"], 1), "bars", out[n]["bars"], "start", round(out[n]["start_s"], 2), flush=True)
    json.dump(out, open("feats.json", "w"))
