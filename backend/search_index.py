"""Versioned public snapshot search. Bloom negatives never substitute for truth.

The inverted prefix index preserves discovery's any-token/prefix semantics.
Only immutable public text snapshots are cached; no private query history,
booking availability or authorization decisions enter this cache.
"""
import hashlib
import math
import threading
from collections import OrderedDict, Counter

class BloomFilter:
    def __init__(self, count, false_positive_rate=.01):
        n=max(1,count)
        self.size=max(64,math.ceil(-n*math.log(false_positive_rate)/(math.log(2)**2)))
        self.hashes=max(1,min(16,round(self.size/n*math.log(2))))
        self.bits=bytearray((self.size+7)//8)
    def positions(self,value):
        raw=hashlib.blake2b(value.encode(),digest_size=16).digest()
        a,b=int.from_bytes(raw[:8],'big'),int.from_bytes(raw[8:],'big')|1
        return ((a+i*b)%self.size for i in range(self.hashes))
    def add(self,value):
        for pos in self.positions(value):self.bits[pos//8]|=1<<(pos%8)
    def contains(self,value):
        return all(self.bits[pos//8]&(1<<(pos%8)) for pos in self.positions(value))

class PrefixIndex:
    def __init__(self,texts,tokenize):
        self.postings={}
        for index,text in enumerate(texts):
            prefixes={word[:end] for word in tokenize(text) for end in range(1,len(word)+1)}
            for prefix in prefixes:self.postings.setdefault(prefix,[]).append(index)
        self.bloom=BloomFilter(len(self.postings))
        for prefix in self.postings:self.bloom.add(prefix)
    def scores(self,words,threshold=0):
        if not words:return None
        counts=Counter()
        for word in words:
            if self.bloom.contains(word):counts.update(self.postings.get(word,()))
        return {index:count/len(words) for index,count in counts.items() if count/len(words)>=threshold}

class SnapshotSearch:
    def __init__(self,max_entries=8,max_bytes=131072):
        self.max_entries,self.max_bytes=max_entries,max_bytes
        self.rows=OrderedDict();self.lock=threading.Lock()
    def scores(self,texts,query,tokenize,threshold=0):
        words=tokenize(query)
        if not words:return None
        # Length-prefixed digest includes order and every changed source field.
        digest=hashlib.sha256();size=0
        for text in texts:
            raw=text.encode();size+=len(raw);digest.update(len(raw).to_bytes(8,'big'));digest.update(raw)
        key=digest.digest()
        if size>self.max_bytes:
            return {i:score for i,text in enumerate(texts) if (score:=sum(any(t.startswith(w) for t in tokenize(text)) for w in words)/len(words))>0 and score>=threshold}
        with self.lock:
            index=self.rows.get(key)
            if index is None:
                index=PrefixIndex(texts,tokenize);self.rows[key]=index
                while len(self.rows)>self.max_entries:self.rows.popitem(last=False)
            self.rows.move_to_end(key)
        return index.scores(words,threshold)

public_search=SnapshotSearch()
