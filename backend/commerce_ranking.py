"""Versioned, anonymous commerce evidence scoring. No identity or money features."""
import copy
import hashlib
import math
import threading
import time
from collections import OrderedDict
from pydantic import BaseModel, ConfigDict, Field, model_validator

VERSION = 'commerce-evidence-v1'
PRIOR_MEAN = 3.5
PRIOR_WEIGHT = 5

class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    received_orders: int = Field(default=0, ge=0, le=100000000)
    refunded_orders: int = Field(default=0, ge=0, le=100000000)
    cancelled_orders: int = Field(default=0, ge=0, le=100000000)
    review_count: int = Field(default=0, ge=0, le=100000000)
    rating_sum: int = Field(default=0, ge=0, le=500000000)
    stock_freshness: float = Field(default=0, ge=0, le=1)
    context_match: float = Field(default=0, ge=0, le=1)
    response_count: int = Field(default=0, ge=0, le=100000000)
    response_seconds_sum: float = Field(default=0, ge=0, le=1e16)
    @model_validator(mode='after')
    def consistent(self):
        if self.review_count > self.received_orders or not self.review_count <= self.rating_sum <= self.review_count * 5:
            raise ValueError('Ratings require genuine received-order review evidence.')
        if self.response_count == 0 and self.response_seconds_sum:
            raise ValueError('Response latency requires actual response observations.')
        return self

class Batch(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    candidates: list[Evidence] = Field(min_length=1, max_length=64)

def score(value):
    e = value if isinstance(value, Evidence) else Evidence.model_validate(value)
    bayes = (e.rating_sum + PRIOR_MEAN * PRIOR_WEIGHT) / (e.review_count + PRIOR_WEIGHT)
    confidence = e.review_count / (e.review_count + PRIOR_WEIGHT)
    total = e.received_orders + e.refunded_orders + e.cancelled_orders
    reliability = e.received_orders / total if total else 0
    response = (1 / (1 + e.response_seconds_sum / e.response_count / 3600)) if e.response_count else 0
    components = [
        {'id':'verified_reviews','label':'Verified purchase ratings, confidence adjusted','points':round(bayes / 5 * confidence * 40,2),'maximum':40},
        {'id':'fulfilment','label':'Observed received-order reliability','points':round(reliability * total/(total+5) * 20,2),'maximum':20},
        {'id':'received_orders','label':'Observed completed purchases','points':round(min(math.log1p(e.received_orders)/math.log(101),1) * 15,2),'maximum':15},
        {'id':'context','label':'Current category and search relevance','points':round(e.context_match * 15,2),'maximum':15},
        {'id':'stock','label':'Recently confirmed catalogue stock','points':round(e.stock_freshness * 5,2),'maximum':5},
        {'id':'response','label':'Measured customer response time','points':round(response * min(e.response_count/5,1) * 5,2),'maximum':5},
    ]
    return {'score':round(sum(x['points'] for x in components),2),'components':components,
            'bayesian_rating':round(bayes,2) if e.review_count else None,
            'rating_confidence':round(confidence,4)}

def rank(value):
    batch = value if isinstance(value,Batch) else Batch.model_validate(value)
    return {'version':VERSION,'scores':[score(e) for e in batch.candidates]}

class FeatureCache:
    def __init__(self,limit=128,ttl=60):
        self.limit,self.ttl,self.rows,self.lock=limit,ttl,OrderedDict(),threading.Lock()
    def rank(self,value):
        batch=value if isinstance(value,Batch) else Batch.model_validate(value)
        key=hashlib.sha256((VERSION+batch.model_dump_json()).encode()).digest();now=time.monotonic()
        with self.lock:
            found=self.rows.get(key)
            if found and found[0]>now:
                self.rows.move_to_end(key);return copy.deepcopy(found[1])
            self.rows.pop(key,None)
        result=rank(batch)
        with self.lock:
            self.rows[key]=(now+self.ttl,result)
            while len(self.rows)>self.limit:self.rows.popitem(last=False)
        return copy.deepcopy(result)
