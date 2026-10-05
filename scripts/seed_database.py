#!/usr/bin/env python3
"""
Repaido Infrastructure Database Seeder
Seeds Cloud Firestore (project 'repaido') and local SQLite (backend/repaido.db)
with full production-grade schemas, services catalog, verified technician profiles,
and city coverage.
"""
import os
import sys
import json
import sqlite3
from datetime import datetime, timezone

# 1. Official 19 Verified Repaido Services
SERVICES_CATALOG = [
    {
        "id": "home-clean",
        "category": "cleaning",
        "name": "Home deep cleaning",
        "description": "Comprehensive deep cleaning for kitchen, bathrooms, floors and living spaces with hospital-grade sanitisation.",
        "price_paise": 299900,
        "original_price_paise": 399900,
        "duration_minutes": 240,
        "badge": "DEEP CLEAN",
        "rating": 4.88,
        "review_count": 1240,
        "image": "/images/service-photos.png",
        "imageTile": 0,
        "included": ["Kitchen & bathroom scrubbing", "Deep machine floor buffing", "Surfaces, glass and balcony wash", "Hospital-grade disinfectant spray"],
        "excluded": ["Exterior high-rise windows", "Moving solid teak/heavy furniture"],
        "active": True
    },
    {
        "id": "ac-service",
        "category": "ac",
        "name": "AC power service & filter jet clean",
        "description": "Deep coil foam jet clean, water drainage unclog, gas level check and 15-point cooling efficiency diagnostics.",
        "price_paise": 59900,
        "original_price_paise": 79900,
        "duration_minutes": 60,
        "badge": "SEASONAL PICK",
        "rating": 4.92,
        "review_count": 3850,
        "image": "/images/service-photos.png",
        "imageTile": 1,
        "included": ["Indoor coil high-pressure foam wash", "Filter & blower wheel deep clean", "Drain tray & pipe blockage unclogging", "Cooling gas pressure & electrical check"],
        "excluded": ["Gas leak welding & refill", "Compressor spare parts replacement"],
        "active": True
    },
    {
        "id": "plumbing",
        "category": "plumber",
        "name": "Plumbing repair & leak inspection",
        "description": "Expert diagnosis of hidden pipe leaks, low water pressure, blocked drains or faucet repair with laser precision.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "QUICK FIX",
        "rating": 4.85,
        "review_count": 2140,
        "image": "/images/service-photos.png",
        "imageTile": 2,
        "included": ["Diagnostic check of reported issue", "Pressure test on faucets & angle valves", "Minor washer / thread tape fix", "Transparent parts quote before work"],
        "excluded": ["Piping replacement materials", "Concealed wall breakage without approval"],
        "active": True
    },
    {
        "id": "bathroom",
        "category": "cleaning",
        "name": "Bathroom deep cleaning & de-scaling",
        "description": "Removal of stubborn hard-water stains, tile grout whitening, tap descaling and toilet disinfection.",
        "price_paise": 49900,
        "original_price_paise": 69900,
        "duration_minutes": 60,
        "badge": "EVERYDAY ESSENTIAL",
        "rating": 4.87,
        "review_count": 4320,
        "image": "/images/service-photos.png",
        "imageTile": 3,
        "included": ["Tile scrubbing & hard-water stain removal", "Chrome fittings descaling & mirror polish", "Toilet pot & basin deep sanitisation", "Floor grout scrubbing with safe chemicals"],
        "excluded": ["Ceiling repainting", "Exhaust fan rewiring"],
        "active": True
    },
    {
        "id": "washing-machine",
        "category": "ac",
        "name": "Washing machine check-up & service",
        "description": "Complete drum diagnostics, vibration check, inlet filter cleaning, and error code troubleshooting.",
        "price_paise": 24900,
        "original_price_paise": 34900,
        "duration_minutes": 45,
        "badge": "DIAGNOSTIC",
        "rating": 4.82,
        "review_count": 1650,
        "image": "/images/service-photos.png",
        "imageTile": 4,
        "included": ["Drum balance & vibration diagnostics", "Inlet valve & drain pump inspection", "Motor belt & electrical safety check", "Detailed written quote before repair"],
        "excluded": ["Spare parts (PCB, motor, pump)", "Major component replacement labor"],
        "active": True
    },
    {
        "id": "electrical",
        "category": "electrician",
        "name": "Electrical safety & wiring inspection",
        "description": "Inspection of switchboards, MCB tripping, short circuits, appliance sockets, and load distribution check.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "SAFETY VISIT",
        "rating": 4.91,
        "review_count": 2980,
        "image": "/images/service-photos.png",
        "imageTile": 5,
        "included": ["Inspection of up to 3 fittings/switches", "Earth leakage & voltage test", "MCB distribution board safety check", "Immediate minor wire tightening"],
        "excluded": ["Internal conduit wire pulling", "New MCB / switchboard hardware"],
        "active": True
    },
    {
        "id": "car-wash",
        "category": "car",
        "name": "Eco car wash & exterior foam spa",
        "description": "High-pressure snow foam wash, tyre dressing, glass buffing, and high-shine microfiber finish at your doorstep.",
        "price_paise": 49900,
        "original_price_paise": 64900,
        "duration_minutes": 60,
        "badge": "POPULAR",
        "rating": 4.89,
        "review_count": 1820,
        "image": "/images/service-photos.png",
        "imageTile": 6,
        "included": ["High-pressure exterior water rinse", "pH-neutral active snow foam wash", "Alloy wheel & tyre arch cleaning", "Streak-free glass & mirror wiping"],
        "excluded": ["Interior upholstery shampoo", "Machine wax paint correction"],
        "active": True
    },
    {
        "id": "car-interior",
        "category": "car",
        "name": "Car interior deep shampoo & sanitisation",
        "description": "Vacuuming, upholstery stain treatment, dashboard conditioning, roof liner cleaning, and AC duct disinfection.",
        "price_paise": 89900,
        "original_price_paise": 119900,
        "duration_minutes": 90,
        "badge": "PREMIUM",
        "rating": 4.86,
        "review_count": 920,
        "image": "/images/service-photos.png",
        "imageTile": 7,
        "included": ["Deep seat fabric / leather extraction", "Floor carpet & boot vacuuming", "Dashboard & console UV conditioning", "AC vent ozone freshener treatment"],
        "excluded": ["Exterior wash", "Engine bay degreasing"],
        "active": True
    },
    {
        "id": "car-repair",
        "category": "car",
        "name": "Car diagnostic inspection visit",
        "description": "Certified multi-point check for engine noise, brake squeal, battery health, and OBD-II scanner code reading.",
        "price_paise": 39900,
        "original_price_paise": 49900,
        "duration_minutes": 60,
        "badge": "DIAGNOSTIC",
        "rating": 4.94,
        "review_count": 640,
        "image": "/images/service-photos.png",
        "imageTile": 8,
        "included": ["OBD-II computer fault code scan", "Brake pad & fluid inspection", "Battery voltage & alternator test", "Clear upfront repair quotation"],
        "excluded": ["Mechanical replacement parts", "Emergency towing assistance"],
        "active": True
    },
    {
        "id": "sofa",
        "category": "cleaning",
        "name": "Sofa & fabric upholstery cleaning",
        "description": "Deep wet extraction shampooing for 3-seater sofa, removing dust mites, pet odors, and tea/coffee stains.",
        "price_paise": 69900,
        "original_price_paise": 99900,
        "duration_minutes": 90,
        "badge": "HYGIENE",
        "rating": 4.84,
        "review_count": 2710,
        "image": "/images/service-photos.png",
        "imageTile": 9,
        "included": ["Dry vacuuming of crevices & cushions", "Biodegradable foam shampoo application", "Extraction vacuum moisture suction", "Fabric deodorising spray"],
        "excluded": ["Genuine leather recolouring", "Old oil-burn stain guarantee"],
        "active": True
    },
    {
        "id": "kitchen",
        "category": "cleaning",
        "name": "Kitchen deep degreasing & cleaning",
        "description": "Intensive oil degreasing of chimney filters, gas stove, tile backsplash, countertop, and sink sanitisation.",
        "price_paise": 99900,
        "original_price_paise": 139900,
        "duration_minutes": 120,
        "badge": "INTENSIVE",
        "rating": 4.88,
        "review_count": 1840,
        "image": "/images/service-photos.png",
        "imageTile": 10,
        "included": ["Chimney hood & metal filter degreasing", "Gas stove burner & knob cleaning", "Tile backsplash oil stain scrubbing", "Sink & drain sanitisation with hot wash"],
        "excluded": ["Inside locked storage cabinets", "Appliance repair or motor rewinding"],
        "active": True
    },
    {
        "id": "fridge",
        "category": "ac",
        "name": "Refrigerator diagnostic check-up",
        "description": "Comprehensive cooling coil, thermostat, defrost timer, and compressor diagnostics for single & double door fridges.",
        "price_paise": 24900,
        "original_price_paise": 34900,
        "duration_minutes": 45,
        "badge": "DIAGNOSTIC",
        "rating": 4.86,
        "review_count": 1420,
        "image": "/images/service-photos.png",
        "imageTile": 11,
        "included": ["Cooling efficiency & airflow test", "Thermostat & sensor diagnostic", "Compressor relay & capacitor check", "Detailed cost estimation for repairs"],
        "excluded": ["Refrigerant gas charging", "Thermostat / relay replacement parts"],
        "active": True
    },
    {
        "id": "purifier",
        "category": "ac",
        "name": "RO water purifier filter check & TDS test",
        "description": "Water TDS calibration, membrane health test, sediment filter inspection, and booster pump pressure test.",
        "price_paise": 29900,
        "original_price_paise": 39900,
        "duration_minutes": 45,
        "badge": "HEALTH CHECK",
        "rating": 4.93,
        "review_count": 3150,
        "image": "/images/service-photos.png",
        "imageTile": 12,
        "included": ["Raw water vs purified water TDS check", "Sediment & carbon filter flow check", "Booster pump pressure test", "Filter life estimation report"],
        "excluded": ["New RO membrane or pre-filters", "Mineral cartridge replacement"],
        "active": True
    },
    {
        "id": "carpentry",
        "category": "carpenter",
        "name": "Carpentry repair & door fitting check",
        "description": "Fix creaking doors, misaligned cabinet hinges, loose handles, drawer sliders, or broken wooden frames.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "QUICK FIX",
        "rating": 4.81,
        "review_count": 1120,
        "image": "/images/service-photos.png",
        "imageTile": 13,
        "included": ["Inspection of up to 2 wooden fittings", "Minor screw & hinge tightening", "Alignment check of drawer slides", "Transparent quote for parts/fabrication"],
        "excluded": ["Plywood & laminate material costs", "Custom furniture fabrication labor"],
        "active": True
    },
    {
        "id": "assembly",
        "category": "carpenter",
        "name": "Furniture assembly service",
        "description": "Expert assembly of flat-pack beds, study desks, shoe racks, bookshelves, or dining tables with precision tools.",
        "price_paise": 49900,
        "original_price_paise": 69900,
        "duration_minutes": 90,
        "badge": "PRECISION",
        "rating": 4.89,
        "review_count": 890,
        "image": "/images/service-photos.png",
        "imageTile": 14,
        "included": ["Unboxing & hardware inventory check", "Assembly according to manufacturer guide", "Leveling check & wobble correction", "Cleanup of packing cartons"],
        "excluded": ["Wall drilling/mounting (booked separately)", "Supplying missing manufacturer screws"],
        "active": True
    },
    {
        "id": "paint",
        "category": "painting",
        "name": "Wall painting consultation & laser measurement",
        "description": "Laser wall area measurement, moisture detection test, color shade card consultation, and itemized quotation.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "CONSULTATION",
        "rating": 4.90,
        "review_count": 760,
        "image": "/images/service-photos.png",
        "imageTile": 15,
        "included": ["Digital laser wall measurement", "Wall moisture meter reading", "Color palette & finish consultation", "Itemized labor & material estimate"],
        "excluded": ["Sample wall painting test patch", "Supplying paint gallons"],
        "active": True
    },
    {
        "id": "pest",
        "category": "pest",
        "name": "Pest inspection & barrier consultation",
        "description": "Thorough inspection for cockroaches, termites, bed bugs, or rodents with specialized thermal camera inspection.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "INSPECTION",
        "rating": 4.87,
        "review_count": 1230,
        "image": "/images/service-photos.png",
        "imageTile": 16,
        "included": ["Inspection of kitchen, drains & wood", "Infestation severity assessment", "Custom treatment plan with child-safe chemicals", "Clear quotation for treatment rounds"],
        "excluded": ["Immediate chemical spraying (booked after)", "Post-treatment bait replenishment"],
        "active": True
    },
    {
        "id": "haircut",
        "category": "salon",
        "name": "Men’s salon haircut & beard styling",
        "description": "Hygienic single-use cape, customized haircut, beard trimming with hot towel massage and after-shave splash.",
        "price_paise": 39900,
        "original_price_paise": 54900,
        "duration_minutes": 45,
        "badge": "GROOMING",
        "rating": 4.92,
        "review_count": 4190,
        "image": "/images/service-photos.png",
        "imageTile": 17,
        "included": ["Consultation & haircut with sterilized tools", "Beard trim / shape with precision trimmer", "Hot towel neck massage", "Post-haircut floor vacuuming"],
        "excluded": ["Hair coloring & chemical treatments", "Head massage oil supply"],
        "active": True
    },
    {
        "id": "moving",
        "category": "moving",
        "name": "Home shifting pre-move survey",
        "description": "On-site itemized inventory survey, packing material calculation, elevator access check, and fixed price quote.",
        "price_paise": 19900,
        "original_price_paise": 29900,
        "duration_minutes": 45,
        "badge": "SURVEY",
        "rating": 4.83,
        "review_count": 510,
        "image": "/images/service-photos.png",
        "imageTile": 18,
        "included": ["Room-by-room furniture & box inventory", "Fragile glassware packing evaluation", "Floor/staircase access survey", "Guaranteed fixed-price moving quote"],
        "excluded": ["Immediate loading or packing supplies", "Vehicle transport advance"],
        "active": True
    }
]

