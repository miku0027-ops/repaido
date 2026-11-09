import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Sparkles } from '../icons';
import ReferenceArt from './ReferenceArt';
import ServiceImage from './ServiceImage';
import { seededServices, formatMoney, formatDuration } from '../data';

const slides = [
  {
    category: 'all',
    label: 'Home services',
    eyebrow: 'REPAIDO VERIFIED',
    title: 'Trusted home help at',
    accent: 'budget-friendly prices',
    copy: 'Specialists & technicians within 6 km. Pay after service.',
    art: 'hero',
    cta: 'Book now'
  },
  {
    category: 'all',
    label: 'Your first booking',
    eyebrow: 'A SIMPLE START',
    title: 'New to Repaido?',
    accent: 'Choose the help you need',
    copy: 'See the scope and price before requesting your first visit.',
    art: 'hero',
    cta: 'Browse services'
  },
  {
    category: 'cleaning',
    label: 'Deep cleaning',
    eyebrow: 'EXPRESS DEEP CLEAN',
    title: 'A little care.',
    accent: 'A fresher home.',
    copy: 'Kitchen, bathroom, and sofa deep sanitisation experts.',
    art: 'cleaning',
    cta: 'Explore cleaning'
  },
  {
    category: 'ac',
    label: 'Appliance care',
    eyebrow: 'COOLING & REPAIR',
    title: 'Something stopped?',
    accent: 'Fast check-up visit.',
    copy: 'Transparent diagnostics with Repaido Pro Specialist tools.',
    art: 'ac',
    cta: 'Explore repairs'
  },
  {
    category: 'plumber',
    label: 'Expert plumbing',
    eyebrow: 'EXPERT PLUMBERS',
    title: 'Leaking tap or pipe?',
    accent: 'Fast doorstep arrival.',
    copy: 'Certified plumbers with leak detectors & professional pipe tools.',
    art: 'plumber',
    cta: 'Book Plumber'
  },
  {
    category: 'electrician',
    label: 'Safety electrical',
    eyebrow: 'SAFETY FIRST ELECTRICAL',
    title: 'Switch, fan or wiring?',
    accent: 'Certified electricians.',
    copy: 'Insulated shock-proof toolkit and digital multimeters for total safety.',
    art: 'electrician',
    cta: 'Book Electrician'
  }
];

export function ServiceSlideshow({onSelect, reduceMotion=false}:{reduceMotion?:boolean; onSelect:(category:string, q?:string)=>void}){
  const touch = useRef<number|null>(null);
  const [index, setIndex] = useState(0);
  const slide = slides[index];

  return (
    <section
      className="service-slideshow"
      onTouchStart={e => {

        touch.current = e.touches[0].clientX;
      }}
      onTouchEnd={e => {
        if (touch.current !== null) {
          const distance = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(distance) > 50) setIndex(i => (i + (distance < 0 ? 1 : slides.length - 1)) % slides.length);
          touch.current = null;
        }
      }}
      aria-roledescription="carousel"
      aria-label="Explore services"
    >
      <div
        className={`reference-hero compact-hero-slide slide-${index}`}
        key={index}
        aria-roledescription="slide"
        aria-label={`${index + 1} of ${slides.length}: ${slide.title} ${slide.accent}`}
      >
        <div className="compact-hero-text">
          <span className="banner-eyebrow"><Sparkles size={12} aria-hidden="true" />{slide.eyebrow}</span>
          <h2 className="banner-headline">
            {slide.title} <em>{slide.accent}</em>
          </h2>
          <p className="banner-subcopy">{slide.copy}</p>
          <button className="navy-button compact-banner-cta" onClick={() => onSelect(slide.category)}>
            <span>{slide.cta}</span>
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="hero-technician compact-hero-art">
          <ReferenceArt name={slide.art} />
        </div>
      </div>

      <div className="slideshow-controls">
        <span aria-live="polite" aria-atomic="true">
          {String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')} · {slide.label}
        </span>

        <div className="slide-dots">
          {slides.map((s, i) => (
            <button
              key={`${s.category}-${i}`}
              aria-label={`Show slide ${i + 1}: ${s.title}`}
              aria-pressed={index === i}
              onClick={() => {

                setIndex(i);
              }}
            >
              <span />
            </button>
          ))}
        </div>
        <button aria-label="Previous service slide" onClick={() => { setIndex((index + slides.length - 1) % slides.length); }}>
          <ArrowLeft size={16} />
        </button>
        <button aria-label="Next service slide" onClick={() => { setIndex((index + 1) % slides.length); }}>
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function CategoryPicks({onSelect}:{onSelect:(category:string, q?:string)=>void}){
  const [category, setCategory] = useState('cleaning');
  const services = seededServices.filter(s => s.category === category).slice().sort((a,b) => a.price - b.price).slice(0, 3);

  return (
    <section className="category-picks">
      <div className="section-title">
        <div>
          <span className="micro-eyebrow">POPULAR PACKAGES</span>
          <h2>Explore top services</h2>
        </div>
        <span className="local-badge">Within 6 km</span>
      </div>
      <div className="pick-tabs" aria-label="Category highlights">
        {[['cleaning','Cleaning'],['ac','Appliances'],['car','Car Care'],['plumber','Plumbing']].map(([id,label]) => (
          <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>
        ))}
      </div>
      <div className="pick-rail" key={category}>
        {services.map(s => (
          <button className="pick-card" key={s.id} onClick={() => onSelect(s.category, s.name)}>
            <ServiceImage service={s} decorative className="pick-photo" />
            <span className="pick-copy">
              <strong>{s.name}</strong>
              <span><Clock3 size={12}/>{formatDuration(s.duration)}</span>
              <b>{formatMoney(s.price)}<ArrowRight size={16}/></b>
            </span>
          </button>
        ))}
      </div>
      <p className="micro-note">Matching depends on approved professionals and availability within 6 km.</p>
    </section>
  );
}
