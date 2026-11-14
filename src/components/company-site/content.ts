export const COMPANY = {
  legalName: 'Offshore Power Engineering Corporation Co., Ltd.',
  shortName: 'OPEC',
  tagline: 'Integrated Offshore Manpower, Engineering & Marine Supply Chain Partner',
  promise: 'Your Trusted Partner in Offshore Manpower & Integrated Marine Supply Chain',
  established: '4 April 2014',
  establishedPlace: 'Songkhla, Thailand',
  address: [
    'No. 4/11–4/12 Rat Uthit 2 Road,',
    'Bo Yang Subdistrict, Mueang Songkhla District,',
    'Songkhla 90000, Thailand',
  ],
  phones: ['+66 82 889 7893', '+66 88 791 5598'],
  email: 'pakin@opec.co.th',
};

export const PILLARS = [
  {
    key: 'manpower',
    title: 'Manpower Supply',
    text: 'Recruit, qualify and mobilize skilled personnel for offshore and industrial work.',
  },
  {
    key: 'engineering',
    title: 'Engineering & Construction',
    text: 'Design, fabrication, installation and plant support for small-to-medium projects.',
  },
  {
    key: 'equipment',
    title: 'Offshore Equipment',
    text: 'Tools, machinery, lifting gear and consumables, supplied or coordinated for rental.',
  },
  {
    key: 'marine',
    title: 'Marine Logistics',
    text: 'Crew boats, supply vessels and mission coordination from shore base to site.',
  },
  {
    key: 'fuel',
    title: 'Fuel Supply',
    text: 'Industrial diesel coordination for onshore delivery and offshore bunkering.',
  },
] as const;

export const CHAIN = [
  { title: 'People', text: 'Recruit, qualify and mobilize skilled personnel.' },
  { title: 'Supply', text: 'Source tools, machinery, lifting gear and consumables.' },
  { title: 'Marine', text: 'Coordinate vessels, offshore logistics and fuel delivery.' },
  { title: 'Delivery', text: 'Support safe and efficient project execution.' },
] as const;

export const SERVICES = [
  {
    id: 'manpower',
    index: '01',
    kicker: 'Core business',
    title: 'Specialized Manpower Supply',
    text: 'End-to-end recruitment and workforce management, including sourcing, screening, training, personality assessment, medical examinations, insurance administration, mobilization, demobilization, local logistics and PPE provision.',
  },
  {
    id: 'equipment',
    index: '02',
    kicker: 'Supply support',
    title: 'Offshore Equipment & Material Supply',
    points: [
      'Welding machines, generators and air compressors',
      'Certified rigging and lifting gear',
      'Bolts, screws, welding consumables, cutting and grinding discs',
      'Blast pots, blasting accessories, abrasive media and airless painting equipment',
      'Procurement and expediting support',
    ],
  },
  {
    id: 'marine',
    index: '03',
    kicker: 'Marine logistics',
    title: 'Marine Vessel Chartering',
    points: [
      'Crew boats for personnel transfer',
      'Supply vessels for cargo and structural support',
      'Qualified captains and marine crews',
      'Offshore mission and logistics coordination',
    ],
  },
  {
    id: 'fuel',
    index: '04',
    kicker: 'Energy supply',
    title: 'Diesel Fuel Supply',
    points: [
      'Industrial diesel supplier coordination',
      'Onshore delivery arrangements',
      'Offshore bunkering coordination',
      'Delivery planning aligned with project operations',
    ],
  },
  {
    id: 'engineering',
    index: '05',
    kicker: 'Technical delivery',
    title: 'Engineering & Construction Services',
    points: [
      'Design and fabrication for small-to-medium projects',
      'Civil, structural, piping, welding and PWHT works',
      'Surface preparation, abrasive blasting, tank and structural coating, insulation, E&I and commissioning',
      'Plant modification, inspection and shutdown support',
    ],
  },
] as const;

