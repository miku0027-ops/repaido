from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from demand_policy import demand_trigger, surcharge_split, distribute, week_bounds, weekly_preview


def test_five_percent_buffer_is_strict_and_zero_capacity_never_charges():
    assert not demand_trigger(105, 100)
    assert demand_trigger(106, 100)
    assert not demand_trigger(1000, 0)
    assert not demand_trigger(0, 100)
    with pytest.raises(ValueError): demand_trigger(-1, 1)
    with pytest.raises(ValueError): demand_trigger(True, 1)


def test_split_is_twenty_and_five_percentage_points_of_service_base():
    assert surcharge_split(100000) == {'surcharge_paise':25000, 'company_paise':5000, 'agent_pool_paise':20000}
    for base in range(10000):
        row = surcharge_split(base)
        assert row['surcharge_paise'] == row['company_paise'] + row['agent_pool_paise']
        assert row['company_paise']*100 <= base*5


def test_pool_is_proportional_and_conserves_rounding_without_company_residue():
    assert distribute(20000, {'a':10000, 'b':30000})['shares'] == {'a':5000, 'b':15000}
    assert distribute(2, {'c':1, 'b':1, 'a':1})['shares'] == {'c':0, 'b':1, 'a':1}
    assert distribute(20, {}) == {'shares':{}, 'held_paise':20}
    for amount in range(201):
        assert sum(distribute(amount, {'a':131,'b':39,'c':701})['shares'].values()) == amount


def test_week_boundaries_use_india_time():
    monday = datetime(2026, 9, 28, tzinfo=ZoneInfo('Asia/Kolkata')).timestamp()
    assert week_bounds(monday) == (monday, monday+604800)
    assert week_bounds(monday-1)[1] == monday


def test_pool_excludes_acceptance_spam_refunds_disputes_and_unknown_tax_basis():
    start, end = week_bounds(datetime(2026,9,29,tzinfo=ZoneInfo('Asia/Kolkata')).timestamp())
    job = dict(id='a', worker_id='agent', customer_id='customer', state='completed',
               payment_status='verified', completed_at=start+1, verified_service_value_paise=10000)
    jobs = [job, job, {**job,'id':'accept','state':'accepted'}, {**job,'id':'refund','payment_status':'partially_refunded'},
            {**job,'id':'dispute','financial_hold':True}, {**job,'id':'unknown','verified_service_value_paise':None},
            {**job,'id':'self','customer_id':'agent'}, {**job,'id':'late'}, {**job,'id':'no_receipt'}]
    receipts = [{'id':j['id'],'job_id':j['id'],'verified_at':end if j['id']=='late' else start+2}
                for j in jobs if j['id']!='no_receipt']
    result = weekly_preview(jobs, receipts, [{'id':'agent','status':'approved'}], start, end, 2000)
    assert result['source_job_ids'] == ['a']
    assert result['shares'] == {'agent':2000}
    assert result['service_value_paise'] == {'agent':10000}