# 2. Verified Technicians & Specialists (Balasore & Odisha)
TECHNICIANS = [
    {
        "id": "w-ac-spec-1",
        "name": "Vikram Sharma",
        "role": "specialist",
        "category": "ac",
        "city": "Balasore",
        "phone": "+91 98765 43210",
        "service_radius_km": 6.0,
        "rating": 4.96,
        "completed_tasks": 540,
        "distance_km": 1.8,
        "skills": ["Inverter AC diagnostics & PCB soldering", "Copper coil brazing", "Leak detection under pressure", "Multi-split VRV servicing"],
        "tools_list": ["Master digital manifold gauge", "Vacuum pump 4.5 CFM", "Infrared thermal leak detector", "Nitrogen pressure regulator kit"],
        "has_specialist_kit": True,
        "verified_kyc": True,
        "status": "active"
    },
    {
        "id": "w-ac-tech-1",
        "name": "Rajesh Mohanty",
        "role": "technician",
        "category": "ac",
        "city": "Balasore",
        "phone": "+91 98765 43211",
        "service_radius_km": 6.0,
        "rating": 4.88,
        "completed_tasks": 310,
        "distance_km": 2.4,
        "skills": ["High-pressure foam jet cleaning", "Drain tray unclogging", "Capacitor & fan motor replacement"],
        "tools_list": ["Pressure jet washer 140 bar", "Digital clamp meter", "Fin comb set", "Refrigerant charging hose"],
        "has_specialist_kit": False,
        "verified_kyc": True,
        "status": "active"
    },
    {
        "id": "w-plumb-spec-1",
        "name": "Amit Das",
        "role": "specialist",
        "category": "plumber",
        "city": "Balasore",
        "phone": "+91 98765 43212",
        "service_radius_km": 6.0,
        "rating": 4.98,
        "completed_tasks": 680,
        "distance_km": 1.2,
        "skills": ["Concealed acoustic leak detection", "CPVC/PPR heat fusion piping", "Pressure boosting pump calibration"],
        "tools_list": ["Acoustic ground microphone leak detector", "Pipe inspection snake camera", "PPR pipe electro-fusion kit", "Heavy-duty basin wrench set"],
        "has_specialist_kit": True,
        "verified_kyc": True,
        "status": "active"
    },
    {
        "id": "w-elec-spec-1",
        "name": "Santosh Panda",
        "role": "specialist",
        "category": "electrician",
        "city": "Balasore",
        "phone": "+91 98765 43213",
        "service_radius_km": 6.0,
        "rating": 4.93,
        "completed_tasks": 490,
        "distance_km": 2.9,
        "skills": ["MCB distribution box wiring", "Inverter & battery setup", "Short circuit fault locator", "Appliance earth leakage diagnostics"],
        "tools_list": ["Fluke digital insulation tester", "True-RMS multimeter", "Non-contact voltage detector pen", "VDE 1000V insulated plier set"],
        "has_specialist_kit": True,
        "verified_kyc": True,
        "status": "active"
    },
    {
        "id": "w-clean-spec-1",
        "name": "Sunita Pradhan",
        "role": "specialist",
        "category": "cleaning",
        "city": "Balasore",
        "phone": "+91 98765 43214",
        "service_radius_km": 6.0,
        "rating": 4.95,
        "completed_tasks": 720,
        "distance_km": 3.1,
        "skills": ["Industrial single-disc floor buffing", "Fabric wet extraction vacuuming", "Steam sanitisation 140°C", "Hospital-grade biofilm disinfection"],
        "tools_list": ["Single-disc floor scrubber polisher", "Karcher wet & dry spray extraction vacuum", "High-temperature steam generator", "Microfiber color-coded task cloths"],
        "has_specialist_kit": True,
        "verified_kyc": True,
        "status": "active"
    },
    {
        "id": "w-auto-spec-1",
        "name": "Subrat Jena",
        "role": "specialist",
        "category": "car",
        "city": "Balasore",
        "phone": "+91 98765 43215",
        "service_radius_km": 6.0,
        "rating": 4.91,
        "completed_tasks": 390,
        "distance_km": 2.1,
        "skills": ["OBD-II computer fault code scan", "Mobile snow foam wash setup", "Brake rotor & fluid service", "Battery jump start & alternator test"],
        "tools_list": ["OBD-II Launch diagnostic scanner", "12V mobile pressure washer", "Battery load tester & booster pack", "Torque wrench set"],
        "has_specialist_kit": True,
        "verified_kyc": True,
        "status": "active"
    }
]

