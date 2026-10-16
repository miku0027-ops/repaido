const homeLabels = new Map([
  ['maid', 'Hire maid'],
  ['caretaker', 'Hire caretaker'],
  ['interior-design', 'Request interior design scope'],
  ['floor-plan', 'Request floor plan scope'],
  ['renovation', 'Request renovation scope'],
  ['decor', 'Request home decor scope'],
  ['civil-engineer', 'Request civil engineer consultation'],
  ['contractor', 'Request contractor scope'],
]);

const categoryRoles = new Map([
  ['cleaning', 'cleaner'], ['plumber', 'plumber'], ['plumbing', 'plumber'],
  ['electrician', 'electrician'], ['electrical', 'electrician'],
  ['ac', 'technician'], ['appliance', 'technician'], ['appliances', 'technician'],
  ['carpenter', 'carpenter'], ['carpentry', 'carpenter'], ['painting', 'painter'],
  ['salon', 'salon professional'], ['pest', 'pest control professional'],
  ['pest-control', 'pest control professional'], ['moving', 'moving professional'],
  ['car', 'vehicle professional'], ['vehicle', 'vehicle professional'],
  ['gardening', 'gardener'], ['road-assistance', 'road assistance professional'],
  ['home:maid', 'maid'], ['home:caretaker', 'caretaker'],
  ['home:interior-design', 'interior designer'], ['home:floor-plan', 'floor plan professional'],
  ['home:renovation', 'renovation professional'], ['home:decor', 'decor specialist'],
  ['home:civil-engineer', 'civil engineer'], ['home:contractor', 'contractor'],
]);

const rows = value => Array.isArray(value) ? value : [];
const identifier = value => typeof value === 'string' ? value.trim() : '';
const categoryId = value => identifier(value) === 'all' ? '' : identifier(value);
const homeId = value => identifier(value).replace(/^home:/, '');
const words = value => value.replace(/[_-]/g, ' ');

/** Return only actions backed by this profile's approved Home services or listed packages.
 * The selected category is first, followed by the profile's category order. Ties retain
 * source order, so opening a profile again never rotates its booking choices.
 */
export function profileActionOptions(professional, {category = '', services = []} = {}) {
  const selected = categoryId(category);
  const categories = [...new Set(rows(professional?.categories).map(categoryId).filter(Boolean))];
  const catalogue = new Map();
  for (const service of rows(services)) {
    const id = identifier(service?.id);
    if (id && categoryId(service?.category) && !catalogue.has(id)) catalogue.set(id, service);
  }
  const choices = [], seen = new Set();
  const add = option => {
    const key = option.kind + ':' + option.id;
    if (seen.has(key)) return;
    seen.add(key);
    const basis = option.kind === 'home'
      ? 'Approved Home service listed on this profile.'
      : 'Published service package listed on this profile.';
    const reason = selected === option.category ? 'Matches your selected category. ' + basis
      : categories.includes(option.category) ? 'Matches a listed professional category. ' + basis : basis;
    choices.push({...option, reason});
  };
  for (const value of rows(professional?.home_services)) {
    const id = homeId(value);
    if (!id) continue;
    add({kind: 'home', id, label: homeLabels.get(id) || `Request ${words(id)} scope`, category: 'home:' + id});
  }
  for (const entry of rows(professional?.service_packages)) {
    const id = identifier(entry?.id);
    const service = catalogue.get(id);
    const packageCategory = categoryId(service?.category) || categoryId(entry?.category);
    const name = identifier(entry?.name) || identifier(service?.name);
    if (!id || !packageCategory || !name) continue;
    add({kind: 'service', id, label: 'Book ' + name, category: packageCategory});
  }
  const priority = option => {
    if (selected && option.category === selected) return -1;
    const index = categories.indexOf(option.category);
    return index < 0 ? categories.length : index;
  };
  return choices.sort((a, b) => priority(a) - priority(b));
}

/** A role label for an existing hire control; this does not establish availability. */
export function profileHireLabel(professional, category = '') {
  const categories = [...new Set([
    ...rows(professional?.categories).map(categoryId).filter(value => value && !value.startsWith('home:')),
    ...rows(professional?.home_services).map(homeId).filter(Boolean).map(id => 'home:' + id),
  ])];
  const selected = categoryId(category);
  const ordered = categories.includes(selected) ? [selected, ...categories] : categories;
  const role = ordered.map(value => categoryRoles.get(value)).find(Boolean);
  return 'Hire ' + (role || 'professional');
}
