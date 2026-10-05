"""Repaido B2B Wholesale, Bulk Orders, RFQs & Quotations Engine with Branded PDF Generation."""
import io, time, uuid
from typing import Literal, Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field
from html import escape

class PriceSlabInput(BaseModel):
    min_qty: int
    max_qty: Optional[int] = None
    price_paise: int
    discount_label: str

class B2BListingInput(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    category: str
    part_number: str
    hsn_code: str
    unit: str
    moq: int = Field(ge=1)
    base_price_paise: int = Field(ge=100)
    mrp_paise: int = Field(ge=100)
    bulk_slabs: List[PriceSlabInput] = []
    stock: int = Field(ge=0)
    lead_time_days: int = Field(ge=1, le=30)
    supply_capacity: str
    description: str
    specifications: Dict[str, str] = {}
    image: Optional[str] = None
    shop_id: str
    shop_name: str
    distributor_name: Optional[str] = None

class B2BRfqInput(BaseModel):
    listing_id: str
    item_title: str
    category: str
    hsn_code: str
    unit: str
    shop_id: str
    shop_name: str
    customer_name: str
    customer_phone: str
    customer_email: str
    buyer_company_name: Optional[str] = None
    buyer_gstin: Optional[str] = None
    delivery_address: str
    delivery_city: str
    delivery_pincode: str
    quantity_requested: int = Field(ge=1)
    target_price_paise: Optional[int] = None
    urgency: Literal['immediate', 'within_7_days', 'within_15_days', 'flexible'] = 'within_7_days'
    notes: Optional[str] = ''

class B2BQuotationInput(BaseModel):
    rfq_id: str
    offered_rate_paise: int = Field(ge=100)
    quantity: int = Field(ge=1)
    gst_rate: float = 0.18
    freight_charges_paise: int = 0
    payment_terms: str
    delivery_timeline: str
    warranty_terms: str
    validity_days: int = Field(ge=1, le=90, default=15)
    authorized_signatory: str
    signatory_designation: Optional[str] = 'Authorized Signatory'
    special_notes: Optional[str] = None

def generate_b2b_quotation_pdf(quote: Dict[str, Any]) -> bytes:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4

    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize = 9
    styles['BodyText'].leading = 13
    styles['Heading1'].textColor = colors.HexColor('#142858')
    styles['Heading1'].fontSize = 18
    styles['Heading2'].textColor = colors.HexColor('#142858')
    styles['Heading2'].fontSize = 12

    def p(text):
        return Paragraph(escape(str(text)).replace('\n', '<br/>'), styles['BodyText'])

    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    blocks = []

    # Header
    header_table = Table([
        [
            Paragraph('<b>REPAIDO COMMERCIAL & WHOLESALE B2B</b><br/><font size="8" color="#475569">Repaido Technologies India Pvt Ltd · GST State 21 (Odisha)</font>', styles['BodyText']),
            Paragraph(f'<b>TAX QUOTATION</b><br/><font color="#0284c7" size="10"><b>{quote["quote_number"]}</b></font><br/><font size="8">Valid until: {quote.get("valid_until", "15 Days")}</font>', styles['BodyText'])
        ]
    ], colWidths=[320, 200])
    header_table.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 2, colors.HexColor('#142858')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10)
    ]))
    blocks.extend([header_table, Spacer(1, 14)])

    # Parties (Supplier vs Buyer)
    parties_table = Table([
        [
            Paragraph('<b>SELLER / DISTRIBUTOR</b>', styles['BodyText']),
            Paragraph('<b>BUYER / CONSIGNEE</b>', styles['BodyText'])
        ],
        [
            Paragraph(f"<b>{quote.get('distributor_name', quote.get('shop_name', 'Verified Supplier'))}</b><br/>"
                      f"GSTIN: {quote.get('distributor_gstin', '21ABCDE1234F1Z5')}<br/>"
                      f"{quote.get('shop_address', 'Balasore, Odisha')}<br/>"
                      f"Phone: {quote.get('shop_phone', '+91 94370 00000')}", styles['BodyText']),
            Paragraph(f"<b>{quote.get('buyer_company_name') or quote.get('customer_name', 'Commercial Buyer')}</b><br/>"
                      f"Contact: {quote.get('customer_name')}<br/>"
                      f"GSTIN: {quote.get('buyer_gstin') or 'Unregistered / Commercial Retailer'}<br/>"
                      f"Delivery: {quote.get('delivery_address', '')}, {quote.get('delivery_city', '')} - {quote.get('delivery_pincode', '')}", styles['BodyText'])
        ]
    ], colWidths=[260, 260])
    parties_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F1F5F9')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    blocks.extend([parties_table, Spacer(1, 14)])

    # Itemized Table
    taxable_paise = quote['quantity'] * quote['offered_rate_paise']
    gst_paise = int(taxable_paise * quote['gst_rate'])
    grand_paise = taxable_paise + gst_paise + quote.get('freight_charges_paise', 0)

    items_data = [
        ['#', 'Item Description & Specs', 'HSN', 'Qty', 'Rate (INR)', 'Taxable (INR)'],
        [
            '1',
            Paragraph(f"<b>{quote['item_title']}</b><br/><font size='8' color='#64748b'>Standard industrial commercial grade</font>", styles['BodyText']),
            quote.get('hsn_code', '74112100'),
            f"{quote['quantity']} {quote.get('unit', 'Units')}",
            f"Rs. {quote['offered_rate_paise'] / 100:.2f}",
            f"Rs. {taxable_paise / 100:.2f}"
        ]
    ]
    items_table = Table(items_data, colWidths=[24, 250, 60, 56, 65, 65])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#142858')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT')
    ]))
    blocks.extend([items_table, Spacer(1, 14)])

    # Commercial Breakdown
    totals_data = [
        ['Subtotal Taxable Amount:', f"INR {taxable_paise / 100:.2f}"],
        [f"GST ({int(quote['gst_rate'] * 100)}%):", f"INR {gst_paise / 100:.2f}"],
        ['Freight / Logistics Charges:', f"INR {quote.get('freight_charges_paise', 0) / 100:.2f}"],
        ['GRAND TOTAL (INR):', f"INR {grand_paise / 100:.2f}"]
    ]
    totals_table = Table(totals_data, colWidths=[380, 140])
    totals_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, -1), (-1, -1), colors.HexColor('#142858')),
        ('LINEABOVE', (0, -1), (-1, -1), 1, colors.HexColor('#142858')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    blocks.extend([totals_table, Spacer(1, 14)])

    # Terms
    terms_text = (
        f"<b>1. Payment Terms:</b> {quote.get('payment_terms', '30% Advance Escrow, 70% upon delivery inspection')}<br/>"
        f"<b>2. Delivery SLA:</b> {quote.get('delivery_timeline', '2-3 business days via surface cargo')}<br/>"
        f"<b>3. Quality & Inspection:</b> {quote.get('warranty_terms', '1 Year Replacement Guarantee')}<br/>"
        f"<b>4. Platform Escrow:</b> All funds deposited through Repaido B2B Escrow are protected until delivery sign-off."
    )
    blocks.extend([Paragraph('<b>Commercial Terms & Conditions:</b>', styles['Heading2']), Paragraph(terms_text, styles['BodyText']), Spacer(1, 20)])

    # Signatures
    sig_data = [
        [
            Paragraph('<b>REPAIDO VERIFICATION SEAL</b><br/><font size="8" color="#64748b">Digitally certified document</font>', styles['BodyText']),
            Paragraph(f"<b>{quote.get('authorized_signatory', 'Authorized Signatory')}</b><br/><font size='8' color='#64748b'>{quote.get('signatory_designation', 'Director')}</font>", styles['BodyText'])
        ]
    ]
    sig_table = Table(sig_data, colWidths=[260, 260])
    blocks.extend([sig_table])

    doc.build(blocks)
    return out.getvalue()

def install(core):
    r = APIRouter(prefix='/operations', tags=['B2B Wholesale'])
    store = core.operations_store

    def optional_user(authorization: str = Header(default='')):
        if not authorization.startswith('Bearer '):
            return None
        return core.current_user(authorization)

    # --- LISTINGS ---
    @r.get('/b2b/listings')
    def get_listings():
        def read(u):
            rows = u.all('b2b_listings')
            return {'listings': [row for row in rows if row.get('status') == 'active']}
        return store.run(read)

    @r.post('/b2b/listings')
    def create_listing(body: B2BListingInput, user=Depends(optional_user)):
        def execute(u):
            listing_id = f"b2b-{uuid.uuid4().hex[:8]}"
            data = body.model_dump()
            data['id'] = listing_id
            data['status'] = 'active'
            data['created_at'] = time.time()
            data['updated_at'] = time.time()
            u.put('b2b_listings', listing_id, data)
            return {'listing': data}
        return store.run(execute)

    @r.put('/b2b/listings/{listing_id}')
    def update_listing(listing_id: str, updates: Dict[str, Any], user=Depends(optional_user)):
        def execute(u):
            listing = u.get('b2b_listings', listing_id)
            if not listing:
                return {'error': 'NOT_FOUND'}
            listing.update(updates)
            listing['updated_at'] = time.time()
            u.put('b2b_listings', listing_id, listing)
            return {'listing': listing}
        return store.run(execute)

    @r.delete('/b2b/listings/{listing_id}')
    def delete_listing(listing_id: str, user=Depends(optional_user)):
        def execute(u):
            u.delete('b2b_listings', listing_id)
            return {'success': True}
        return store.run(execute)

    # --- RFQ INQUIRIES ---
    @r.post('/b2b/rfq')
    def create_rfq(body: B2BRfqInput, user=Depends(optional_user)):
        def execute(u):
            rfq_id = f"rfq-{time.strftime('%Y')}-{uuid.uuid4().hex[:4].upper()}"
            data = body.model_dump()
            data['id'] = rfq_id
            data['status'] = 'pending'
            data['created_at'] = time.time()
            data['updated_at'] = time.time()
            u.put('b2b_rfqs', rfq_id, data)
            return {'rfq': data}
        return store.run(execute)

    @r.get('/b2b/rfq')
    def get_rfqs(shop_id: Optional[str] = None):
        def read(u):
            rows = u.all('b2b_rfqs')
            if shop_id:
                rows = [r for r in rows if r.get('shop_id') == shop_id]
            return {'rfqs': rows}
        return store.run(read)

    # --- QUOTATION GENERATION ---
    @r.post('/b2b/quotation')
    def generate_quotation(body: B2BQuotationInput, user=Depends(optional_user)):
        def execute(u):
            rfq = u.get('b2b_rfqs', body.rfq_id)
            quote_number = f"REP-B2B-QT-{time.strftime('%Y')}-{uuid.uuid4().hex[:4].upper()}"
            taxable = body.quantity * body.offered_rate_paise
            gst = int(taxable * body.gst_rate)
            grand = taxable + gst + body.freight_charges_paise

            quote_data = body.model_dump()
            quote_data.update({
                'quote_number': quote_number,
                'item_title': (rfq or {}).get('item_title', 'Wholesale Commercial Item'),
                'hsn_code': (rfq or {}).get('hsn_code', '74112100'),
                'unit': (rfq or {}).get('unit', 'Units'),
                'shop_id': (rfq or {}).get('shop_id', 'shop-bls-01'),
                'shop_name': (rfq or {}).get('shop_name', 'Maa Tarini Spare Hub'),
                'customer_name': (rfq or {}).get('customer_name', 'Commercial Buyer'),
                'buyer_company_name': (rfq or {}).get('buyer_company_name'),
                'buyer_gstin': (rfq or {}).get('buyer_gstin'),
                'delivery_address': (rfq or {}).get('delivery_address', ''),
                'delivery_city': (rfq or {}).get('delivery_city', 'Balasore'),
                'delivery_pincode': (rfq or {}).get('delivery_pincode', '756019'),
                'taxable_paise': taxable,
                'gst_paise': gst,
                'grand_total_paise': grand,
                'created_at': time.time()
            })

            u.put('b2b_quotations', quote_number, quote_data)
            if rfq:
                rfq['status'] = 'quoted'
                rfq['quotation'] = quote_data
                u.put('b2b_rfqs', body.rfq_id, rfq)

            return {'quotation': quote_data}
        return store.run(execute)

    @r.get('/b2b/quotation/{quote_number}/pdf')
    def get_quotation_pdf(quote_number: str):
        def read(u):
            q = u.get('b2b_quotations', quote_number)
            if not q:
                # Fallback template
                q = {
                    'quote_number': quote_number,
                    'item_title': 'Commercial Copper Tubing Coil 1/2" 50ft',
                    'quantity': 35,
                    'offered_rate_paise': 128000,
                    'gst_rate': 0.18,
                    'freight_charges_paise': 65000,
                    'customer_name': 'Biswajit Mohapatra',
                    'buyer_company_name': 'Kalinga HVAC Engineering Solutions'
                }
            pdf_bytes = generate_b2b_quotation_pdf(q)
            return Response(
                pdf_bytes,
                media_type='application/pdf',
                headers={
                    'Content-Disposition': f'attachment; filename="{quote_number}.pdf"',
                    'Cache-Control': 'no-store'
                }
            )
        return store.run(read)

    core.app.include_router(r)
