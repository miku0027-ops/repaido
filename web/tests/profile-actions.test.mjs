import test from 'node:test';
import assert from 'node:assert/strict';
import {profileActionOptions, profileHireLabel} from '../src/services/profileActions.mjs';

const services = [
  {id: 'clean', name: 'Home cleaning', category: 'cleaning'},
  {id: 'pipes', name: 'Leak inspection', category: 'plumber'},
  {id: 'wires', name: 'Electrical inspection', category: 'electrician'},
  {id: 'ac-service', name: 'AC service', category: 'ac'},
];

test('categories alone cannot create booking actions or restore withdrawn Home approval', () => {
  const professional = {categories: ['cleaning', 'home:maid', 'plumber'], home_services: [], service_packages: []};
  assert.deepEqual(profileActionOptions(professional, {category: 'home:maid', services}), []);
  assert.equal(profileHireLabel(professional, 'home:maid'), 'Hire cleaner');
  assert.deepEqual(profileActionOptions(undefined), []);
});

test('selected category comes first, followed by profile categories, retaining package order within ties', () => {
  const professional = {
    categories: ['plumber', 'cleaning', 'ac'], home_services: ['maid', 'caretaker'],
    service_packages: [
      {id: 'ac-service', name: 'AC service'}, {id: 'clean', name: 'Home cleaning'},
      {id: 'pipes', name: 'Leak inspection'}, {id: 'wires', name: 'Electrical inspection'},
      {id: 'drain', name: 'Drain inspection', category: 'plumber'},
    ],
  };
  assert.deepEqual(profileActionOptions(professional, {category: 'electrician', services}).map(action => action.id),
    ['wires', 'pipes', 'drain', 'clean', 'ac-service', 'maid', 'caretaker']);
  const homeFirst = profileActionOptions(professional, {category: 'home:caretaker', services});
  assert.equal(homeFirst[0].id, 'caretaker');
  assert.equal(homeFirst[0].label, 'Hire caretaker');
  assert.equal(homeFirst[0].category, 'home:caretaker');
  assert.match(homeFirst[0].reason, /Matches your selected category/);
  assert.deepEqual(profileActionOptions(professional, {category: 'all', services}).map(action => action.id),
    ['pipes', 'drain', 'clean', 'ac-service', 'maid', 'caretaker', 'wires']);
});

test('only listed packages can become service actions, using catalogue category by exact ID or package category', () => {
  const professional = {categories: ['plumber'], service_packages: [
    {id: 'pipes', name: 'Listed pipe inspection', category: 'ac'},
    {id: 'custom', name: 'Custom carpentry', category: 'carpenter'},
    {id: 'unknown', name: 'Unknown package'},
    {id: 'unnamed', category: 'ac'},
    {id: 'clean'},
  ]};
  const options = profileActionOptions(professional, {services});
  assert.deepEqual(options.map(({id, category, label}) => ({id, category, label})), [
    {id: 'pipes', category: 'plumber', label: 'Book Listed pipe inspection'},
    {id: 'custom', category: 'carpenter', label: 'Book Custom carpentry'},
    {id: 'clean', category: 'cleaning', label: 'Book Home cleaning'},
  ]);
  assert(!options.some(option => option.id === 'wires'));
  assert.match(options[0].reason, /listed professional category/);
  assert.match(options[1].reason, /Published service package listed on this profile/);
});

test('approved Home actions have role or scope labels and duplicate data creates one action per kind and ID', () => {
  const options = profileActionOptions({
    home_services: ['maid', 'maid', 'home:caretaker', 'interior-design', 'future-project', '', null],
    service_packages: [{id: 'maid', name: 'One-off cleaning', category: 'cleaning'},
      {id: 'maid', name: 'Duplicate package', category: 'cleaning'}, null],
  });
  assert.deepEqual(options.map(({kind, id, label}) => ({kind, id, label})), [
    {kind: 'home', id: 'maid', label: 'Hire maid'},
    {kind: 'home', id: 'caretaker', label: 'Hire caretaker'},
    {kind: 'home', id: 'interior-design', label: 'Request interior design scope'},
    {kind: 'home', id: 'future-project', label: 'Request future project scope'},
    {kind: 'service', id: 'maid', label: 'Book One-off cleaning'},
  ]);
  assert(options.every(option => typeof option.reason === 'string' && option.reason.length > 0));
});

test('ordering is deterministic and does not mutate profile or catalogue data', () => {
  const professional = Object.freeze({categories: Object.freeze(['ac', 'plumber']),
    home_services: Object.freeze(['maid']), service_packages: Object.freeze([
      Object.freeze({id: 'pipes', name: 'Pipe repair'}), Object.freeze({id: 'ac-service', name: 'AC service'}),
    ])});
  const catalogue = Object.freeze(services.map(service => Object.freeze({...service})));
  const before = JSON.stringify({professional, catalogue});
  const first = profileActionOptions(professional, {category: 'ac', services: catalogue});
  assert.deepEqual(first, profileActionOptions(professional, {category: 'ac', services: catalogue}));
  assert.equal(JSON.stringify({professional, catalogue}), before);
  assert.deepEqual(first.map(option => Object.keys(option).sort()),
    first.map(() => ['category', 'id', 'kind', 'label', 'reason']));
});

test('hire labels follow an eligible selected role, with factual category and generic fallbacks', () => {
  assert.equal(profileHireLabel({home_services: ['maid']}, 'home:maid'), 'Hire maid');
  assert.equal(profileHireLabel({home_services: ['caretaker']}, 'home:caretaker'), 'Hire caretaker');
  assert.equal(profileHireLabel({categories: ['ac', 'plumber']}, 'plumber'), 'Hire plumber');
  assert.equal(profileHireLabel({categories: ['ac', 'plumber']}, 'unknown'), 'Hire technician');
  assert.equal(profileHireLabel({categories: ['electrician']}), 'Hire electrician');
  assert.equal(profileHireLabel({categories: ['carpenter']}), 'Hire carpenter');
  assert.equal(profileHireLabel({categories: ['unknown']}), 'Hire professional');
  assert.equal(profileHireLabel(null), 'Hire professional');
});