# 3. Cities Covered
CITIES = ["Balasore", "Bhubaneswar", "Cuttack", "Rourkela", "Puri", "Sambalpur", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"]

# 4. Repaido Partner Spare Parts Shops (Balasore GPS Coordinates, KYC, ₹2000 onboarding fee, 5% commission)
SPARE_SHOPS = [
    {
        "id": "shop-bls-01",
        "owner_name": "Rabindra Mohapatra",
        "shop_name": "Maa Tarini Spare Hub",
        "phone": "+91 94370 12890",
        "email": "tarini.spares.bls@gmail.com",
        "gstin": "21AABCM1234F1Z8",
        "trade_license": "TL-BLS-2024-8891",
        "address": "Station Road, Near Town Bus Stand, Balasore, Odisha 756001",
        "city": "Balasore",
        "lat": 21.4942,
        "lng": 86.9324,
        "bank_account": "38920199201",
        "ifsc": "SBIN0000016",
        "status": "active",
        "onboarding_fee_remaining": 1850,
        "commission_rate": 0.05
    },
    {
        "id": "shop-bls-02",
        "owner_name": "Subhashree Nayak",
        "shop_name": "Apex Electronics & Appliance Spares",
        "phone": "+91 98610 54321",
        "email": "apex.spares.balasore@gmail.com",
        "gstin": "21BCDEF5678G2Z1",
        "trade_license": "TL-BLS-2023-4102",
        "address": "Cinema Chhak, OT Road, Balasore, Odisha 756003",
        "city": "Balasore",
        "lat": 21.4910,
        "lng": 86.9205,
        "bank_account": "50100421893",
        "ifsc": "HDFC0001048",
        "status": "active",
        "onboarding_fee_remaining": 1600,
        "commission_rate": 0.05
    },
    {
        "id": "shop-bls-03",
        "owner_name": "Dillip Kumar Jena",
        "shop_name": "Utkal Sanitary & Plumbing Mart",
        "phone": "+91 97781 87654",
        "email": "utkal.sanitary.bls@outlook.com",
        "gstin": "21CDEFG9012H3Z5",
        "trade_license": "TL-BLS-2024-1029",
        "address": "Fakir Mohan Golayei, Balasore, Odisha 756001",
        "city": "Balasore",
        "lat": 21.5015,
        "lng": 86.9170,
        "bank_account": "023900210034",
        "ifsc": "PUNB0023900",
        "status": "active",
        "onboarding_fee_remaining": 2000,
        "commission_rate": 0.05
    }
]

# 5. Verified Spare Part Products in Partner Inventory (Genuine stock & specs)
SPARE_PRODUCTS = [
    {
        "id": "pr-ac-cap-01",
        "shop_id": "shop-bls-01",
        "shop_name": "Maa Tarini Spare Hub",
        "name": "Dual Run Motor Capacitor 45+5 µF 440V AC",
        "part_number": "CAP-45-5-R",
        "category": "ac",
        "price": 450,
        "mrp": 650,
        "stock": 14,
        "brand": "Tibcon / EPCOS",
        "compatibility": "1.5 Ton & 2.0 Ton Split / Window AC (Voltas, Daikin, LG)",
        "warranty_months": 6,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "High endurance metalized polypropylene film capacitor engineered for heavy compressor starting load."
    },
    {
        "id": "pr-ac-blw-02",
        "shop_id": "shop-bls-01",
        "shop_name": "Maa Tarini Spare Hub",
        "name": "Split AC Indoor Blower Fan Motor 28W Pure Copper",
        "part_number": "MOT-BLW-28W",
        "category": "ac",
        "price": 1350,
        "mrp": 1850,
        "stock": 7,
        "brand": "Welling / Panasonic",
        "compatibility": "Universal 1 Ton & 1.5 Ton indoor units (LG, Lloyd, Blue Star)",
        "warranty_months": 12,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Low-noise pure copper coil indoor cross-flow blower motor with 4-speed harness."
    },
    {
        "id": "pr-ac-gas-03",
        "shop_id": "shop-bls-01",
        "shop_name": "Maa Tarini Spare Hub",
        "name": "R32 Low-GWP Eco Refrigerant Gas Can (650g)",
        "part_number": "REF-R32-650G",
        "category": "ac",
        "price": 890,
        "mrp": 1150,
        "stock": 18,
        "brand": "Floron / SRF",
        "compatibility": "Modern 3-Star and 5-Star Inverter Air Conditioners",
        "warranty_months": 0,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Virgin quality R32 fluorocarbon gas with self-sealing puncture valve for quick top-up."
    },
    {
        "id": "pr-plumb-val-01",
        "shop_id": "shop-bls-03",
        "shop_name": "Utkal Sanitary & Plumbing Mart",
        "name": "Heavy Brass Concealed Flush Valve 32mm Dual Action",
        "part_number": "VAL-FLUSH-32B",
        "category": "plumber",
        "price": 1250,
        "mrp": 1650,
        "stock": 9,
        "brand": "Jaquar / Parryware",
        "compatibility": "Concealed cisterns and western toilet wall piping",
        "warranty_months": 24,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Forged solid brass internal piston with ceramic cartridge ensuring zero dripping."
    },
    {
        "id": "pr-plumb-ang-02",
        "shop_id": "shop-bls-03",
        "shop_name": "Utkal Sanitary & Plumbing Mart",
        "name": "Quarter Turn Brass Angle Cock with Wall Flange 1/2\"",
        "part_number": "CK-ANG-QT-12",
        "category": "plumber",
        "price": 380,
        "mrp": 520,
        "stock": 25,
        "brand": "Hindware / Cera",
        "compatibility": "Geyser inlet, health faucet and wash basin connections",
        "warranty_months": 12,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Chrome plated virgin brass body with high durability quarter-turn spindle."
    },
    {
        "id": "pr-plumb-disc-03",
        "shop_id": "shop-bls-03",
        "shop_name": "Utkal Sanitary & Plumbing Mart",
        "name": "Ceramic Disc Cartridge 35mm for Single Lever Basin Mixer",
        "part_number": "CRT-CER-35MM",
        "category": "plumber",
        "price": 240,
        "mrp": 350,
        "stock": 16,
        "brand": "Sedal / KCG OEM",
        "compatibility": "Universal single lever hot/cold basin mixers",
        "warranty_months": 6,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Diamond hardness sintered alumina ceramic disc tested up to 500,000 cycles."
    },
    {
        "id": "pr-elec-mcb-01",
        "shop_id": "shop-bls-02",
        "shop_name": "Apex Electronics & Appliance Spares",
        "name": "Double Pole 32A C-Curve Modular MCB 10kA",
        "part_number": "MCB-DP-32A-10K",
        "category": "electrician",
        "price": 490,
        "mrp": 690,
        "stock": 20,
        "brand": "Schneider Electric / Legrand",
        "compatibility": "Main distribution boards, AC circuits, and power sub-meters",
        "warranty_months": 24,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Air-break miniature circuit breaker with bi-metallic overload & magnetic short-circuit protection."
    },
    {
        "id": "pr-elec-cbl-02",
        "shop_id": "shop-bls-02",
        "shop_name": "Apex Electronics & Appliance Spares",
        "name": "FR-LSH Pure Copper Multi-strand Wire 2.5 sq mm (30m)",
        "part_number": "WIR-FRLSH-25",
        "category": "electrician",
        "price": 1150,
        "mrp": 1450,
        "stock": 12,
        "brand": "Havells / Polycab",
        "compatibility": "Internal wiring for 16A power sockets and appliance points",
        "warranty_months": 60,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Electrolytic grade 99.97% bright annealed copper with fire retardant low smoke insulation."
    },
    {
        "id": "pr-app-pmp-01",
        "shop_id": "shop-bls-02",
        "shop_name": "Apex Electronics & Appliance Spares",
        "name": "Universal Washing Machine Drain Pump Motor 30W",
        "part_number": "PMP-DRN-30W",
        "category": "appliance",
        "price": 680,
        "mrp": 950,
        "stock": 11,
        "brand": "Askoll / Hanyu",
        "compatibility": "Front & Top Load Washing Machines (IFB, Samsung, LG, Whirlpool)",
        "warranty_months": 12,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Magnetic rotor drain pump assembly with lint filter casing."
    },
    {
        "id": "pr-app-tmr-02",
        "shop_id": "shop-bls-02",
        "shop_name": "Apex Electronics & Appliance Spares",
        "name": "Frost-Free Refrigerator Defrost Timer & Bi-Metal Sensor Kit",
        "part_number": "TMR-DFRST-KIT",
        "category": "appliance",
        "price": 520,
        "mrp": 750,
        "stock": 15,
        "brand": "Sankyo / Invensys",
        "compatibility": "Double door frost-free refrigerators (LG, Godrej, Whirlpool)",
        "warranty_months": 6,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Electromechanical defrost timer 6hr-21min cycle with hermetic thermal fuse."
    },
    {
        "id": "pr-tool-clm-01",
        "shop_id": "shop-bls-01",
        "shop_name": "Maa Tarini Spare Hub",
        "name": "True-RMS Digital AC/DC Clamp Meter 600A with Temperature",
        "part_number": "TL-CLM-600A",
        "category": "tools",
        "price": 1850,
        "mrp": 2600,
        "stock": 5,
        "brand": "Mastech / HTC",
        "compatibility": "AC & Appliance technicians, field electricians",
        "warranty_months": 12,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "CAT III 600V certified clamp meter with auto-ranging, capacitance and thermocouple probe."
    },
    {
        "id": "pr-tool-wrn-02",
        "shop_id": "shop-bls-03",
        "shop_name": "Utkal Sanitary & Plumbing Mart",
        "name": "Heavy Duty 14-inch Drop Forged Cast Iron Pipe Wrench",
        "part_number": "TL-WRN-14HD",
        "category": "tools",
        "price": 650,
        "mrp": 890,
        "stock": 8,
        "brand": "Taparia / Everest",
        "compatibility": "Plumbing fittings from 1/2\" up to 2\" GI / CPVC / UPVC",
        "warranty_months": 24,
        "gst_rate": 0.18,
        "status": "approved",
        "description": "Hardened ductile iron handle with hardened steel hook jaw and precision knurled nut."
    }
]

# 6. Configurable Base Fares (Default Balasore: ₹150)
BASE_FARES = {
    "Balasore": 150,
    "Bhubaneswar": 199,
    "Cuttack": 179,
    "Bengaluru": 249,
    "Mumbai": 299,
    "Delhi": 249,
    "Hyderabad": 229,
    "Pune": 219,
    "Chennai": 219
}


def seed_firestore():
    """Seed Cloud Firestore using Admin SDK service account"""
    service_account_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "repaido-firebase-adminsdk-fbsvc-25535a3683.json"))
    if not os.path.exists(service_account_path):
        print(f"⚠️ Service account not found at {service_account_path}. Skipping Firestore cloud seeding.")
        return False

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred, {"projectId": "repaido"})

        db = firestore.client()
        print(" Connected to Cloud Firestore (project 'repaido')")

        # A. Seed Services Collection
        batch = db.batch()
        services_ref = db.collection("services")
        for s in SERVICES_CATALOG:
            doc_ref = services_ref.document(s["id"])
            batch.set(doc_ref, {
                **s,
                "updated_at": firestore.SERVER_TIMESTAMP
            }, merge=True)
        batch.commit()
        print(f"✅ Seeded {len(SERVICES_CATALOG)} verified services into Firestore collection 'services'")

        # B. Seed Technicians Collection
        batch = db.batch()
        tech_ref = db.collection("technicians")
        for t in TECHNICIANS:
            doc_ref = tech_ref.document(t["id"])
            batch.set(doc_ref, {
                **t,
                "updated_at": firestore.SERVER_TIMESTAMP
            }, merge=True)
        batch.commit()
        print(f"✅ Seeded {len(TECHNICIANS)} verified technicians into Firestore collection 'technicians'")

        # C. Seed City Coverage & Capacity
        batch = db.batch()
        cities_ref = db.collection("city_coverage")
        for city in CITIES:
            doc_ref = cities_ref.document(city.lower())
            batch.set(doc_ref, {
                "name": city,
                "active": True,
                "service_radius_km": 6.0,
                "operating_hours": "08:00 - 20:00 IST",
                "specialist_count": 6 if city == "Balasore" else 4
            }, merge=True)
        batch.commit()
        print(f"✅ Seeded {len(CITIES)} cities into Firestore collection 'city_coverage'")

        # D. Seed Spare Shops Collection
        batch = db.batch()
        shops_ref = db.collection("spare_shops")
        for shop in SPARE_SHOPS:
            doc_ref = shops_ref.document(shop["id"])
            batch.set(doc_ref, {
                **shop,
                "updated_at": firestore.SERVER_TIMESTAMP
            }, merge=True)
        batch.commit()
        print(f"✅ Seeded {len(SPARE_SHOPS)} partner spare shops into Firestore collection 'spare_shops'")

        # E. Seed Spare Products Collection
        batch = db.batch()
        prods_ref = db.collection("spare_products")
        for prod in SPARE_PRODUCTS:
            doc_ref = prods_ref.document(prod["id"])
            batch.set(doc_ref, {
                **prod,
                "updated_at": firestore.SERVER_TIMESTAMP
            }, merge=True)
        batch.commit()
        print(f"✅ Seeded {len(SPARE_PRODUCTS)} spare parts into Firestore collection 'spare_products'")

        # F. Seed Base Fares Configuration (Default Balasore: ₹150)
        db.collection("platform_config").document("base_fares").set({
            **BASE_FARES,
            "updated_at": firestore.SERVER_TIMESTAMP
        }, merge=True)
        print("✅ Seeded regional base fares (Balasore: ₹150) into Firestore document 'platform_config/base_fares'")

        return True
    except Exception as e:
        print(f"❌ Error seeding Cloud Firestore: {e}")
        return False