export const WORKFORCE_STEPS = [
  { n: '1', title: 'Source', text: 'Talent sourcing, recruitment drives, reference checks and candidate selection.' },
  { n: '2', title: 'Assess', text: 'Skills review, personality assessment, training and pre-employment medical checks.' },
  { n: '3', title: 'Mobilize', text: 'Documentation, insurance, travel readiness, PPE and local logistics.' },
  { n: '4', title: 'Support', text: 'Crew coordination, field administration, demobilization and workforce continuity.' },
] as const;

export const POSITIONS = [
  'Painter',
  'Scaffolder',
  'Rigger',
  'Fitter',
  'Welder',
  'Crane Operator',
  'Crane Operator — Class A',
  'Crane Operator — Class B',
  'Crane Operator — Class C',
  'Foreman — Scaffolding',
  'Foreman — Welding',
  'Scaffolding Inspector',
  'Structure Welder — 6G + 6GR',
  'Pipeline Welder — 6G + 6GR',
  'Helper Welder',
  'Assistant Welder Foreman',
  'Material Coordinator',
  'Mechanic',
  'Mechanic Foreman',
  'Blaster / Painter',
  'Painter Supervisor',
  'Blasting / Painting Foreman',
  'Blasting / Painting Supervisor',
  'Hydrotest Foreman',
  'Hydrotest Technician',
  'Instrument Tube',
  'Insulator',
  'Insulator Foreman',
  'Insulator Supervisor',
  'Construction Manager',
  'Construction Supervisor',
  'Electrical Foreman',
  'Electrical / Instrument Supervisor',
  'Electrical / Instrument Technician',
  'Electrician',
];

export const ENGINEERING = [
  { title: 'Engineering Design & FEED', text: 'Conceptual studies, FEED, detailed engineering and 2D/3D CAD modelling.' },
  { title: 'Civil & Structural', text: 'Civil foundations, structural works, steel fabrication and installation.' },
  { title: 'Tanks & Pressure Equipment', text: 'Storage tanks, pressure vessels, process columns and equipment packages.' },
  { title: 'Piping & Mechanical', text: 'Piping fabrication and installation, mechanical installation and PWHT works.' },
  { title: 'Rotating Equipment', text: 'Installation support for rotating machinery and associated systems.' },
  { title: 'Electrical & Instrumentation', text: 'Installation, instrument control, testing and commissioning.' },
  { title: 'Surface Protection', text: 'Abrasive blasting, surface preparation, protective coating and insulation.' },
  { title: 'Conveyor Systems', text: 'Conveyor-system design and installation services.' },
  { title: 'Plant Modification', text: 'Unit studies, minor modifications, fabrication supervision and inspection.' },
  { title: 'Shutdown & Maintenance', text: 'Plant shutdown support, high-pressure water-jet cleaning and manpower.' },
  { title: 'ISO, SHE & Environment', text: 'Construction, ISO, safety, health and environment management support.' },
  { title: 'Operations & Maintenance Training', text: 'Training support for operational readiness and maintenance activities.' },
];

export const DESIGN_SCOPE = [
  'Design and engineering of ASME pressure vessels',
  'Design and engineering of ASME process columns',
  'Design and engineering of ASME/TEMA heat exchangers',
  'Design of technological and industrial structures',
  'Civil foundations for heavy equipment and technological structures',
  'Process piping design to ASME B31.3, B31.4, B31.8 and B31.1',
  'Piping flexibility and stress analysis with recommended support systems',
  'Engineering design and fabrication for small-to-medium projects',
  'Fabrication supervision and equipment-package inspection',
  'Plant and unit modification studies',
  'Turnkey engineering concepts and project-specific work packages',
  'Detail engineering support on a man-hour basis',
];

