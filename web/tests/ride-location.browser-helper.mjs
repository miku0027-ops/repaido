/** Select a real browser geolocation reading in the inline editor. Offline map
 * fixtures exercise the short landmark fallback without inventing a place. */
export async function chooseRidePin(page,label,point,stop='dropoff'){
 const editor=page.locator('.go-location-workspace');await editor.waitFor();
 await page.context().grantPermissions(['geolocation']);
 await page.context().setGeolocation({latitude:point.lat,longitude:point.lng,accuracy:5});
 await editor.getByRole('button',{name:'Use my current location',exact:true}).click();
 await editor.getByLabel('Nearby street or landmark',{exact:true}).fill(label);
 await editor.getByLabel('City',{exact:true}).fill('Balasore');
 await editor.getByRole('button',{name:stop==='pickup'?'Confirm pickup':'Confirm drop-off',exact:true}).click();
 await editor.waitFor({state:'hidden'});
}
