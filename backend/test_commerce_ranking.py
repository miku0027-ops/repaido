import copy
import pytest
from pydantic import ValidationError
import commerce_ranking as ranking

FEATURES={'received_orders':5,'refunded_orders':0,'cancelled_orders':0,'review_count':2,'rating_sum':9,'stock_freshness':1.0,'context_match':1.0,'response_count':0,'response_seconds_sum':0.0}


def test_evidence_score_confidence_separates_cold_start_from_real_ratings():
    cold=ranking.score({})
    assert cold['bayesian_rating'] is None and cold['score']==0
    score=ranking.score(FEATURES)
    assert 3.5<score['bayesian_rating']<4.5 and score['rating_confidence']<1
    assert ranking.score({**FEATURES,'received_orders':50})['score']>score['score']
    assert ranking.score({**FEATURES,'refunded_orders':5})['score']<score['score']
    assert sum(x['maximum'] for x in score['components'])==100
    assert not any(x in str(score) for x in ('demographic','paid_placement','online'))


@pytest.mark.parametrize('extra',[{'customer_id':'private'},{'paid_placement':True},{'location':{'lat':2}}, {'review_count':8},{'rating_sum':11},{'stock_freshness':float('nan')},{'response_seconds_sum':1.0}])
def test_invalid_private_or_incoherent_features_rejected(extra):
    with pytest.raises(ValidationError):ranking.rank({'candidates':[{**FEATURES,**extra}]})


def test_batch_and_feature_cache_are_bounded_copied_and_evidence_versioned(monkeypatch):
    with pytest.raises(ValidationError):ranking.rank({'candidates':[FEATURES]*65})
    with pytest.raises(ValidationError):ranking.rank({'candidates':[]})
    now=[100];monkeypatch.setattr(ranking.time,'monotonic',lambda:now[0])
    cache=ranking.FeatureCache(limit=2,ttl=3)
    original=cache.rank({'candidates':[FEATURES]})
    changed=copy.deepcopy(original);changed['scores'][0]['score']=-1
    assert cache.rank({'candidates':[FEATURES]})==original
    cache.rank({'candidates':[{**FEATURES,'context_match':0.0}]})
    cache.rank({'candidates':[{**FEATURES,'received_orders':6}]})
    assert len(cache.rows)==2
    now[0]+=4
    assert cache.rank({'candidates':[FEATURES]})==original
