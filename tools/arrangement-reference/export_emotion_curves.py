import json, numpy as np
D=json.load(open("feats.json")); out={}
for name,song in D.items():
    f=song["feats"]; rms=np.array([x["rms"] for x in f]); bands=np.array([x["bands"] for x in f])
    entries=[0]+[int((bands[b]-bands[b-1]>=3).sum()) for b in range(1,len(f))]
    out[name]=dict(weightDb=bands[:,0].tolist(),brightnessDb=bands[:,4].tolist(),energyDb=rms.tolist(),entries=entries)
json.dump(out,open("curves.json","w")); print({k:len(v["energyDb"]) for k,v in out.items()})
