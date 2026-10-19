import pytest
from bike_economics import salary_scenarios


def test_three_rider_pilot_exposes_salary_coverage_floor_without_inventing_profit():
    result = salary_scenarios({'base_paise': 800, 'per_km_paise': 500}, 3)
    assert result['monthly_salary_paise'] == 2100000
    two_km = result['scenarios'][1]
    assert two_km['ordinary_fare_paise'] == 1800
    assert two_km['paid_rides_to_cover_salary_only'] == 1167
    assert 1166 * 1800 < 2100000 <= 1167 * 1800
    assert result['profit_estimate_paise'] is None
    assert 'fuel' in result['excluded_costs'] and 'Free rides' in result['assumptions']


def test_no_revenue_cannot_claim_to_cover_positive_salary_and_invalid_roster_is_rejected():
    assert all(row['paid_rides_to_cover_salary_only'] is None
               for row in salary_scenarios({'base_paise': 0, 'per_km_paise': 0}, 3)['scenarios'])
    assert salary_scenarios({}, 0)['monthly_salary_paise'] == 0
    for count in (-1, 4, True, 1.5):
        with pytest.raises(ValueError):
            salary_scenarios({}, count)


def test_replacing_a_rider_keeps_offboarded_salary_in_the_monthly_floor():
    result = salary_scenarios({}, 3, monthly_liability_paise=2800000)
    assert result['rider_count'] == 3
    assert result['monthly_salary_paise'] == 2800000
    assert result['scenarios'][1]['paid_rides_to_cover_salary_only'] == 1556
    with pytest.raises(ValueError):
        salary_scenarios({}, 3, monthly_liability_paise=1400000)


def test_reviewed_minimum_fare_is_included_in_salary_examples():
    result = salary_scenarios({'base_paise':800, 'per_km_paise':500, 'minimum_paise':5000}, 3)
    assert all(row['ordinary_fare_paise'] == 5000 for row in result['scenarios'])
    assert all(row['paid_rides_to_cover_salary_only'] == 420 for row in result['scenarios'])
    assert 'time charges' in result['assumptions']
