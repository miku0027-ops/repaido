"""One integer-paise, owner-funded new-spare offer projection for all surfaces.

Stored inventory.price_paise remains the merchant's base; never rewrite paid order
snapshots or invent MRP. Explicit merchant offers replace the registration offer.
A declared price floor is always honoured, including when the 5% trial is active.
"""
import time
from fastapi import APIRouter, Depends
from pydantic import Field
from operations import Input, fail
from integrations import audit
from shop_access import registration_start, TRIAL_DAYS

PUBLIC_FIELDS = ('id','shop_id','name','sku','category','compatibility','stock','version','image_url',
                 'condition','warranty','refurbishment_details','refurbishment','gst_bps','status','stock_confirmed_at')


def price(u, product, now=None):
    now=time.time() if now is None else now
    base=product['price_paise'];bps=0;source=None;until=None
    shop=u.get('shops',product['shop_id']) or {}
    offer=product.get('shop_offer') or {}
    if product.get('condition','new') == 'new':
        if offer.get('active') is True and type(offer.get('discount_bps')) is int and offer.get('discount_bps',0) > 0:
            bps=offer.get('discount_bps',0);source='shop' if bps else None
        else:
            end=registration_start(shop)+TRIAL_DAYS*86400
            settings=u.get('shop_access_settings',shop.get('id','')) or {}
            known=type(shop.get('created_at')) in (int,float)
            trial=registration_start(shop) <= now < end
            enabled=True if trial and known else settings.get('default_offer_enabled',True if known else False)
            # The policy's automatic offer applies only to dated registrations;
            # after trial owners can retain it or explicitly disable it.
            if enabled and now >= registration_start(shop) and (known or settings.get('default_offer_enabled') is True):
                bps=500;source='trial_default';until=end if trial else None
    if type(bps) is not int or not 0 <= bps <= 2500:
        # Historical/corrupt offer metadata must never create a discount.
        bps=0;source=None
    floor=offer.get('min_price_paise',0)
    if type(floor) is not int or floor < 0:floor=0
    discount=min(base*bps//10000,max(0,base-floor))
    effective=base-discount
    return dict(base_price_paise=base,price_paise=effective,discount_paise=discount,
                discount_bps=(bps if discount == base*bps//10000 else discount*10000//base) if base and discount else 0,
                offer_source=source if discount else None,valid_until=until if discount else None)


def effective_product(u,product,now=None):
    return {**{key:product.get(key) for key in PUBLIC_FIELDS},**price(u,product,now)}


class Offer(Input):
    expected_version:int=Field(ge=1)
    discount_bps:int=Field(ge=0,le=2500)
    active:bool
    min_price_paise:int|None=Field(default=None,ge=0,le=100000000)


def install(core):
    router=APIRouter(prefix='/operations/shop/products',tags=['Shop product offers']);store=core.operations_store
    @router.put('/{product_id}/offer')
    def offer(product_id:str,body:Offer,user=Depends(core.current_user)):
        if not user.get('phone_authenticated'):fail('PHONE_OTP_REQUIRED','Sign in with your shop mobile OTP.',403)
        def save(u):
            p=u.get('inventory',product_id);shop=u.get('shops',p['shop_id']) if p else None
            if not p or not shop or shop.get('owner_id') != user['id']:fail('NOT_FOUND','Product not found.',404)
            if shop.get('status') != 'approved':fail('SHOP_APPROVAL_REQUIRED','Independent shop approval is required.',403)
            if p.get('condition','new') != 'new':fail('OFFER_CATEGORY_UNSUPPORTED','This offer policy applies to new spare parts.',422)
            if p.get('version',1) != body.expected_version:fail('STOCK_CHANGED','Refresh this product before changing its offer.',409)
            if body.min_price_paise is not None and body.min_price_paise > p['price_paise']:fail('INVALID_FLOOR','The price floor cannot exceed the base price.',422)
            p['shop_offer']=dict(discount_bps=body.discount_bps,active=body.active,min_price_paise=body.min_price_paise or 0,updated_at=time.time())
            p['version']=p.get('version',1)+1;u.put('inventory',p['id'],p)
            audit(u,'ShopProductOfferChanged',user['id'],shop_id=shop['id'],product_id=p['id'],discount_bps=body.discount_bps,active=body.active,min_price_paise=body.min_price_paise)
            return {'product':effective_product(u,p),'version':p['version']}
        return store.run(save)
    core.app.include_router(router)