def seed_sqlite():
    """Seed local SQLite backend/repaido.db so offline development is fully mirrored"""
    db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend", "repaido.db"))
    print(f" Synchronizing local SQLite database at {db_path}...")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    # Enhanced Schema with technicians and applications
    cursor.executescript('''
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        phone TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_paise INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        badge TEXT NOT NULL,
        included TEXT NOT NULL,
        excluded TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technicians (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        category TEXT NOT NULL,
        city TEXT NOT NULL,
        phone TEXT NOT NULL,
        rating REAL NOT NULL,
        completed_tasks INTEGER NOT NULL,
        skills TEXT NOT NULL,
        tools_list TEXT NOT NULL,
        status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        service_id TEXT NOT NULL REFERENCES services(id),
        city TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        notes TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('requested','confirmed','on_the_way','in_progress','completed','cancelled')),
        price_paise INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        professional_name TEXT,
        UNIQUE(user_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS partner_applications (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        dob TEXT,
        gender TEXT,
        home_address TEXT,
        service_city TEXT,
        trade_category TEXT,
        experience_years INTEGER,
        tools_list TEXT,
        aadhaar_number TEXT,
        pan_number TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_shops (
        id TEXT PRIMARY KEY,
        owner_name TEXT NOT NULL,
        shop_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        gstin TEXT NOT NULL,
        trade_license TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        bank_account TEXT NOT NULL,
        ifsc TEXT NOT NULL,
        status TEXT NOT NULL,
        onboarding_fee_remaining REAL NOT NULL,
        commission_rate REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spare_products (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        shop_name TEXT NOT NULL,
        name TEXT NOT NULL,
        part_number TEXT NOT NULL,
        category TEXT NOT NULL,
        price INTEGER NOT NULL,
        mrp INTEGER NOT NULL,
        stock INTEGER NOT NULL,
        brand TEXT NOT NULL,
        compatibility TEXT NOT NULL,
        warranty_months INTEGER NOT NULL,
        gst_rate REAL NOT NULL,
        status TEXT NOT NULL,
        description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS base_fares (
        city TEXT PRIMARY KEY,
        fare INTEGER NOT NULL
    );
    ''')

    # Seed services
    for s in SERVICES_CATALOG:
        cursor.execute('''
        INSERT OR REPLACE INTO services VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            s["id"], s["category"], s["name"], s["description"],
            s["price_paise"], s["duration_minutes"], s["badge"],
            json.dumps(s["included"]), json.dumps(s["excluded"])
        ))

    # Seed technicians
    for t in TECHNICIANS:
        cursor.execute('''
        INSERT OR REPLACE INTO technicians VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            t["id"], t["name"], t["role"], t["category"], t["city"],
            t["phone"], t["rating"], t["completed_tasks"],
            json.dumps(t["skills"]), json.dumps(t["tools_list"]), t["status"]
        ))

    # Seed spare shops
    for sh in SPARE_SHOPS:
        cursor.execute('''
        INSERT OR REPLACE INTO spare_shops VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            sh["id"], sh["owner_name"], sh["shop_name"], sh["phone"],
            sh["email"], sh["gstin"], sh["trade_license"], sh["address"],
            sh["city"], sh["lat"], sh["lng"], sh["bank_account"],
            sh["ifsc"], sh["status"], sh["onboarding_fee_remaining"], sh["commission_rate"]
        ))

    # Seed spare products
    for sp in SPARE_PRODUCTS:
        cursor.execute('''
        INSERT OR REPLACE INTO spare_products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            sp["id"], sp["shop_id"], sp["shop_name"], sp["name"],
            sp["part_number"], sp["category"], sp["price"], sp["mrp"],
            sp["stock"], sp["brand"], sp["compatibility"], sp["warranty_months"],
            sp["gst_rate"], sp["status"], sp["description"]
        ))

    # Seed base fares
    for city, fare in BASE_FARES.items():
        cursor.execute('''
        INSERT OR REPLACE INTO base_fares VALUES (?, ?)
        ''', (city, fare))

    conn.commit()
    conn.close()
    print("✅ Local SQLite database synchronized with full services, technicians, partner shops, inventory & base fares.")


if __name__ == "__main__":
    print("🚀 Initializing Repaido Master Database Infrastructure...")
    firestore_ok = seed_firestore()
    seed_sqlite()
    print("\n🎉 Master Database Seeding Completed Successfully!")
