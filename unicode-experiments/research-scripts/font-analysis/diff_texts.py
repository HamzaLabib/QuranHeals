import sys, difflib, collections
def load(p):
    d={}
    for line in open(p,encoding='utf-8'):
        s=line.rstrip('\n').split('|',2)
        if len(s)==3 and s[0].isdigit(): d[(int(s[0]),int(s[1]))]=s[2]
    return d
ours=load(sys.argv[1]); old=load(sys.argv[2])
print(len(ours),len(old))
ops=collections.Counter(); same=0; examples=collections.defaultdict(list)
for k in ours:
    a,b=ours[k],old[k]
    if a==b: same+=1; continue
    sm=difflib.SequenceMatcher(None,a,b,autojunk=False)
    for tag,i1,i2,j1,j2 in sm.get_opcodes():
        if tag=='equal': continue
        key=(tag, ' '.join(f'{ord(c):04X}' for c in a[i1:i2]), ' '.join(f'{ord(c):04X}' for c in b[j1:j2]))
        ops[key]+=1
        if len(examples[key])<3: examples[key].append(k)
print('identical ayahs', same)
for k,v in ops.most_common(40): print(v, k, examples[k])
