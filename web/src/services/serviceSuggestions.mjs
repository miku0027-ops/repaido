// Browseable catalogue cards must remain available when personalisation/auth is unavailable.
export async function loadServiceSuggestions(uid, general, personal) {
  if (!uid) return {feed: await general(), notice: ''};
  try { return {feed: await personal(), notice: ''}; }
  catch {
    return {feed: await general(), notice: 'Personalised suggestions could not load. Showing general ideas. Retry when you are signed in and connected.'};
  }
}
