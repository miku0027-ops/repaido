import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const leadersTsxPath = path.resolve('src/components/ServiceLeaders.tsx');
const leadersCssPath = path.resolve('src/components/service-leaders.css');

test('Category Leaders: Basanti Behera verified record and specifications', () => {
  const tsxContent = fs.readFileSync(leadersTsxPath, 'utf8');

  // Verify Basanti Behera is present in Cleaning category
  assert.match(tsxContent, /name:\s*['"]Basanti Behera['"]/);
  assert.match(tsxContent, /category:\s*['"]cleaning['"]/);

  // 15 years experience
  assert.match(tsxContent, /experience_years:\s*15/);

  // Highest demand tier
  assert.match(tsxContent, /demand_tier:\s*['"]highest_demand['"]/);
  assert.match(tsxContent, /demand_badge:\s*['"]🔥 Highest Demand['"]/);

  // Rating above 4.7 (4.92)
  assert.match(tsxContent, /rating:\s*4\.92/);

  // Profile image is configured and rendered
  assert.match(tsxContent, /profileImage:\s*['"]\/images\/specialists\/basanti_behera\.jpg['"]/);
  assert.match(tsxContent, /className=['"]card-avatar-img['"]/);

  // Scrolling customer testimonials present
  assert.match(tsxContent, /Kuruda,\s*Balasore/);
  assert.match(tsxContent, /3BHK Villa Full Deep Cleaning/);
});

test('Category Leaders: Dual simultaneous categories and authentic agent profiles', () => {
  const tsxContent = fs.readFileSync(leadersTsxPath, 'utf8');

  // Tushar Ranjan Das in electrician category with original photo
  assert.match(tsxContent, /name:\s*['"]Tushar Ranjan Das['"]/);
  assert.match(tsxContent, /category:\s*['"]electrician['"]/);
  assert.match(tsxContent, /rating:\s*4\.94/);
  assert.match(tsxContent, /experience_years:\s*8/);
  assert.match(tsxContent, /profileImage:\s*['"]\/images\/specialists\/tushar_das\.jpg['"]/);

  // Paramesh Prasad Mohapatra in pest category with original photo
  assert.match(tsxContent, /name:\s*['"]Paramesh Prasad Mohapatra['"]/);
  assert.match(tsxContent, /category:\s*['"]pest['"]/);
  assert.match(tsxContent, /profileImage:\s*['"]\/images\/specialists\/paramesh_mohapatra\.jpg['"]/);

  // Ensure mock profile IDs are completely removed
  assert.doesNotMatch(tsxContent, /w-elec-spec-1/);
  assert.doesNotMatch(tsxContent, /w-ac-spec-1/);
  assert.doesNotMatch(tsxContent, /w-plumb-spec-1/);

  // Default simultaneous categories contains at least 2: cleaning and electrician
  assert.match(tsxContent, /\['cleaning',\s*'electrician'\]/);

  // Randomize / shuffle functionality
  assert.match(tsxContent, /handleRandomize/);
});

test('Category Leaders: Compact Android-native layout and small button specifications', () => {
  const cssContent = fs.readFileSync(leadersCssPath, 'utf8');

  // Small buttons with 28px height
  assert.match(cssContent, /\.btn-small-profile\s*{[^}]*height:\s*28px/);
  assert.match(cssContent, /\.btn-small-hire\s*{[^}]*height:\s*28px/);
  assert.match(cssContent, /\.leader-randomize-btn\s*{[^}]*height:\s*28px/);
  assert.match(cssContent, /\.leader-pill-btn\s*{[^}]*height:\s*28px/);

  // Mobile-first single column showcase without horizontal overflow
  assert.match(cssContent, /\.leader-showcase-grid\s*{[^}]*flex-direction:\s*column/);

  // Auto-scrolling single line ticker
  assert.match(cssContent, /\.card-ticker-strip/);
});
