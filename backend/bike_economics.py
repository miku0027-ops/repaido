"""Auditable salary-only planning floors, never a forecast of business profit."""
from decimal import Decimal, ROUND_CEILING


def salary_scenarios(policy, rider_count, salary_paise=700000, *, monthly_liability_paise=None):
    if type(rider_count) is not int or not 0 <= rider_count <= 3:
        raise ValueError('Use the actual active pilot roster, up to three riders.')
    if type(salary_paise) is not int or salary_paise < 0:
        raise ValueError('Salary must be integer paise.')
    salary = rider_count * salary_paise
    if monthly_liability_paise is not None:
        if type(monthly_liability_paise) is not int or monthly_liability_paise < salary:
            raise ValueError('Monthly liability must include all active and earned salary obligations.')
        salary = monthly_liability_paise
    base, rate, minimum = policy.get('base_paise', 800), policy.get('per_km_paise', 500), policy.get('minimum_paise', 0)
    if any(type(value) is not int or value < 0 for value in (base, rate, minimum)):
        raise ValueError('Tariffs must be nonnegative integer paise.')
    rows = []
    for distance in (1000, 2000, 4000):
        fare = max(minimum, base + (distance * rate + 999) // 1000)
        # Exclude tax and every surge/discount: neither is guaranteed operating
        # revenue. Free rides contribute zero collections toward this floor.
        needed = int((Decimal(salary) / fare).to_integral_value(rounding=ROUND_CEILING)) if fare else None
        rows.append({'distance_metres': distance, 'ordinary_fare_paise': fare,
                     'paid_rides_to_cover_salary_only': needed})
    return {'model': 'salary-only-floor-v1', 'rider_count': rider_count,
            'monthly_salary_paise': salary, 'scenarios': rows,
            'profit_estimate_paise': None,
            'excluded_costs': ['fuel', 'maintenance', 'insurance', 'tax', 'dispatch_infrastructure'],
            'assumptions': 'Base, distance and minimum fare only; time charges, surge and tax are excluded. '
                           'Free rides produce no fare collection. These examples cover salary only and do not '
                           'forecast demand, profit, total operating costs or rider workload.'}
