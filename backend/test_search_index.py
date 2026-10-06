import random
from discovery import relevance,terms
from search_index import BloomFilter,SnapshotSearch


def test_bloom_has_no_false_negatives_and_prefix_results_are_exact():
    words=[f'professional-{i}' for i in range(10000)]
    bloom=BloomFilter(len(words))
    for word in words:bloom.add(word)
    assert all(bloom.contains(word) for word in words)
    assert sum(bloom.contains(f'absent-{i}') for i in range(10000))<300
    assert len(bloom.bits)<15000
    texts=['Electrical repair by Sipun Mahanta','Home cleaning','Air conditioning expert','Water heater service','Plumbing specialist']
    index=SnapshotSearch()
    for query in ['elec','sipun','plumber','aircon','geyser','home plumber','absent','', 'ELECTRICIAN']:
        scores=index.scores(texts,query,terms)
        expected={i:score for i,text in enumerate(texts) if (score:=relevance(query,text))>0}
        assert scores==expected if query else scores is None


def test_snapshot_rebuilds_after_additions_updates_and_removals_and_is_bounded():
    index=SnapshotSearch(max_entries=2)
    assert index.scores(['Cleaning'],'sipun',terms)=={}
    assert index.scores(['Cleaning','Sipun Mahanta'],'sipun',terms)=={1:1}
    assert index.scores(['Sipun Electrician'],'electrician',terms)=={0:1}
    assert index.scores(['Cleaning'],'sipun',terms)=={}
    assert len(index.rows)==2


def test_bloom_false_positive_cannot_create_a_result():
    index=SnapshotSearch()
    index.scores(['Cleaning'],'clean',terms)
    snapshot=next(iter(index.rows.values()))
    snapshot.bloom.bits[:]=b'\xff'*len(snapshot.bloom.bits)
    assert index.scores(['Cleaning'],'absent',terms)=={}
