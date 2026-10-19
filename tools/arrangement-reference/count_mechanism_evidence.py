import json
import numpy as np

D = json.load(open("feats.json"))


def runs(mask, min_len):
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            if j - i >= min_len:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


ev = {}
for name, song in D.items():
    f = song["feats"]
    rms = np.array([x["rms"] for x in f])
    bands = np.array([x["bands"] for x in f])
    kick = np.array([x["kick"] for x in f])
    n = len(f)
    # music body: drop trailing bars that are > 30 dB below the median (silence tail)
    med_rms = np.median(rms)
    end = n
    while end > 8 and rms[end - 1] < med_rms - 30:
        end -= 1
    body = slice(0, end)
    low = bands[body, 0]
    air = bands[body, 4]
    r = rms[body]
    kk = kick[body]
    med_low = np.median(low)
    med_air = np.median(air)
    med_kick = np.median(kk[kk > 0]) if (kk > 0).any() else 0
    e = {}
    # 1. low end withheld at the opening, then a step-up (>= 6 dB) within the first 40 bars
    withheld = runs(low < med_low - 8, 2)
    open_run = next(((s, t) for s, t in withheld if s <= 1), None)
    if open_run:
        s, t = open_run
        step = low[t:t + 2].mean() - low[max(0, t - 2):t].mean() if t + 2 <= len(low) else float("nan")
        e["opening_withheld"] = dict(bars=t - s, step=float(step), ok=bool(step >= 4))
    else:
        e["opening_withheld"] = dict(bars=0, step=float("nan"), ok=False)
    # 2. kick withheld at the opening (kick count <= 25% of median for the same stretch)
    kick_withheld = runs(kk <= 0.25 * med_kick, 2) if med_kick else []
    ko = next(((s, t) for s, t in kick_withheld if s <= 1), None)
    e["opening_kick_withheld"] = dict(bars=(ko[1] - ko[0]) if ko else 0, ok=bool(ko))
    # 3. two-step: low end enters >= 2 bars before the kick returns
    if open_run or ko:
        low_in = next((b for b in range(len(low)) if low[b] >= med_low - 6), None)
        kick_in = next((b for b in range(len(kk)) if med_kick and kk[b] >= 0.5 * med_kick), None)
        e["two_step"] = dict(low_in=low_in, kick_in=kick_in, ok=bool(low_in is not None and kick_in is not None and kick_in - low_in >= 2))
    else:
        e["two_step"] = dict(low_in=None, kick_in=None, ok=False)
    # 4. one-bar dip right before a big arrival (rms drop >= 3 dB in the bar before the largest rms step)
    steps = np.array([r[b:b + 2].mean() - r[max(0, b - 2):b].mean() if b >= 2 and b + 2 <= len(r) else -99 for b in range(len(r))])
    big = [b for b in np.argsort(steps)[::-1][:6] if steps[b] >= 3]
    dips = [b for b in big if b >= 6 and r[b - 1] <= r[max(0, b - 6):b - 1].mean() - 3]
    e["silent_bar"] = dict(big=len(big), dips=len(dips), ok=bool(len(dips) >= 1))
    # 5. mid-song low-end dropout with return (>= 2 bars, starts after bar 8)
    mid_low = [(s, t) for s, t in runs(low < med_low - 8, 2) if s > 8 and t + 2 <= len(low) and low[t:t + 2].mean() - low[max(0, t - 2):t].mean() >= 4]
    e["mid_low_break"] = dict(runs=mid_low, ok=bool(mid_low))
    # 6. mid-song air withdrawal with return
    mid_air = [(s, t) for s, t in runs(air < med_air - 8, 2) if s > 8 and t + 2 <= len(air) and air[t:t + 2].mean() - air[max(0, t - 2):t].mean() >= 4]
    e["mid_air_withdrawal"] = dict(runs=mid_air, ok=bool(mid_air))
    # 7. closure: energy falls over the last bars of the body (>= 6 dB from 4 bars before the end)
    tail = r[-4:]
    drop = tail[-1] - tail[0]
    # include the fade into silence if it exists
    full_drop = rms[-1] - rms[max(0, end - 4)]
    e["closure_decay"] = dict(body_drop=float(drop), full_drop=float(full_drop), ok=bool(min(drop, full_drop) <= -6))
    # 8. thinning vs. plain level fade: do bands leave at different bars in the last 12 bars?
    k = min(12, end - 1)
    ref = bands[end - k - 1:end - k + 1].mean(0)
    leave = []
    for bi in range(5):
        seg = bands[end - k:end, bi]
        idx = next((j for j, v in enumerate(seg) if v <= ref[bi] - 6), None)
        leave.append(idx)
    got = [v for v in leave if v is not None]
    spread = (max(got) - min(got)) if len(got) >= 3 else 0
    e["layer_thinning"] = dict(leave=leave, spread=int(spread), ok=bool(spread >= 2))
    # 9. accumulation: energy rises across the opening stretch before the first arrival
    first = open_run[1] if open_run else 8
    seg = r[:max(first, 4)]
    slope = float(np.polyfit(np.arange(len(seg)), seg, 1)[0]) if len(seg) >= 4 else 0
    e["accumulation"] = dict(bars=len(seg), slope=slope, total=float(slope * (len(seg) - 1)), ok=bool(slope * (len(seg) - 1) >= 3))
    ev[name] = e

for name, e in ev.items():
    print(f"--- rec {name}")
    for k, v in e.items():
        print(f"  {k}: {v}")
means = {
    "drumless-intro (opening: low end AND kick withheld, arrival >= +4 dB)": sum(1 for e in ev.values() if e["opening_withheld"]["ok"] and e["opening_kick_withheld"]["ok"]),
    "opening low end withheld + arrival": sum(1 for e in ev.values() if e["opening_withheld"]["ok"]),
    "bass-then-kick (two-step)": sum(1 for e in ev.values() if e["two_step"]["ok"]),
    "silent-bar before a big arrival": sum(1 for e in ev.values() if e["silent_bar"]["ok"]),
    "low-end-break (mid-song)": sum(1 for e in ev.values() if e["mid_low_break"]["ok"]),
    "air-withdrawal (mid-song)": sum(1 for e in ev.values() if e["mid_air_withdrawal"]["ok"]),
    "level-fade / closure decay": sum(1 for e in ev.values() if e["closure_decay"]["ok"]),
    "layer-thinning (bands leave staggered)": sum(1 for e in ev.values() if e["layer_thinning"]["ok"]),
    "accumulation in opening": sum(1 for e in ev.values() if e["accumulation"]["ok"]),
}
print("\nCOUNTS (of 5):")
for k, v in means.items():
    print(f"  {v}/5  {k}")
json.dump(dict(per_song=ev, counts=means), open("evidence.json", "w"), default=lambda o: o.item() if hasattr(o, "item") else str(o))
