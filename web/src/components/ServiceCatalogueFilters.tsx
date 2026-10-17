import {useId, useMemo, useState} from 'react';
import {ArrowRight, Category, MapPin, RotateCcw, PersonSearch} from '../icons';
import {categories} from '../data';
import type {CategoryId, Service} from '../types';
import {Modal} from './ui';
import './service-catalogue-filters.css';

export interface ServiceCatalogueFilterValue {
  category: CategoryId;
  sort: string;
  maxPrice: string;
  roleFilter: 'all' | 'specialist' | 'technician';
  radiusKm: string;
}

const defaults: ServiceCatalogueFilterValue = {
  category: 'all', sort: 'recommended', maxPrice: '', roleFilter: 'all', radiusKm: '6'
};

export default function ServiceCatalogueFilters({
  value, services, query = '', city, nearbyAvailable, onApply, onClose
}: {
  value: ServiceCatalogueFilterValue;
  services: Service[];
  query?: string;
  city: string;
  nearbyAvailable: boolean;
  onApply: (value: ServiceCatalogueFilterValue) => void;
  onClose: () => void;
}) {
  // This sheet is mounted for each visit. Closing it leaves the applied filters intact.
  const [draft, setDraft] = useState<ServiceCatalogueFilterValue>(() => ({...value}));
  const id = useId();
  const set = <K extends keyof ServiceCatalogueFilterValue>(key: K, next: ServiceCatalogueFilterValue[K]) => {
    setDraft(current => ({...current, [key]: next}));
  };
  const count = useMemo(() => {
    const text = query.trim().toLowerCase();
    return services.filter(service => {
      if (draft.category !== 'all' && service.category !== draft.category) return false;
      if (draft.maxPrice && service.price > Number(draft.maxPrice) * 100) return false;
      return !text || `${service.name} ${service.description} ${service.included.join(' ')} ${service.category}`.toLowerCase().includes(text);
    }).length;
  }, [services, query, draft.category, draft.maxPrice]);

  return <Modal title="Filters & sort" onClose={onClose} className="service-catalogue-filter-sheet">
    <form className="catalogue-filter-form" onSubmit={event => {event.preventDefault(); onApply({...draft});}}>
      <div className="catalogue-filter-body">
        <div className="catalogue-filter-summary">
          <div role="status" aria-live="polite" aria-atomic="true"><strong>{count}</strong><span>{count === 1 ? 'matching service' : 'matching services'}</span></div>
          <span className="catalogue-filter-city"><MapPin size={14} aria-hidden="true"/>{city}</span>
        </div>
        {query.trim() && <p className="catalogue-filter-query">Search: <bdi>{query.trim()}</bdi></p>}

        <fieldset className="catalogue-filter-section">
          <legend><Category size={16} aria-hidden="true"/>Service catalogue</legend>
          <div className="catalogue-filter-fields">
            <div className="catalogue-filter-field catalogue-filter-wide">
              <label htmlFor={`${id}-category`}>Service category</label>
              <select id={`${id}-category`} value={draft.category} onChange={event => set('category', event.target.value as CategoryId)} data-autofocus>
                {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div className="catalogue-filter-field">
              <label htmlFor={`${id}-sort`}>Sort services</label>
              <select id={`${id}-sort`} value={draft.sort} onChange={event => set('sort', event.target.value)}>
                <option value="recommended">Recommended</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="rating">Highest Rated</option>
                <option value="duration">Shortest visit</option>
              </select>
            </div>
            <div className="catalogue-filter-field">
              <label htmlFor={`${id}-price`}>Max Budget</label>
              <select id={`${id}-price`} value={draft.maxPrice} onChange={event => set('maxPrice', event.target.value)}>
                <option value="">Any Budget</option>
                <option value="300">Up to ₹300</option>
                <option value="600">Up to ₹600</option>
                <option value="1000">Up to ₹1,000</option>
                <option value="3000">Up to ₹3,000</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="catalogue-filter-section" aria-describedby={`${id}-professionals-note`}>
          <legend><PersonSearch size={16} aria-hidden="true"/>Nearby professionals</legend>
          <p id={`${id}-professionals-note`} className="catalogue-filter-note">Choose which professionals appear in Category leaders.</p>
          <div className="catalogue-filter-fields">
            <div className="catalogue-filter-field">
              <label htmlFor={`${id}-role`}>Professional role</label>
              <select id={`${id}-role`} value={draft.roleFilter} onChange={event => set('roleFilter', event.target.value as ServiceCatalogueFilterValue['roleFilter'])}>
                <option value="all">All roles</option>
                <option value="specialist">Specialist</option>
                <option value="technician">Technician</option>
              </select>
            </div>
            <div className="catalogue-filter-field">
              <label htmlFor={`${id}-radius`}>Professional search radius</label>
              <select id={`${id}-radius`} disabled={!nearbyAvailable} value={draft.radiusKm} onChange={event => set('radiusKm', event.target.value)} aria-describedby={!nearbyAvailable ? `${id}-location-note` : undefined}>
                <option value="3">Within 3 km</option>
                <option value="6">Within 6 km</option>
              </select>
            </div>
          </div>
          {!nearbyAvailable && <p id={`${id}-location-note`} className="catalogue-filter-location-note"><MapPin size={14} aria-hidden="true"/><span>Browsing {city}. Set a location on Explore to filter professionals by distance.</span></p>}
        </fieldset>
      </div>

      <footer className="catalogue-filter-footer">
        <button type="button" className="catalogue-filter-reset" onClick={() => setDraft({...defaults})}><RotateCcw size={16} aria-hidden="true"/>Reset Filters</button>
        <button type="submit" className="catalogue-filter-apply">Show {count} {count === 1 ? 'service' : 'services'}<ArrowRight size={16} aria-hidden="true"/></button>
      </footer>
    </form>
  </Modal>;
}
