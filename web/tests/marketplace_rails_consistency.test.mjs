import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compactCss = readFileSync(new URL('../src/components/compact-market.css', import.meta.url), 'utf8');
const refurbCss = readFileSync(new URL('../src/components/refurbished-market.css', import.meta.url), 'utf8');
const b2bCss = readFileSync(new URL('../src/components/b2b-marketplace.css', import.meta.url), 'utf8');
const opportunityCss = readFileSync(new URL('../src/components/opportunity-carousel.css', import.meta.url), 'utf8');
const hiringCss = readFileSync(new URL('../src/components/hiring.css', import.meta.url), 'utf8');

test('Category rail buttons have standardized 32px height and pill shape across marketplace sections', () => {
  // 1. Spares & Refurbished category rail button
  assert.match(refurbCss, /\.spare-category-rail-btn\s*\{[^}]*height:\s*32px/);
  assert.match(refurbCss, /\.spare-category-rail-btn\s*\{[^}]*border-radius:\s*9999px/);
  assert.match(refurbCss, /\.spare-category-rail-btn\s*\{[^}]*font-size:\s*12px/);

  // 2. B2B Wholesale category chips
  assert.match(b2bCss, /\.b2b-cat-chip\s*\{[^}]*height:\s*32px/);
  assert.match(b2bCss, /\.b2b-cat-chip\s*\{[^}]*border-radius:\s*9999px/);
  assert.match(b2bCss, /\.b2b-cat-chip\s*\{[^}]*font-size:\s*12px/);

  // 3. Tool Rentals category rail
  assert.match(compactCss, /\.rental-rail button\s*\{[^}]*height:\s*32px/);
  assert.match(compactCss, /\.rental-rail button\s*\{[^}]*border-radius:\s*9999px/);

  // 4. Hiring category rail
  assert.match(hiringCss, /\.hire-category-rail button\s*\{[^}]*height:\s*32px/);
  assert.match(hiringCss, /\.hire-category-rail button\s*\{[^}]*border-radius:\s*9999px/);
});

test('Active category rail selection strictly adheres to signature navy (#142858) theme', () => {
  assert.match(refurbCss, /\.spare-category-rail-btn\.is-selected\s*\{[^}]*background:\s*#142858/);
  assert.match(b2bCss, /\.b2b-cat-chip\.active\s*\{[^}]*background:\s*#142858/);
});

test('Refurbished seasonal spotlight and condition grade chips maintain compact height to preserve above-the-fold preview', () => {
  // Capsule card height must be compact (34px) rather than legacy multi-row tall cards
  assert.match(refurbCss, /\.refurb-season-card\s*\{[^}]*height:\s*34px/);
  assert.match(refurbCss, /\.refurb-season-card\s*\{[^}]*border-radius:\s*9999px/);

  // Grade filter chips must match 28px pill standard
  assert.match(refurbCss, /\.refurb-grade-chip\s*\{[^}]*height:\s*28px/);
  assert.match(refurbCss, /\.refurb-grade-chip\s*\{[^}]*border-radius:\s*9999px/);
});

test('Opportunity carousel in marketplace view is streamlined to compact ticker (38px)', () => {
  assert.match(opportunityCss, /\.opportunity-carousel\.opportunity-market\s*\{[^}]*height:\s*38px/);
});

test('Market primary switch and segmented nav use compact 32px-34px heights', () => {
  assert.match(compactCss, /#root \.market-primary-switch button\s*\{[^}]*height:\s*32px/);
  assert.match(compactCss, /#root \.market-experience \.stores-nav-pill\s*\{[^}]*height:\s*32px/);
});