export const PRODUCTS = [
  { title: 'Generators', text: 'Project power units available through supply or rental arrangements.', image: '/company/generators.jpg' },
  { title: 'Air Compressors', text: 'Industrial compressor packages for fabrication and field operations.', image: '/company/compressors.jpg' },
  { title: 'Welding Machines & Accessories', text: 'Welding power sources, torches, consumables and supporting equipment.', image: '/company/welding-machines.jpg' },
  { title: 'Welding Electrodes & Wire', text: 'Common electrode and welding-consumable grades, subject to client specification.', image: '/company/electrodes.jpg' },
  { title: 'Cutting & Grinding Discs', text: 'Consumable discs for metal cutting, preparation and finishing work.', image: '/company/discs.jpg' },
  { title: 'Bolts, Nuts & Screws', text: 'Industrial fasteners in project-required sizes, materials and grades.', image: '/company/fasteners.jpg' },
  { title: 'Shackles & Lifting Fittings', text: 'Rated lifting accessories with relevant certification when specified.', image: '/company/shackles.jpg' },
  { title: 'Webbing & Round Slings', text: 'Load-rated textile slings selected to suit lifting configuration and WLL.', image: '/company/slings.jpg' },
];

export const FACILITIES = [
  {
    title: 'FSO2 — Patumabaha, BKT Field',
    text: 'Floating Storage and Offloading facility with a stated capacity of 400,000 barrels.',
    image: '/company/fso.jpg',
  },
  {
    title: 'PTTEP — Bongkot Field',
    text: 'BLQ accommodation platform construction project environment in the Bongkot Field.',
    image: '/company/bongkot.jpg',
  },
  {
    title: 'PTTEP — Arthit Field',
    text: 'Wellhead platform construction project environment in the Arthit Field.',
    image: '/company/arthit.jpg',
  },
];

export const ASSIGNMENTS = [
  {
    years: '2022–2024',
    client: 'Unithai Shipyard and Engineering Co., Ltd.',
    place: 'Gulf of Thailand — Plathong G1 LQ',
    roles: 'Painter · Scaffolder · Rigger · Welder · Fitter · Foreman Scaffolder · Foreman Welder',
  },
  {
    years: '2023–2025',
    client: 'Tantawan Construction and Service Co., Ltd.',
    place: 'Gulf of Thailand / Satun — Funan G1 LQ',
    roles:
      'Painter · Scaffolder · Rigger · Welder · Fitter · Foreman Scaffolder · Foreman Welder · Scaffolding Inspector · Structure Welder 6G + 6GR · Pipeline Welder 6G + 6GR',
  },
  {
    years: '2023–2025',
    client: 'Best Performance Engineering Co., Ltd. (LS & BPE)',
    place: 'Gulf of Thailand — South Bongkot',
    roles:
      'Painter · Scaffolder · Rigger · Welder · Fitter · Foremen · Structure and Pipeline Welders · Helper Welder · Scaffolding Inspector · Crane Operator · Local logistics, PPE and insurance support',
  },
  {
    years: '2026',
    client: 'China Ocean Engineering Guangzhou Co., Ltd.',
    place: 'Selected manpower supply engagement',
    roles: 'Skilled trade personnel including painting, scaffolding, rigging, fitting, welding, inspection and crane-operation roles',
  },
  {
    years: '2026',
    client: 'TNS — Thai Nippon Steel Engineering & Construction Corporation Ltd.',
    place: 'Selected manpower supply engagement',
    roles: 'Skilled trade personnel including painting, scaffolding, rigging, fitting, welding, inspection and crane-operation roles',
  },
];

export const LEADERS = [
  {
    name: 'Mr. Thanapon Noilomthun',
    role: 'Managing Director',
    email: 'thanaphon@opec.co.th',
    image: '/company/leader-thanapon.jpg',
  },
  {
    name: 'Mr. Pakin Siriwinij',
    role: 'Business Development Director',
    email: 'pakin@opec.co.th',
    image: '/company/leader-pakin.jpg',
  },
  {
    name: 'Miss Ranida Tanapornpukamol',
    role: 'HR / Recruitment Director',
    email: 'ranida@opec.co.th',
    image: '/company/leader-ranida.jpg',
  },
];

export const CLIENTS = [
  { name: 'PTTEP', image: '/company/client-a.png' },
  { name: 'Unithai', image: '/company/client-d.png' },
  { name: 'Tantawan', image: '/company/client-e.png' },
  { name: 'TNS', image: '/company/client-c.png' },
  { name: 'China Rescue & Salvage', image: '/company/client-b.png' },
  { name: 'AVP Thailand-Songkhla', image: '/company/client-f.png' },
];
