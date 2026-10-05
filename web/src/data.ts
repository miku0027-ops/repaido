import type { CategoryId, Service, WorkerProfile, CandidateMatch, BookingRecord, SpareShop, SparePartProduct } from './types';

export const categories: {id: CategoryId; name: string; iconName?: string}[] = [
  {id:'all',name:'All Services'},
  {id:'cleaning',name:'Home Cleaning'},
  {id:'ac',name:'AC & Appliances'},
  {id:'plumber',name:'Plumbing'},
  {id:'electrician',name:'Electrical'},
  {id:'car',name:'Car Wash & Repair'},
  {id:'carpenter',name:'Carpentry'},
  {id:'painting',name:'Painting'},
  {id:'salon',name:'Salon & Spa'},
  {id:'pest',name:'Pest Control'},
  {id:'moving',name:'Moving Help'},
];

export const cities = ['Balasore', 'Bhadrak', 'Jajpur', 'Bhubaneswar', 'Cuttack', 'Puri', 'Berhampur', 'Rourkela', 'Sambalpur', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai'];

export const images: Record<string, {image:string;imageAlt:string}> = {
  cleaning:{image:'/images/cleaning.jpg',imageAlt:'Cleaning supplies arranged on a bright surface'},
  ac:{image:'/images/ac.jpg',imageAlt:'A bright interior with a wall-mounted air conditioner'},
  plumber:{image:'/images/bathroom.jpg',imageAlt:'Modern bathroom fixtures and basin'},
};

const serviceRecords: (Service & { originalPrice?: number; rating?: number; reviewCount?: number })[] = [
  {id:'home-clean',category:'cleaning',name:'Home deep cleaning',description:'Comprehensive deep cleaning for kitchen, bathrooms, floors and living spaces with hospital-grade sanitisation.',price:299900,originalPrice:399900,rating:4.88,reviewCount:1240,duration:240,...images.cleaning,included:['Kitchen & bathroom scrubbing','Deep machine floor buffing','Surfaces, glass and balcony wash','Hospital-grade disinfectant spray'],excluded:['Exterior high-rise windows','Moving solid teak/heavy furniture']},
  {id:'ac-service',category:'ac',name:'AC power service & filter jet clean',description:'Deep coil foam jet clean, water drainage unclog, gas level check and 15-point cooling efficiency diagnostics.',price:59900,originalPrice:79900,rating:4.92,reviewCount:3850,duration:60,...images.ac,included:['Indoor coil high-pressure foam wash','Filter & blower wheel deep clean','Drain tray & pipe blockage unclogging','Cooling gas pressure & electrical check'],excluded:['Gas leak welding & refill','Compressor spare parts replacement']},
  {id:'plumbing',category:'plumber',name:'Plumbing repair & leak inspection',description:'Expert diagnosis of hidden pipe leaks, low water pressure, blocked drains or faucet repair with laser precision.',price:19900,originalPrice:29900,rating:4.85,reviewCount:2140,duration:45,...images.plumber,included:['Diagnostic check of reported issue','Pressure test on faucets & angle valves','Minor washer / thread tape fix','Transparent parts quote before work'],excluded:['Piping replacement materials','Concealed wall breakage without approval']},
  {id:'bathroom',category:'cleaning',name:'Bathroom deep cleaning & de-scaling',description:'Removal of stubborn hard-water stains, tile grout whitening, tap descaling and toilet disinfection.',price:49900,originalPrice:69900,rating:4.87,reviewCount:4320,duration:60,...images.plumber,included:['Tile scrubbing & hard-water stain removal','Chrome fittings descaling & mirror polish','Toilet pot & basin deep sanitisation','Floor grout scrubbing with safe chemicals'],excluded:['Ceiling repainting','Exhaust fan rewiring']},
  {id:'washing-machine',category:'ac',name:'Washing machine check-up & service',description:'Complete drum diagnostics, vibration check, inlet filter cleaning, and error code troubleshooting.',price:24900,originalPrice:34900,rating:4.82,reviewCount:1650,duration:45,image:'/images/washer.jpg',imageAlt:'Front-load washing machine',included:['Drum balance & vibration diagnostics','Inlet valve & drain pump inspection','Motor belt & electrical safety check','Detailed written quote before repair'],excluded:['Spare parts (PCB, motor, pump)','Major component replacement labor']},
  {id:'electrical',category:'electrician',name:'Electrical safety & wiring inspection',description:'Inspection of switchboards, MCB tripping, short circuits, appliance sockets, and load distribution check.',price:19900,originalPrice:29900,rating:4.91,reviewCount:2980,duration:45,image:'/images/electrical.jpg',imageAlt:'An electrical switchboard with visible wiring',included:['Inspection of up to 3 fittings/switches','Earth leakage & voltage test','MCB distribution board safety check','Immediate minor wire tightening'],excluded:['Internal conduit wire pulling','New MCB / switchboard hardware']},
  {id:'car-wash',category:'car',name:'Eco car wash & exterior foam spa',description:'High-pressure snow foam wash, tyre dressing, glass buffing, and high-shine microfiber finish at your doorstep.',price:49900,originalPrice:64900,rating:4.89,reviewCount:1820,duration:60,image:'/images/auto-singar-car-wash.png',imageAlt:'Illustration of car washing',included:['High-pressure exterior water rinse','pH-neutral active snow foam wash','Alloy wheel & tyre arch cleaning','Streak-free glass & mirror wiping'],excluded:['Interior upholstery shampoo','Machine wax paint correction']},
  {id:'car-interior',category:'car',name:'Car interior deep shampoo & sanitisation',description:'Vacuuming, upholstery stain treatment, dashboard conditioning, roof liner cleaning, and AC duct disinfection.',price:89900,originalPrice:119900,rating:4.86,reviewCount:920,duration:90,image:'/images/auto-singar-car-wash.png',imageAlt:'Illustration of car washing',included:['Deep seat fabric / leather extraction','Floor carpet & boot vacuuming','Dashboard & console UV conditioning','AC vent ozone freshener treatment'],excluded:['Exterior wash','Engine bay degreasing']},
  {id:'car-repair',category:'car',name:'Car diagnostic inspection visit',description:'Certified multi-point check for engine noise, brake squeal, battery health, and OBD-II scanner code reading.',price:39900,originalPrice:49900,rating:4.94,reviewCount:640,duration:60,image:'/images/car-repair.svg',imageAlt:'',included:['OBD-II computer fault code scan','Brake pad & fluid inspection','Battery voltage & alternator test','Clear upfront repair quotation'],excluded:['Mechanical replacement parts','Emergency towing assistance']},
  {id:'sofa',category:'cleaning',name:'Sofa & fabric upholstery cleaning',description:'Deep wet extraction shampooing for 3-seater sofa, removing dust mites, pet odors, and tea/coffee stains.',price:69900,originalPrice:99900,rating:4.84,reviewCount:2710,duration:90,image:'/images/cleaning.jpg',imageAlt:'Cleaning supplies',included:['Dry vacuuming of crevices & cushions','Biodegradable foam shampoo application','Extraction vacuum moisture suction','Fabric deodorising spray'],excluded:['Genuine leather recolouring','Old oil-burn stain guarantee']},
  {id:'kitchen',category:'cleaning',name:'Kitchen deep degreasing & cleaning',description:'Intensive oil degreasing of chimney filters, gas stove, tile backsplash, countertop, and sink sanitisation.',price:99900,originalPrice:139900,rating:4.88,reviewCount:1840,duration:120,image:'/images/cleaning.jpg',imageAlt:'Cleaning supplies',included:['Chimney hood & metal filter degreasing','Gas stove burner & knob cleaning','Tile backsplash oil stain scrubbing','Sink & drain sanitisation with hot wash'],excluded:['Inside locked storage cabinets','Appliance repair or motor rewinding']},
  {id:'fridge',category:'ac',name:'Refrigerator diagnostic check-up',description:'Comprehensive cooling coil, thermostat, defrost timer, and compressor diagnostics for single & double door fridges.',price:24900,originalPrice:34900,rating:4.86,reviewCount:1420,duration:45,image:'/images/appliance.svg',imageAlt:'',included:['Cooling efficiency & airflow test','Thermostat & sensor diagnostic','Compressor relay & capacitor check','Detailed cost estimation for repairs'],excluded:['Refrigerant gas charging','Thermostat / relay replacement parts']},
  {id:'purifier',category:'ac',name:'RO water purifier filter check & TDS test',description:'Water TDS calibration, membrane health test, sediment filter inspection, and booster pump pressure test.',price:29900,originalPrice:39900,rating:4.93,reviewCount:3150,duration:45,image:'/images/appliance.svg',imageAlt:'',included:['Raw water vs purified water TDS check','Sediment & carbon filter flow check','Booster pump pressure test','Filter life estimation report'],excluded:['New RO membrane or pre-filters','Mineral cartridge replacement']},
  {id:'carpentry',category:'carpenter',name:'Carpentry repair & door fitting check',description:'Fix creaking doors, misaligned cabinet hinges, loose handles, drawer sliders, or broken wooden frames.',price:19900,originalPrice:29900,rating:4.81,reviewCount:1120,duration:45,image:'/images/carpenter.svg',imageAlt:'',included:['Inspection of up to 2 wooden fittings','Minor screw & hinge tightening','Alignment check of drawer slides','Transparent quote for parts/fabrication'],excluded:['Plywood & laminate material costs','Custom furniture fabrication labor']},
  {id:'assembly',category:'carpenter',name:'Furniture assembly service',description:'Expert assembly of flat-pack beds, study desks, shoe racks, bookshelves, or dining tables with precision tools.',price:49900,originalPrice:69900,rating:4.89,reviewCount:890,duration:90,image:'/images/carpenter.svg',imageAlt:'',included:['Unboxing & hardware inventory check','Assembly according to manufacturer guide','Leveling check & wobble correction','Cleanup of packing cartons'],excluded:['Wall drilling/mounting (booked separately)','Supplying missing manufacturer screws']},
  {id:'paint',category:'painting',name:'Wall painting consultation & laser measurement',description:'Laser wall area measurement, moisture detection test, color shade card consultation, and itemized quotation.',price:19900,originalPrice:29900,rating:4.90,reviewCount:760,duration:45,image:'/images/painting.svg',imageAlt:'',included:['Digital laser wall measurement','Wall moisture meter reading','Color palette & finish consultation','Itemized labor & material estimate'],excluded:['Sample wall painting test patch','Supplying paint gallons']},
  {id:'pest',category:'pest',name:'Pest inspection & barrier consultation',description:'Thorough inspection for cockroaches, termites, bed bugs, or rodents with specialized thermal camera inspection.',price:19900,originalPrice:29900,rating:4.87,reviewCount:1230,duration:45,image:'/images/pest.svg',imageAlt:'',included:['Inspection of kitchen, drains & wood','Infestation severity assessment','Custom treatment plan with child-safe chemicals','Clear quotation for treatment rounds'],excluded:['Immediate chemical spraying (booked after)','Post-treatment bait replenishment']},
  {id:'haircut',category:'salon',name:'Men’s salon haircut & beard styling',description:'Hygienic single-use cape, customized haircut, beard trimming with hot towel massage and after-shave splash.',price:39900,originalPrice:54900,rating:4.92,reviewCount:4190,duration:45,image:'/images/salon.svg',imageAlt:'',included:['Consultation & haircut with sterilized tools','Beard trim / shape with precision trimmer','Hot towel neck massage','Post-haircut floor vacuuming'],excluded:['Hair coloring & chemical treatments','Head massage oil supply']},
  {id:'moving',category:'moving',name:'Home shifting pre-move survey',description:'On-site itemized inventory survey, packing material calculation, elevator access check, and fixed price quote.',price:19900,originalPrice:29900,rating:4.83,reviewCount:510,duration:45,image:'/images/moving.svg',imageAlt:'',included:['Room-by-room furniture & box inventory','Fragile glassware packing evaluation','Floor/staircase access survey','Guaranteed fixed-price moving quote'],excluded:['Immediate loading or packing supplies','Vehicle transport advance']}
];

const servicePhotoMap: Record<string, {imageTile:number; imageAlt:string}> = {
  "home-clean": {imageTile: 0, imageAlt: "Cleaner mopping a spotless floor"},
  "ac-service": {imageTile: 1, imageAlt: "Technician cleaning indoor AC cooling coils with high pressure foam"},
  "plumbing": {imageTile: 2, imageAlt: "Plumber checking drain pipes beneath a sink with inspection lamp"},
  "bathroom": {imageTile: 3, imageAlt: "Gloved worker deep cleaning sparkling bathroom tiles"},
  "washing-machine": {imageTile: 4, imageAlt: "Technician inspecting washing machine drum"},
  "electrical": {imageTile: 5, imageAlt: "Certified electrician testing voltage on switchboard with digital multimeter"},
  "car-wash": {imageTile: 6, imageAlt: "Washing compact car with thick active snow foam"},
  "car-interior": {imageTile: 7, imageAlt: "Vacuuming car upholstery and leather seats"},
  "car-repair": {imageTile: 8, imageAlt: "Mechanic running diagnostic check on car engine"},
  "sofa": {imageTile: 9, imageAlt: "Upholstery extraction cleaner on fabric sofa"},
  "kitchen": {imageTile: 10, imageAlt: "Degreasing stainless steel chimney filters and kitchen counter"},
  "fridge": {imageTile: 11, imageAlt: "Technician inspecting refrigerator compressor coils"},
  "purifier": {imageTile: 12, imageAlt: "Testing TDS level on water purifier"},
  "carpentry": {imageTile: 13, imageAlt: "Carpenter aligning cabinet hinges with spirit level"},
  "assembly": {imageTile: 14, imageAlt: "Worker assembling table flat-pack using electric driver"},
  "paint": {imageTile: 15, imageAlt: "Laser measurement tool checking wall surface before painting"},
  "pest": {imageTile: 16, imageAlt: "Pest inspector examining corners with thermal camera"},
  "haircut": {imageTile: 17, imageAlt: "Hairdresser styling hair with sterilized scissors"},
  "moving": {imageTile: 18, imageAlt: "Surveyor cataloging home items for shifting"}
};

export const seededServices: Service[] = serviceRecords.map(service => ({
  ...service,
  rating: undefined,
  reviewCount: undefined,
  originalPrice: undefined,
  image: "/images/service-photos.png",
  ...servicePhotoMap[service.id]
}));

// Verified Category Specialists (Including Basanti Behera - Cleaning Specialist, 15 yrs exp, highest demand)
export const seededWorkers: WorkerProfile[] = [
  {
    id: 'vWj9H9bPdGQGKVsbHCjKjVH7Krz1',
    name: 'Basanti Behera',
    role: 'specialist',
    category: 'cleaning',
    avatar: 'BB',
    profileImage: '/images/specialists/basanti_behera.jpg',
    level: 3,
    points: 2450,
    maxLevelPoints: 3000,
    taskScore: 4.92,
    completedTasks: 356,
    reviewCount: 168,
    distanceKm: 1.6,
    bestSkill: 'Home Full Deep Cleaning & Degreasing',
    specializedSkills: [
      'Home full cleaning',
      'Full bathroom cleaning & de-scaling',
      'Kitchen deep degreasing & chimney clean',
      'Sofa & upholstery wet extraction',
      'Balcony & terrace sanitisation'
    ],
    toolsEquipped: 'Industrial floor scrubber, Karcher wet/dry vacuum & 140°C steam kit',
    toolsList: [
      'Single-disc floor scrubber polisher',
      'Karcher wet & dry spray extraction vacuum',
      'Steam generator 140°C',
      'Bio-degreaser solution kit',
      'Microfiber task cloths'
    ],
    hasSpecialistKit: true,
    yearsExperience: 15,
    city: 'Balasore',
    phone: '+91 91781 67618',
    verifiedKyc: true,
    pricingModel: 'hourly',
    baseFare: 150,
    hourlyRate: 349,
    fixedPrice: 699,
    demandTier: 'highest_demand',
    demandBadge: '🔥 Highest Demand',
    bio: '15 years of master expertise in residential full-home deep cleaning, sanitized kitchen degreasing, bathroom de-scaling and eco-friendly sofa/floor care. Repaido verified top category specialist.'
  },
  {
    id: 'Xk2IdJLOdaV5bYalHSnMNYPeYWV2',
    name: 'Tushar Ranjan Das',
    role: 'specialist',
    category: 'electrician',
    avatar: 'TD',
    profileImage: '/images/specialists/tushar_das.jpg',
    level: 3,
    points: 2600,
    maxLevelPoints: 3000,
    taskScore: 4.94,
    completedTasks: 480,
    reviewCount: 142,
    distanceKm: 1.8,
    bestSkill: 'Full Electrical Wiring & MCB Distribution',
    specializedSkills: [
      'Full wiring',
      'Short circuit repair',
      'Load management',
      'Inverter repair',
      'Battery change',
      '3-phase wiring'
    ],
    toolsEquipped: 'True-RMS multimeter, digital insulation tester & VDE insulated kit',
    toolsList: [
      'True-RMS multimeter',
      'Digital insulation tester',
      'Non-contact voltage detector pen',
      'VDE 1000V plier set',
      'Hammer & drill machine'
    ],
    hasSpecialistKit: true,
    yearsExperience: 8,
    city: 'Balasore',
    phone: '+91 97785 61010',
    verifiedKyc: true,
    pricingModel: 'hourly',
    baseFare: 150,
    hourlyRate: 399,
    fixedPrice: 599,
    demandTier: 'high_demand',
    demandBadge: '⚡ Top Electrician Specialist',
    bio: '8 years of certified contractor expertise in residential and commercial wiring, short circuit diagnostics, load management, and inverter/battery systems.'
  },
  {
    id: 'O2Q2EunphDbsxMepiCq5DkrlsaE2',
    name: 'Sipun Mahanta',
    role: 'technician',
    category: 'electrician',
    avatar: 'SM',
    profileImage: '/images/specialists/sipun_mahanta.jpg',
    level: 2,
    points: 1850,
    maxLevelPoints: 2000,
    taskScore: 4.89,
    completedTasks: 310,
    reviewCount: 96,
    distanceKm: 2.4,
    bestSkill: 'Switchboard Fitting & Leakage Repair',
    specializedSkills: [
      'Wiring',
      'Leakage',
      'Meterbox fitting',
      'Switch board fitting',
      'Fan change'
    ],
    toolsEquipped: 'Tester, plash, wrench, drill machine, soldering iron',
    toolsList: [
      'Screw driver set',
      'Tester',
      'Plash & wrench',
      'Drill machine',
      'Soldering iron',
      'Wiring cable'
    ],
    hasSpecialistKit: false,
    yearsExperience: 5,
    city: 'Balasore',
    phone: '+91 77353 89840',
    verifiedKyc: true,
    pricingModel: 'hourly',
    baseFare: 120,
    hourlyRate: 299,
    fixedPrice: 449,
    demandTier: 'high_demand',
    demandBadge: '🔧 Certified Technician',
    bio: '5 years practical experience in residential wiring, meterbox fitting, switchboard repair, and ceiling fan maintenance in Balasore.'
  },
  {
    id: 'TtNofqrBvoPv82wF9a4jkag5jem2',
    name: 'Paramesh Prasad Mohapatra',
    role: 'specialist',
    category: 'pest',
    avatar: 'PM',
    profileImage: '/images/specialists/paramesh_mohapatra.jpg',
    level: 3,
    points: 2400,
    maxLevelPoints: 3000,
    taskScore: 4.92,
    completedTasks: 390,
    reviewCount: 118,
    distanceKm: 1.5,
    bestSkill: 'Odorless Herbal Pest Control & Anti-Termite Protection',
    specializedSkills: [
      'Odorless herbal pest spray',
      'Anti-termite wood treatment',
      'Cockroach gel baiting',
      'Drain barrier sanitisation'
    ],
    toolsEquipped: 'ULV cold fogger, high-pressure sprayer & pest gel applicator',
    toolsList: [
      'ULV cold fogger',
      'High-pressure compression sprayer',
      'Gel applicator gun',
      'Safety net & respirator mask'
    ],
    hasSpecialistKit: true,
    yearsExperience: 6,
    city: 'Balasore',
    phone: '+91 78381 89053',
    verifiedKyc: true,
    pricingModel: 'hourly',
    baseFare: 150,
    hourlyRate: 349,
    fixedPrice: 699,
    demandTier: 'high_demand',
    demandBadge: '🛡️ Top Pest Specialist',
    bio: '6 years specialized experience in government-approved odorless pest extermination, termite drill barrier treatment, and safe domestic disinfection.'
  }
];

// Seeded Bookings for the Rich Bookings Page
export const seededBookings: BookingRecord[] = [];

// Candidate Discovery & Search Engine
export function findBestCandidates(query: string, category?: CategoryId, _city?: string): CandidateMatch[] {
  const cleanQ = query.trim().toLowerCase();
  
  return seededWorkers
    .filter(w => {
      // Must be within 6 km coverage
      if (w.distanceKm > 6.0) return false;
      // Filter by category if explicit
      if (category && category !== 'all' && w.category !== category) return false;
      // Filter by query if provided
      if (cleanQ) {
        const text = `${w.name} ${w.category} ${w.bestSkill} ${w.specializedSkills.join(' ')} ${w.role} ${w.toolsEquipped}`.toLowerCase();
        // Look for partial matches
        const words = cleanQ.split(/\s+/).filter(Boolean);
        const hasMatch = words.some(word => text.includes(word)) || (category && w.category === category);
        if (!hasMatch && !text.includes(cleanQ)) return false;
      }
      return true;
    })
    .map(worker => {
      let score = 80;
      const reasons: string[] = [];

      // Distance factor (closer is higher)
      if (worker.distanceKm <= 2.0) {
        score += 10;
        reasons.push(`Closest professional: only ${worker.distanceKm} km away`);
      } else if (worker.distanceKm <= 4.0) {
        score += 6;
        reasons.push(`${worker.distanceKm} km away (under 6 km service radius)`);
      } else {
        score += 3;
        reasons.push(`Within coverage boundary (${worker.distanceKm} km)`);
      }

      // Rating & Experience
      if (worker.taskScore >= 4.9) {
        score += 6;
        reasons.push(`Exceptional ${worker.taskScore} ★ customer rating (${worker.completedTasks} tasks)`);
      } else {
        score += 3;
        reasons.push(`High reliability rating: ${worker.taskScore} ★`);
      }

      // Role & Tools Match
      if (worker.role === 'specialist') {
        score += 4;
        reasons.push(`Senior Specialist: equipped with Repaido Pro Specialist Kit`);
      } else {
        score += 2;
        reasons.push(`Level ${worker.level} Technician: fast response for standard repairs`);
      }

      // Direct skill keyword match
      if (cleanQ && (worker.bestSkill.toLowerCase().includes(cleanQ) || worker.specializedSkills.some(s => s.toLowerCase().includes(cleanQ)))) {
        score += 5;
        reasons.push(`Specialized match for "${cleanQ}": ${worker.bestSkill}`);
      }

      const matchScore = Math.min(99, Math.max(75, score));
      return {
        worker,
        matchScore,
        matchReasons: reasons,
        recommendedRole: worker.role
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore || a.worker.distanceKm - b.worker.distanceKm);
}

// Points & Leveling progression helper for technicians & specialists
// Rule: strictly 1,500 points OR 20 tasks completion (any one first to gain the badge of specialist)
export function getTechnicianProgress(points: number, completedTasks: number = 0) {
  const specialistPointsThreshold = 1500;
  const specialistTasksThreshold = 20;

  const pointsProgress = Math.min(100, Math.round((points / specialistPointsThreshold) * 100));
  const tasksProgress = Math.min(100, Math.round((completedTasks / specialistTasksThreshold) * 100));
  const progressPercent = Math.max(pointsProgress, tasksProgress);

  const isSpecialistEligible = points >= specialistPointsThreshold || completedTasks >= specialistTasksThreshold;

  let currentLevel = 1;
  if (isSpecialistEligible) currentLevel = 5;
  else if (points >= 1100 || completedTasks >= 15) currentLevel = 4;
  else if (points >= 700 || completedTasks >= 10) currentLevel = 3;
  else if (points >= 300 || completedTasks >= 5) currentLevel = 2;

  const remainingPoints = Math.max(0, specialistPointsThreshold - points);
  const remainingTasks = Math.max(0, specialistTasksThreshold - completedTasks);

  return {
    currentLevel,
    specialistThreshold: specialistPointsThreshold,
    specialistPointsThreshold,
    specialistTasksThreshold,
    currentPoints: points,
    completedTasks,
    remainingPoints,
    remainingTasks,
    remainingToSpecialist: remainingPoints,
    progressPercent,
    isSpecialistEligible,
    badgeTitle: isSpecialistEligible ? 'Repaido Master Specialist' : 'Repaido Certified Technician',
    unlockedKit: isSpecialistEligible ? 'Repaido Pro Specialist Kit' : 'Standard Essential Toolkit'
  };
}

export const getCandidateMatches = findBestCandidates;

// Configurable Base Fares per region (Default Balasore: ₹150)
export const defaultCityBaseFares: Record<string, number> = {
  Balasore: 150,
  Bhubaneswar: 199,
  Cuttack: 179,
  Bengaluru: 249,
  Mumbai: 299,
  Delhi: 249,
  Hyderabad: 229,
  Pune: 219,
  Chennai: 219
};

// Seeded Repaido Partner Spare Parts Shops (verified KYC, Balasore GPS coordinates)
export const seededSpareShops: SpareShop[] = [
  {
    id: 'shop-bls-01',
    ownerName: 'Rabindra Mohapatra',
    shopName: 'Maa Tarini Spare Hub',
    phone: '+91 94370 12890',
    email: 'tarini.spares.bls@gmail.com',
    gstin: '21AABCM1234F1Z8',
    tradeLicense: 'TL-BLS-2024-8891',
    address: 'Station Road, Near Town Bus Stand, Balasore, Odisha 756001',
    city: 'Balasore',
    lat: 21.4942,
    lng: 86.9324,
    bankAccount: '38920199201',
    ifsc: 'SBIN0000016',
    status: 'active',
    onboardingFeeRemaining: 1850, // ₹2000 recovered gradually with sales
    commissionRate: 0.05, // 5% platform commission
    createdAt: '2026-01-15T09:00:00Z'
  },
  {
    id: 'shop-bls-02',
    ownerName: 'Subhashree Nayak',
    shopName: 'Apex Electronics & Appliance Spares',
    phone: '+91 98610 54321',
    email: 'apex.spares.balasore@gmail.com',
    gstin: '21BCDEF5678G2Z1',
    tradeLicense: 'TL-BLS-2023-4102',
    address: 'Cinema Chhak, OT Road, Balasore, Odisha 756003',
    city: 'Balasore',
    lat: 21.4910,
    lng: 86.9205,
    bankAccount: '50100421893',
    ifsc: 'HDFC0001048',
    status: 'active',
    onboardingFeeRemaining: 1600,
    commissionRate: 0.05,
    createdAt: '2026-02-10T11:30:00Z'
  },
  {
    id: 'shop-bls-03',
    ownerName: 'Dillip Kumar Jena',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    phone: '+91 97781 87654',
    email: 'utkal.sanitary.bls@outlook.com',
    gstin: '21CDEFG9012H3Z5',
    tradeLicense: 'TL-BLS-2024-1029',
    address: 'Fakir Mohan Golayei, Balasore, Odisha 756001',
    city: 'Balasore',
    lat: 21.5015,
    lng: 86.9170,
    bankAccount: '023900210034',
    ifsc: 'PUNB0023900',
    status: 'active',
    onboardingFeeRemaining: 2000,
    commissionRate: 0.05,
    createdAt: '2026-03-01T14:15:00Z'
  }
];

// Verified Spare Part Products in Partner Inventory (Zero fake products)
export const seededSpareProducts: SparePartProduct[] = [
  {
    id: 'pr-ac-cap-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'Dual Run Motor Capacitor 45+5 µF 440V AC',
    partNumber: 'CAP-45-5-R',
    hsnCode: '8532',
    category: 'ac',
    condition: 'new',
    price: 450,
    mrp: 650,
    stock: 14,
    image: '/images/appliance.svg',
    brand: 'Tibcon / EPCOS',
    compatibility: '1.5 Ton & 2.0 Ton Split / Window AC (Voltas, Daikin, LG)',
    warrantyMonths: 6,
    gstRate: 0.18,
    status: 'approved',
    description: 'High endurance metalized polypropylene film capacitor engineered for heavy compressor starting load.'
  },
  {
    id: 'pr-refurb-inv-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'Certified Refurbished Inverter AC PCB Motherboard (Grade A+)',
    partNumber: 'PCB-INV-A104',
    hsnCode: '8504',
    category: 'ac',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    certifiedDiagnostic: true,
    moneyBackDays: 14,
    warrantyMonths: 6,
    price: 2450,
    mrp: 4800,
    stock: 5,
    image: '/images/appliance.svg',
    brand: 'Daikin / Panasonic OEM',
    compatibility: 'Universal 1.5 Ton Split ACs',
    gstRate: 0.18,
    status: 'approved',
    description: '40-point diagnostics passed. 100% factory stress-tested capacitor bank and IPM driver module. 14-day replacement guarantee.'
  },
  {
    id: 'pr-preowned-mot-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'Pre-Owned Washing Machine Heavy Pulsator Motor (Tested)',
    partNumber: 'MOT-PUL-WASH7',
    hsnCode: '8501',
    category: 'appliance',
    condition: 'preowned',
    ownershipVerified: true,
    secondHandNotes: 'Workshop bench tested by Maa Tarini senior technician. 100% genuine copper windings with zero bearing play.',
    warrantyMonths: 3,
    price: 1100,
    mrp: 2300,
    stock: 3,
    image: '/images/appliance.svg',
    brand: 'LG Smart Inverter',
    compatibility: 'LG 6.5kg - 8kg Semi-Automatic Washing Machines',
    gstRate: 0.18,
    status: 'approved',
    description: 'Inspected and certified pre-owned motor from verified donor unit. Ready for direct installation.'
  },
  {
    id: 'pr-ac-blw-02',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'Split AC Indoor Blower Fan Motor 28W Pure Copper',
    partNumber: 'MOT-BLW-28W',
    hsnCode: '8501',
    category: 'ac',
    condition: 'new',
    price: 1350,
    mrp: 1850,
    stock: 7,
    image: '/images/appliance.svg',
    brand: 'Welling / Panasonic',
    compatibility: 'Universal 1 Ton & 1.5 Ton indoor units (LG, Lloyd, Blue Star)',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    description: 'Low-noise pure copper coil indoor cross-flow blower motor with 4-speed harness.'
  },
  {
    id: 'pr-ac-gas-03',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'R32 Low-GWP Eco Refrigerant Gas Can (650g)',
    partNumber: 'REF-R32-650G',
    hsnCode: '8415',
    category: 'ac',
    condition: 'new',
    price: 890,
    mrp: 1150,
    stock: 18,
    image: '/images/appliance.svg',
    brand: 'Floron / SRF',
    compatibility: 'Modern 3-Star and 5-Star Inverter Air Conditioners',
    warrantyMonths: 0,
    gstRate: 0.18,
    status: 'approved',
    description: 'Virgin quality R32 fluorocarbon gas with self-sealing puncture valve for quick top-up.'
  },
  {
    id: 'pr-plumb-val-01',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    name: 'Heavy Brass Concealed Flush Valve 32mm Dual Action',
    partNumber: 'VAL-FLUSH-32B',
    category: 'plumber',
    price: 1250,
    mrp: 1650,
    stock: 9,
    image: '/images/bathroom.jpg',
    brand: 'Jaquar / Parryware',
    compatibility: 'Concealed cisterns and western toilet wall piping',
    warrantyMonths: 24,
    gstRate: 0.18,
    status: 'approved',
    description: 'Forged solid brass internal piston with ceramic cartridge ensuring zero dripping.'
  },
  {
    id: 'pr-plumb-ang-02',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    name: 'Quarter Turn Brass Angle Cock with Wall Flange 1/2"',
    partNumber: 'CK-ANG-QT-12',
    category: 'plumber',
    price: 380,
    mrp: 520,
    stock: 25,
    image: '/images/bathroom.jpg',
    brand: 'Hindware / Cera',
    compatibility: 'Geyser inlet, health faucet and wash basin connections',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    description: 'Chrome plated virgin brass body with high durability quarter-turn spindle.'
  },
  {
    id: 'pr-plumb-disc-03',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    name: 'Ceramic Disc Cartridge 35mm for Single Lever Basin Mixer',
    partNumber: 'CRT-CER-35MM',
    category: 'plumber',
    price: 240,
    mrp: 350,
    stock: 16,
    image: '/images/bathroom.jpg',
    brand: 'Sedal / KCG OEM',
    compatibility: 'Universal single lever hot/cold basin mixers',
    warrantyMonths: 6,
    gstRate: 0.18,
    status: 'approved',
    description: 'Diamond hardness sintered alumina ceramic disc tested up to 500,000 cycles.'
  },
  {
    id: 'pr-elec-mcb-01',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    name: 'Double Pole 32A C-Curve Modular MCB 10kA',
    partNumber: 'MCB-DP-32A-10K',
    category: 'electrician',
    price: 490,
    mrp: 690,
    stock: 20,
    image: '/images/electrical.jpg',
    brand: 'Schneider Electric / Legrand',
    compatibility: 'Main distribution boards, AC circuits, and power sub-meters',
    warrantyMonths: 24,
    gstRate: 0.18,
    status: 'approved',
    description: 'Air-break miniature circuit breaker with bi-metallic overload & magnetic short-circuit protection.'
  },
  {
    id: 'pr-elec-cbl-02',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    name: 'FR-LSH Pure Copper Multi-strand Wire 2.5 sq mm (30m)',
    partNumber: 'WIR-FRLSH-25',
    category: 'electrician',
    price: 1150,
    mrp: 1450,
    stock: 12,
    image: '/images/electrical.jpg',
    brand: 'Havells / Polycab',
    compatibility: 'Internal wiring for 16A power sockets and appliance points',
    warrantyMonths: 60,
    gstRate: 0.18,
    status: 'approved',
    description: 'Electrolytic grade 99.97% bright annealed copper with fire retardant low smoke insulation.'
  },
  {
    id: 'pr-app-pmp-01',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    name: 'Universal Washing Machine Drain Pump Motor 30W',
    partNumber: 'PMP-DRN-30W',
    category: 'appliance',
    price: 680,
    mrp: 950,
    stock: 11,
    image: '/images/washer.jpg',
    brand: 'Askoll / Hanyu',
    compatibility: 'Front & Top Load Washing Machines (IFB, Samsung, LG, Whirlpool)',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    description: 'Magnetic rotor drain pump assembly with lint filter casing.'
  },
  {
    id: 'pr-app-tmr-02',
    shopId: 'shop-bls-02',
    shopName: 'Apex Electronics & Appliance Spares',
    name: 'Frost-Free Refrigerator Defrost Timer & Bi-Metal Sensor Kit',
    partNumber: 'TMR-DFRST-KIT',
    category: 'appliance',
    price: 520,
    mrp: 750,
    stock: 15,
    image: '/images/appliance.svg',
    brand: 'Sankyo / Invensys',
    compatibility: 'Double door frost-free refrigerators (LG, Godrej, Whirlpool)',
    warrantyMonths: 6,
    gstRate: 0.18,
    status: 'approved',
    description: 'Electromechanical defrost timer 6hr-21min cycle with hermetic thermal fuse.'
  },
  {
    id: 'pr-tool-clm-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Spare Hub',
    name: 'True-RMS Digital AC/DC Clamp Meter 600A with Temperature',
    partNumber: 'TL-CLM-600A',
    category: 'tools',
    price: 1850,
    mrp: 2600,
    stock: 5,
    image: '/images/electrical.jpg',
    brand: 'Mastech / HTC',
    compatibility: 'AC & Appliance technicians, field electricians',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    description: 'CAT III 600V certified clamp meter with auto-ranging, capacitance and thermocouple probe.'
  },
  {
    id: 'pr-tool-wrn-02',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    name: 'Heavy Duty 14-inch Drop Forged Cast Iron Pipe Wrench',
    partNumber: 'TL-WRN-14HD',
    category: 'tools',
    price: 650,
    mrp: 890,
    stock: 8,
    image: '/images/bathroom.jpg',
    brand: 'Taparia / Everest',
    compatibility: 'Plumbing fittings from 1/2" up to 2" GI / CPVC / UPVC',
    warrantyMonths: 24,
    gstRate: 0.18,
    status: 'approved',
    description: 'Hardened ductile iron handle with hardened steel hook jaw and precision knurled nut.'
  },
  {
    id: 'ref-macbook-01',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Tech & Refurb Hub',
    name: 'Refurbished Apple MacBook Pro 14" M2 (16GB RAM, 512GB SSD) Space Grey',
    partNumber: 'REF-MBP-M2-14',
    category: 'refurbished',
    price: 74999,
    mrp: 149900,
    stock: 4,
    image: '/images/family-home-care.jpg',
    brand: 'Apple Certified Refurbished',
    compatibility: 'macOS Sonoma, Professional Design & Development',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'Grade A+ Like-New condition. 100% battery health, zero cosmetic scratches, complete original packaging with 67W MagSafe fast charger.'
  },
  {
    id: 'ref-iphone-02',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Tech & Refurb Hub',
    name: 'Refurbished iPhone 14 Pro 128GB (Deep Purple) - Superb Condition',
    partNumber: 'REF-IP14P-128',
    category: 'refurbished',
    price: 58499,
    mrp: 119900,
    stock: 6,
    image: '/images/banners/refurbished.jpg',
    brand: 'Apple / Repaido Certified',
    compatibility: 'All 5G Networks, Dynamic Island, A16 Bionic',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'Flawless Grade A+ display & stainless steel frame. 40-point hardware diagnostic tested with OEM battery and lightning cable.'
  },
  {
    id: 'ref-samsung-03',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Tech & Refurb Hub',
    name: 'Refurbished Samsung Galaxy S23 Ultra 5G (256GB, Phantom Black, S-Pen)',
    partNumber: 'REF-S23U-256',
    category: 'refurbished',
    price: 54999,
    mrp: 124999,
    stock: 3,
    image: '/images/banners/refurbished.jpg',
    brand: 'Samsung Certified',
    compatibility: '200MP Camera, Snapdragon 8 Gen 2, 45W Fast Charging',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'Grade A pristine condition. Quad cameras factory-calibrated with 100x Space Zoom, original S-Pen included.'
  },
  {
    id: 'ref-daikin-04',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Tech & Refurb Hub',
    name: 'Refurbished Daikin 1.5 Ton 5-Star Inverter Split AC (100% Pure Copper, PM2.5)',
    partNumber: 'REF-DAIK-15T',
    category: 'refurbished',
    price: 22999,
    mrp: 48000,
    stock: 5,
    image: '/images/ac.jpg',
    brand: 'Daikin Certified Refurb',
    compatibility: 'Up to 160 sq. ft. room, Neo Swing Inverter Compressor',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'Factory overhauled with fresh R32 refrigerant gas top-up, chemically sanitized evaporator coils and zero noise compressor.'
  },
  {
    id: 'ref-bosch-05',
    shopId: 'shop-bls-01',
    shopName: 'Maa Tarini Tech & Refurb Hub',
    name: 'Refurbished Bosch 7kg 1200 RPM Front-Load Fully Automatic Washing Machine',
    partNumber: 'REF-BOSCH-7KG',
    category: 'refurbished',
    price: 16499,
    mrp: 36000,
    stock: 4,
    image: '/images/washer.jpg',
    brand: 'Bosch EcoSilence',
    compatibility: 'EcoSilence Drive Inverter Motor, Anti-Tangle Wave Drum',
    warrantyMonths: 12,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'German-engineered brushless motor tested for 200 wash cycles. Brand new drum seal and inlet valve fitted.'
  },
  {
    id: 'ref-drill-06',
    shopId: 'shop-bls-03',
    shopName: 'Utkal Sanitary & Plumbing Mart',
    name: 'Refurbished Bosch GBH 2-26 DRE 800W Professional Rotary Hammer Drill',
    partNumber: 'REF-BSH-GBH226',
    category: 'refurbished',
    price: 4499,
    mrp: 9800,
    stock: 7,
    image: '/images/electrical.jpg',
    brand: 'Bosch Professional',
    compatibility: 'SDS Plus bits, 26mm concrete drilling, 3-mode operation',
    warrantyMonths: 6,
    gstRate: 0.18,
    status: 'approved',
    condition: 'refurbished',
    refurbishedGrade: 'A+',
    moneyBackDays: 7,
    certifiedDiagnostic: true,
    description: 'Overhauled gearbox with new carbon brushes and reinforced armature. Includes carry case and depth gauge.'
  }
];

export function formatMoney(paise:number) {
  return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:paise % 100 === 0 ? 0 : 2}).format(paise/100);
}

export function formatDuration(minutes:number) {
  return minutes>=60 ? `${minutes/60} ${minutes===60?'hour':'hours'}` : `${minutes} min`;
}

export function formatTime(hour:string) {
  const n=Number(hour.split(':')[0]);
  return `${n>12?n-12:n}:00 ${n>=12?'PM':'AM'}`;
}
