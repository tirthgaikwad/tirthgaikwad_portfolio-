// ==========================================
// PROFESSIONS.JS — Every profession a member can pick, in groups, each with the skills typical for it
// Loaded by the sign-up page, the Professionals page, the profile editor and Discover. Data and lookups only: no page code.
// To add a profession, add one line to its group: ['Name', 'Skill, Skill, Skill'].
// ==========================================

// icon is a Material Symbols name
const PROFESSION_GROUPS = [
  { name: 'Students', icon: 'school', professions: [
    ['Student', 'Teamwork, Research, Presentation, Programming, Design, Writing, Public speaking']
  ] },
  { name: 'Healthcare', icon: 'medical_services', professions: [
    ['Doctor', 'Diagnosis, Patient care, Clinical medicine, Emergency care, Medical ethics, Preventive care, Health counselling'],
    ['Surgeon', 'General surgery, Laparoscopy, Pre-operative care, Post-operative care, Trauma care, Surgical planning'],
    ['Dentist', 'Oral examination, Root canal, Orthodontics, Cosmetic dentistry, Dental surgery, Oral hygiene education'],
    ['Nurse', 'Patient care, Medication administration, Wound care, Critical care, Vital signs monitoring, Patient education'],
    ['Pharmacist', 'Dispensing, Drug interactions, Patient counselling, Pharmacology, Inventory management, Prescription review'],
    ['Physiotherapist', 'Rehabilitation, Manual therapy, Exercise therapy, Sports injuries, Posture correction, Pain management'],
    ['Psychologist', 'Counselling, Cognitive behavioural therapy, Psychological assessment, Child psychology, Stress management, Research methods'],
    ['Psychiatrist', 'Mental health diagnosis, Psychopharmacology, Psychotherapy, Addiction treatment, Crisis intervention, Mood disorders'],
    ['Pediatrician', 'Child health, Vaccination, Growth monitoring, Newborn care, Childhood illnesses, Parent counselling'],
    ['Cardiologist', 'ECG interpretation, Echocardiography, Heart disease management, Angiography, Hypertension care, Cardiac rehabilitation'],
    ['Dermatologist', 'Skin diagnosis, Acne treatment, Cosmetic dermatology, Laser therapy, Hair disorders, Skin surgery'],
    ['Gynecologist', 'Prenatal care, Obstetrics, Fertility care, Menstrual health, Gynecological surgery, Family planning'],
    ['Orthopedic Surgeon', 'Fracture care, Joint replacement, Arthroscopy, Spine care, Sports medicine, Bone health'],
    ['Ophthalmologist', 'Eye examination, Cataract surgery, Glaucoma care, Retina care, Refractive surgery, Vision correction'],
    ['Radiologist', 'X-ray interpretation, CT scan, MRI, Ultrasound, Image-guided procedures, Radiation safety'],
    ['Anesthesiologist', 'General anesthesia, Regional anesthesia, Pain management, Critical care, Airway management, Patient monitoring'],
    ['Veterinarian', 'Animal diagnosis, Animal surgery, Vaccination, Pet care, Livestock health, Animal nutrition'],
    ['Ayurvedic Doctor', 'Ayurvedic diagnosis, Panchakarma, Herbal medicine, Diet planning, Pulse diagnosis, Lifestyle counselling'],
    ['Homeopath', 'Case taking, Remedy selection, Chronic disease care, Constitutional treatment, Patient counselling, Materia medica'],
    ['Nutritionist', 'Diet planning, Clinical nutrition, Weight management, Sports nutrition, Nutrition counselling, Meal planning'],
    ['Lab Technician', 'Sample collection, Blood tests, Microbiology, Pathology, Lab equipment, Quality control'],
    ['Paramedic', 'Emergency response, First aid, CPR, Trauma care, Patient transport, Triage'],
    ['Optometrist', 'Eye testing, Lens prescription, Contact lenses, Vision therapy, Eye health screening, Low vision care'],
    ['Speech Therapist', 'Speech assessment, Language therapy, Stammering therapy, Voice therapy, Swallowing therapy, Child speech development'],
    ['Public Health Specialist', 'Epidemiology, Health programmes, Community health, Health policy, Disease prevention, Health data analysis']
  ] },
  { name: 'Law', icon: 'gavel', professions: [
    ['Lawyer', 'Litigation, Legal drafting, Legal research, Client counselling, Negotiation, Court procedure, Contract law'],
    ['Judge', 'Judicial reasoning, Case management, Evidence evaluation, Legal interpretation, Judgment writing, Mediation'],
    ['Corporate Lawyer', 'Contract drafting, Mergers and acquisitions, Compliance, Corporate governance, Due diligence, Intellectual property'],
    ['Criminal Lawyer', 'Criminal defence, Bail applications, Cross-examination, Evidence law, Trial advocacy, Case investigation'],
    ['Legal Advisor', 'Legal opinions, Compliance, Contract review, Risk assessment, Dispute resolution, Regulatory law'],
    ['Notary', 'Document attestation, Affidavits, Deeds, Identity verification, Record keeping, Property documents'],
    ['Paralegal', 'Legal research, Document preparation, Case filing, Client coordination, Court records, Drafting support'],
    ['Patent Attorney', 'Patent drafting, Patent search, Trademark filing, IP strategy, Patent prosecution, Technology law'],
    ['Company Secretary', 'Corporate compliance, Board meetings, Company law, Statutory filings, Corporate governance, Secretarial audit']
  ] },
  { name: 'Business and Entrepreneurship', icon: 'business_center', professions: [
    ['Entrepreneur', 'Business strategy, Fundraising, Leadership, Product development, Sales, Networking, Team building'],
    ['Startup Founder', 'Fundraising, Product-market fit, Pitching, Team building, Growth strategy, MVP development, Investor relations'],
    ['Business Owner', 'Operations, Customer service, Budgeting, Sales, Vendor management, Staff management'],
    ['CEO', 'Leadership, Corporate strategy, Decision making, Stakeholder management, Financial planning, Organisation building'],
    ['Business Consultant', 'Business analysis, Strategy, Process improvement, Market research, Change management, Client presentations'],
    ['Product Manager', 'Product roadmap, User research, Prioritisation, Agile, Product analytics, Stakeholder management'],
    ['Project Manager', 'Project planning, Scheduling, Risk management, Agile, Budget control, Team coordination'],
    ['Operations Manager', 'Process optimisation, Supply chain, Quality control, Resource planning, Team management, Cost control'],
    ['HR Manager', 'Recruitment, Employee relations, Performance management, Payroll, Training, HR policy'],
    ['Recruiter', 'Sourcing, Interviewing, Talent screening, Employer branding, Offer negotiation, Applicant tracking'],
    ['Sales Manager', 'Sales strategy, Lead generation, Negotiation, CRM, Team leadership, Key account management'],
    ['Marketing Manager', 'Marketing strategy, Brand management, Campaign planning, Market research, Content marketing, Budget management'],
    ['Digital Marketer', 'SEO, Social media marketing, Google Ads, Email marketing, Analytics, Content marketing'],
    ['Brand Strategist', 'Brand positioning, Brand identity, Consumer insight, Storytelling, Campaign strategy, Market research'],
    ['Business Analyst', 'Requirements gathering, Data analysis, Process mapping, SQL, Reporting, Stakeholder communication'],
    ['Supply Chain Manager', 'Procurement, Logistics, Inventory management, Vendor management, Demand planning, Cost optimisation'],
    ['Real Estate Agent', 'Property sales, Negotiation, Property valuation, Client relations, Market knowledge, Documentation'],
    ['Franchise Owner', 'Franchise operations, Staff management, Local marketing, Inventory management, Customer service, Budgeting'],
    ['Investor', 'Deal sourcing, Due diligence, Valuation, Portfolio management, Startup mentoring, Financial analysis'],
    ['E-commerce Seller', 'Product listing, Inventory management, Online marketing, Customer service, Order fulfilment, Marketplace management']
  ] },
  { name: 'Finance', icon: 'account_balance', professions: [
    ['Chartered Accountant', 'Auditing, Taxation, Financial reporting, GST, Accounting standards, Company accounts'],
    ['Accountant', 'Bookkeeping, Tally, Financial statements, Payroll, GST filing, Reconciliation'],
    ['Financial Analyst', 'Financial modelling, Valuation, Excel, Forecasting, Equity research, Reporting'],
    ['Investment Banker', 'Mergers and acquisitions, Valuation, Financial modelling, Capital raising, Pitch books, Deal structuring'],
    ['Banker', 'Retail banking, Loans, Customer service, Credit assessment, KYC compliance, Wealth products'],
    ['Stock Trader', 'Technical analysis, Fundamental analysis, Risk management, Options trading, Portfolio management, Market research'],
    ['Financial Advisor', 'Financial planning, Mutual funds, Retirement planning, Insurance planning, Tax planning, Wealth management'],
    ['Tax Consultant', 'Income tax, GST, Tax planning, Tax filing, Tax litigation, Compliance'],
    ['Auditor', 'Internal audit, Statutory audit, Risk assessment, Compliance, Financial controls, Audit reporting'],
    ['Insurance Agent', 'Life insurance, Health insurance, Policy advice, Claims support, Client relations, Sales'],
    ['Actuary', 'Risk modelling, Statistics, Insurance pricing, Probability, Financial mathematics, Data analysis'],
    ['Economist', 'Economic analysis, Econometrics, Policy research, Forecasting, Data analysis, Report writing']
  ] },
  { name: 'Engineering and Technology', icon: 'engineering', professions: [
    ['Software Engineer', 'Python, Java, Data structures, System design, Git, Testing, Problem solving'],
    ['Web Developer', 'HTML, CSS, JavaScript, React, Node.js, REST APIs, Responsive design'],
    ['Mobile App Developer', 'Flutter, Android, iOS, React Native, Kotlin, Swift, App publishing'],
    ['Data Scientist', 'Python, Machine learning, Statistics, SQL, Data visualisation, Pandas, Deep learning'],
    ['AI Engineer', 'Machine learning, Deep learning, PyTorch, TensorFlow, NLP, Computer vision, MLOps'],
    ['Cybersecurity Specialist', 'Network security, Penetration testing, Incident response, Ethical hacking, Cryptography, Security auditing'],
    ['DevOps Engineer', 'Docker, Kubernetes, CI/CD, AWS, Linux, Infrastructure as code, Monitoring'],
    ['Cloud Architect', 'AWS, Azure, Google Cloud, Cloud security, Solution design, Cost optimisation, Microservices'],
    ['Game Developer', 'Unity, Unreal Engine, C++, C#, Game design, 3D graphics, Game physics'],
    ['UI/UX Designer', 'Figma, Wireframing, Prototyping, User research, Visual design, Usability testing, Design systems'],
    ['QA Engineer', 'Manual testing, Test automation, Selenium, Test planning, Bug tracking, API testing'],
    ['Database Administrator', 'SQL, PostgreSQL, MySQL, Backup and recovery, Performance tuning, Database security'],
    ['Network Engineer', 'Routing, Switching, Firewalls, Network troubleshooting, Cisco, VPN'],
    ['IT Support Specialist', 'Troubleshooting, Hardware repair, Windows, Networking basics, Help desk, System administration'],
    ['Blockchain Developer', 'Solidity, Smart contracts, Ethereum, Web3, Cryptography, Decentralised apps'],
    ['Embedded Systems Engineer', 'Embedded C, Microcontrollers, RTOS, PCB design, IoT, Firmware'],
    ['Robotics Engineer', 'ROS, Control systems, Sensors, Mechanical design, Computer vision, Automation'],
    ['Civil Engineer', 'Structural design, AutoCAD, Site supervision, Estimation, Surveying, Construction management'],
    ['Mechanical Engineer', 'CAD, SolidWorks, Thermodynamics, Manufacturing, Machine design, Maintenance'],
    ['Electrical Engineer', 'Power systems, Circuit design, Electrical machines, PLC, Wiring design, Energy audit'],
    ['Electronics Engineer', 'Circuit design, PCB design, Signal processing, Microcontrollers, VLSI, Testing'],
    ['Chemical Engineer', 'Process design, Plant operations, Process safety, Heat transfer, Chemical reactions, Quality control'],
    ['Aerospace Engineer', 'Aerodynamics, Aircraft design, Propulsion, CFD, Flight mechanics, Structural analysis'],
    ['Automobile Engineer', 'Vehicle design, Engines, Electric vehicles, Vehicle dynamics, Diagnostics, Manufacturing'],
    ['Biomedical Engineer', 'Medical devices, Biomechanics, Medical imaging, Biomaterials, Device testing, Regulatory compliance'],
    ['Environmental Engineer', 'Water treatment, Waste management, Pollution control, Environmental impact assessment, Sustainability, Compliance'],
    ['Architect', 'Architectural design, AutoCAD, 3D modelling, Building codes, Site planning, Sustainable design'],
    ['Urban Planner', 'City planning, Land use, GIS, Transport planning, Zoning, Community consultation']
  ] },
  { name: 'Science and Research', icon: 'science', professions: [
    ['Scientist', 'Research design, Data analysis, Laboratory techniques, Scientific writing, Experimentation, Grant writing'],
    ['Research Scholar', 'Literature review, Research methodology, Academic writing, Data analysis, Paper publishing, Presentation'],
    ['Physicist', 'Theoretical physics, Experimental physics, Mathematical modelling, Simulation, Data analysis, Scientific computing'],
    ['Chemist', 'Organic chemistry, Analytical chemistry, Spectroscopy, Synthesis, Lab safety, Quality analysis'],
    ['Biologist', 'Molecular biology, Genetics, Microscopy, Field research, Cell culture, Data analysis'],
    ['Biotechnologist', 'Genetic engineering, PCR, Cell culture, Bioprocessing, Bioinformatics, Fermentation'],
    ['Mathematician', 'Pure mathematics, Applied mathematics, Proof writing, Mathematical modelling, Statistics, Numerical methods'],
    ['Statistician', 'Statistical modelling, R, Survey design, Hypothesis testing, Data analysis, Probability'],
    ['Astronomer', 'Observational astronomy, Astrophysics, Data analysis, Telescope operation, Python, Scientific writing'],
    ['Geologist', 'Field mapping, Mineralogy, Geophysics, Soil testing, GIS, Rock analysis'],
    ['Environmental Scientist', 'Environmental monitoring, Ecology, Impact assessment, GIS, Climate analysis, Conservation'],
    ['Marine Biologist', 'Marine ecology, Field sampling, Scuba diving, Species identification, Conservation, Data analysis'],
    ['Agricultural Scientist', 'Crop science, Soil science, Plant breeding, Field trials, Pest management, Agricultural extension'],
    ['Forensic Scientist', 'Evidence analysis, Fingerprint analysis, DNA profiling, Toxicology, Crime scene investigation, Report writing']
  ] },
  { name: 'Education', icon: 'menu_book', professions: [
    ['Teacher', 'Lesson planning, Classroom management, Student assessment, Subject expertise, Communication, Mentoring'],
    ['Professor', 'Lecturing, Research, Curriculum design, Academic writing, Student mentoring, Paper publishing'],
    ['Tutor', 'One-to-one teaching, Exam preparation, Concept explanation, Doubt solving, Study planning, Patience'],
    ['School Principal', 'School administration, Leadership, Curriculum planning, Staff management, Parent communication, Policy making'],
    ['Career Counselor', 'Career guidance, Aptitude assessment, College admissions, Resume review, Interview preparation, Student counselling'],
    ['Special Educator', 'Individual education plans, Learning disabilities, Behaviour management, Inclusive teaching, Sign language, Parent counselling'],
    ['Librarian', 'Cataloguing, Information retrieval, Digital libraries, Reader services, Archiving, Research support'],
    ['Corporate Trainer', 'Training design, Facilitation, Soft skills training, Leadership training, Presentation, Learning assessment'],
    ['Education Consultant', 'Study abroad guidance, Admissions counselling, Curriculum advice, Scholarship guidance, Education policy, Institution planning'],
    ['Exam Coach', 'Exam strategy, Aptitude training, Mock tests, Subject coaching, Time management, Mentoring']
  ] },
  { name: 'Arts and Design', icon: 'palette', professions: [
    ['Artist', 'Painting, Drawing, Colour theory, Composition, Mixed media, Exhibition planning'],
    ['Illustrator', 'Digital illustration, Character design, Storyboarding, Procreate, Adobe Illustrator, Book illustration'],
    ['Graphic Designer', 'Adobe Photoshop, Adobe Illustrator, Branding, Typography, Layout design, Logo design, Print design'],
    ['Sculptor', 'Clay modelling, Stone carving, Metal work, Casting, 3D form, Installation art'],
    ['Animator', '2D animation, 3D animation, Blender, Maya, Character animation, Motion graphics, Storyboarding'],
    ['Photographer', 'Portrait photography, Wedding photography, Photo editing, Lighting, Adobe Lightroom, Product photography'],
    ['Interior Designer', 'Space planning, AutoCAD, 3D visualisation, Material selection, Lighting design, Furniture design'],
    ['Fashion Designer', 'Garment design, Pattern making, Fashion illustration, Textiles, Draping, Trend research'],
    ['Product Designer', 'Industrial design, Sketching, 3D modelling, Prototyping, User research, Materials'],
    ['Calligrapher', 'Hand lettering, Brush calligraphy, Typography, Invitation design, Devanagari calligraphy, Layout'],
    ['Tattoo Artist', 'Tattoo design, Line work, Shading, Hygiene and safety, Custom artwork, Client consultation'],
    ['Craft Artisan', 'Handicrafts, Pottery, Weaving, Wood craft, Embroidery, Product finishing'],
    ['Art Director', 'Creative direction, Visual concepts, Team leadership, Branding, Campaign design, Presentation'],
    ['Cartoonist', 'Cartooning, Caricature, Comic strips, Storytelling, Digital drawing, Satire']
  ] },
  { name: 'Film, TV and Stage', icon: 'movie', professions: [
    ['Actor', 'Acting, Method acting, Voice modulation, Improvisation, Dialogue delivery, Screen presence, Auditioning'],
    ['Film Director', 'Direction, Storytelling, Script breakdown, Shot planning, Working with actors, Film editing'],
    ['Producer', 'Film financing, Budgeting, Scheduling, Team coordination, Distribution, Contract negotiation'],
    ['Screenwriter', 'Screenplay writing, Story structure, Dialogue writing, Character development, Script editing, Pitching'],
    ['Cinematographer', 'Camera operation, Lighting, Shot composition, Colour grading, Lens selection, Visual storytelling'],
    ['Video Editor', 'Adobe Premiere Pro, Final Cut Pro, DaVinci Resolve, Colour grading, Sound sync, Motion graphics'],
    ['Theatre Artist', 'Stage acting, Voice projection, Improvisation, Script reading, Stage movement, Street theatre'],
    ['Voice Artist', 'Voice acting, Dubbing, Narration, Voice modulation, Audiobooks, Character voices'],
    ['Stand-up Comedian', 'Joke writing, Stage presence, Improvisation, Crowd work, Storytelling, Sketch comedy'],
    ['Dancer', 'Classical dance, Contemporary dance, Hip hop, Bollywood dance, Stage performance, Flexibility'],
    ['Choreographer', 'Dance composition, Stage choreography, Teaching dance, Music interpretation, Show direction, Group formations'],
    ['Model', 'Runway, Posing, Commercial modelling, Portfolio building, Fitness, Camera presence'],
    ['TV Host', 'Anchoring, Interviewing, Script reading, Live presentation, Voice modulation, Audience engagement'],
    ['Casting Director', 'Talent scouting, Auditions, Script analysis, Actor negotiation, Industry network, Screen tests'],
    ['VFX Artist', 'Compositing, Adobe After Effects, Nuke, 3D modelling, Rotoscoping, Motion tracking'],
    ['Stunt Performer', 'Stunt coordination, Martial arts, Fight choreography, Safety rigging, Parkour, Fitness']
  ] },
  { name: 'Music', icon: 'music_note', professions: [
    ['Singer', 'Vocals, Playback singing, Live performance, Voice training, Classical music, Studio recording, Harmonies'],
    ['Musician', 'Guitar, Piano, Drums, Live performance, Music theory, Session playing, Improvisation'],
    ['Music Composer', 'Composition, Arrangement, Film scoring, Music theory, Orchestration, Songwriting'],
    ['Music Producer', 'Music production, Mixing, Mastering, Ableton Live, FL Studio, Beat making, Sound design'],
    ['Lyricist', 'Lyric writing, Poetry, Songwriting, Storytelling, Rhyme, Hindi and regional lyrics'],
    ['DJ', 'DJ mixing, Beat matching, Live sets, Music curation, Remixing, Crowd reading'],
    ['Sound Engineer', 'Recording, Mixing, Live sound, Audio editing, Pro Tools, Acoustics'],
    ['Music Teacher', 'Vocal training, Instrument teaching, Music theory, Ear training, Exam preparation, Rhythm training'],
    ['Classical Vocalist', 'Hindustani classical, Carnatic music, Raga, Riyaz, Stage performance, Bhajan and ghazal'],
    ['Rapper', 'Rap writing, Freestyle, Flow, Stage performance, Beat selection, Studio recording']
  ] },
  { name: 'Writing and Media', icon: 'newspaper', professions: [
    ['Writer', 'Creative writing, Fiction, Non-fiction, Editing, Storytelling, Research, Publishing'],
    ['Journalist', 'News reporting, Interviewing, Investigative journalism, Fact checking, News writing, Field reporting'],
    ['Editor', 'Copy editing, Proofreading, Content planning, Style guides, Structural editing, Publishing'],
    ['Content Writer', 'Blog writing, SEO writing, Web content, Research, Editing, Social media content'],
    ['Copywriter', 'Advertising copy, Brand voice, Taglines, Sales pages, Email copy, Campaign concepts'],
    ['Blogger', 'Blog writing, SEO, WordPress, Content planning, Audience building, Affiliate marketing'],
    ['Poet', 'Poetry, Spoken word, Creative writing, Performance, Hindi and Urdu poetry, Editing'],
    ['Translator', 'Translation, Interpretation, Proofreading, Localisation, Subtitling, Language expertise'],
    ['Public Relations Specialist', 'Media relations, Press releases, Crisis communication, Event publicity, Brand reputation, Storytelling'],
    ['Content Creator', 'Video creation, Scripting, Video editing, YouTube, Audience growth, Brand collaborations, Thumbnail design'],
    ['Social Media Influencer', 'Content creation, Instagram, Brand partnerships, Audience engagement, Short video, Personal branding'],
    ['Podcaster', 'Podcast hosting, Interviewing, Audio editing, Script writing, Guest research, Audience growth'],
    ['Radio Jockey', 'Radio hosting, Voice modulation, Script writing, Live shows, Interviewing, Music curation'],
    ['News Reporter', 'Field reporting, Live reporting, News writing, Interviewing, Camera presence, Fact checking'],
    ['Publisher', 'Book publishing, Editing, Distribution, Rights management, Marketing, Author relations']
  ] },
  { name: 'Agriculture and Farming', icon: 'agriculture', professions: [
    ['Farmer', 'Crop planning, Gardening, Irrigation, Soil health, Organic farming, Livestock care, Farm machinery'],
    ['Gardener', 'Gardening, Plant care, Landscaping, Pruning, Composting, Nursery management, Pest control'],
    ['Horticulturist', 'Fruit cultivation, Vegetable cultivation, Greenhouse management, Plant propagation, Grafting, Nursery management'],
    ['Dairy Farmer', 'Cattle care, Milk production, Animal feeding, Dairy hygiene, Breeding, Milk processing'],
    ['Poultry Farmer', 'Poultry care, Feed management, Vaccination, Egg production, Hatchery, Biosecurity'],
    ['Fisherman', 'Fishing, Aquaculture, Net handling, Fish farming, Boat handling, Fish processing'],
    ['Agronomist', 'Crop management, Soil testing, Fertiliser planning, Pest management, Yield improvement, Farmer advisory'],
    ['Beekeeper', 'Hive management, Honey extraction, Bee health, Pollination services, Queen rearing, Wax products'],
    ['Florist', 'Flower arrangement, Bouquet design, Event decoration, Flower care, Wedding flowers, Customer service'],
    ['Organic Farming Specialist', 'Organic farming, Composting, Natural pest control, Organic certification, Soil health, Crop rotation'],
    ['Forester', 'Forest management, Tree plantation, Wildlife conservation, Timber assessment, Fire prevention, Field survey'],
    ['Agri-Entrepreneur', 'Agribusiness, Farm marketing, Food processing, Supply chain, Farmer networks, Export']
  ] },
  { name: 'Skilled Trades', icon: 'handyman', professions: [
    ['Electrician', 'House wiring, Electrical repair, Panel installation, Fault finding, Safety practices, Appliance repair'],
    ['Plumber', 'Pipe fitting, Leak repair, Bathroom fitting, Drainage, Water tank installation, Maintenance'],
    ['Carpenter', 'Furniture making, Woodworking, Door and window fitting, Modular furniture, Polishing, Measurement'],
    ['Mechanic', 'Engine repair, Vehicle servicing, Diagnostics, Two-wheeler repair, Brake systems, Electrical repair'],
    ['Welder', 'Arc welding, MIG welding, TIG welding, Metal fabrication, Blueprint reading, Safety practices'],
    ['Mason', 'Bricklaying, Plastering, Tile work, Concrete work, Stone work, Construction layout'],
    ['Tailor', 'Stitching, Pattern cutting, Alterations, Measurement, Embroidery, Blouse and suit making'],
    ['House Painter', 'Wall painting, Surface preparation, Texture painting, Waterproofing, Colour matching, Polishing'],
    ['Machine Operator', 'CNC operation, Lathe, Machine setup, Quality checks, Maintenance, Safety practices'],
    ['Jeweller', 'Jewellery design, Gold work, Stone setting, Polishing, Hallmark knowledge, Repair'],
    ['Blacksmith', 'Forging, Metal shaping, Tool making, Welding, Heat treatment, Repair'],
    ['Potter', 'Wheel throwing, Clay preparation, Glazing, Kiln firing, Terracotta, Hand building'],
    ['Weaver', 'Handloom weaving, Yarn dyeing, Pattern design, Saree weaving, Loom maintenance, Textile finishing'],
    ['HVAC Technician', 'AC installation, AC repair, Refrigeration, Gas charging, Duct work, Maintenance'],
    ['Mobile Repair Technician', 'Phone repair, Screen replacement, Soldering, Software flashing, Fault diagnosis, Laptop repair'],
    ['Contractor', 'Construction management, Estimation, Labour management, Site supervision, Material procurement, Client dealing']
  ] },
  { name: 'Government and Public Service', icon: 'shield', professions: [
    ['Civil Servant', 'Public administration, Policy implementation, Leadership, District management, Decision making, Governance'],
    ['Police Officer', 'Law enforcement, Investigation, Crowd control, Public safety, Cyber crime, Community policing'],
    ['Army Officer', 'Leadership, Tactical planning, Discipline, Physical fitness, Crisis management, Team command'],
    ['Navy Officer', 'Navigation, Seamanship, Leadership, Maritime operations, Engineering systems, Discipline'],
    ['Air Force Officer', 'Aviation, Leadership, Mission planning, Aircraft systems, Discipline, Crisis management'],
    ['Firefighter', 'Fire suppression, Rescue operations, First aid, Fire safety, Emergency response, Equipment handling'],
    ['Politician', 'Public speaking, Policy making, Constituency work, Negotiation, Campaigning, Public relations'],
    ['Diplomat', 'International relations, Negotiation, Foreign languages, Protocol, Policy analysis, Cultural awareness'],
    ['Government Clerk', 'Record keeping, Documentation, Office procedure, Data entry, Public dealing, File management'],
    ['Postal Worker', 'Mail sorting, Delivery, Customer service, Record keeping, Parcel handling, Savings schemes'],
    ['Customs Officer', 'Customs law, Inspection, Import and export rules, Documentation, Risk assessment, Investigation'],
    ['Public Policy Analyst', 'Policy research, Data analysis, Report writing, Stakeholder consultation, Programme evaluation, Economics']
  ] },
  { name: 'Sports and Fitness', icon: 'fitness_center', professions: [
    ['Athlete', 'Training discipline, Endurance, Strength training, Competition, Sports nutrition, Mental toughness'],
    ['Cricketer', 'Batting, Bowling, Fielding, Match strategy, Fitness, Team play'],
    ['Footballer', 'Dribbling, Passing, Shooting, Tactical awareness, Stamina, Team play'],
    ['Sports Coach', 'Training plans, Technique coaching, Team management, Match analysis, Motivation, Talent development'],
    ['Fitness Trainer', 'Personal training, Strength training, Weight loss, Workout planning, Nutrition basics, Injury prevention'],
    ['Yoga Instructor', 'Asanas, Pranayama, Meditation, Yoga therapy, Class planning, Breathing techniques'],
    ['Martial Artist', 'Karate, Taekwondo, Self-defence, Kickboxing, Discipline, Coaching'],
    ['Esports Player', 'Game strategy, Reflexes, Team communication, Streaming, Tournament play, Game analysis'],
    ['Referee', 'Rules knowledge, Decision making, Match control, Fitness, Communication, Conflict handling'],
    ['Adventure Guide', 'Trekking, Mountaineering, Route planning, First aid, Rock climbing, Camp management'],
    ['Chess Player', 'Openings, Tactics, Endgames, Calculation, Tournament play, Coaching']
  ] },
  { name: 'Hospitality and Food', icon: 'restaurant', professions: [
    ['Chef', 'Cooking, Menu planning, Indian cuisine, Continental cuisine, Kitchen management, Food presentation, Food safety'],
    ['Baker', 'Baking, Cake decoration, Bread making, Pastry, Recipe development, Custom cakes'],
    ['Restaurant Owner', 'Restaurant management, Menu planning, Staff management, Cost control, Customer service, Food licensing'],
    ['Hotel Manager', 'Hotel operations, Guest relations, Front office, Housekeeping, Revenue management, Staff management'],
    ['Barista', 'Coffee brewing, Latte art, Espresso, Customer service, Cafe operations, Menu knowledge'],
    ['Bartender', 'Mixology, Cocktails, Customer service, Bar management, Flair bartending, Stock control'],
    ['Caterer', 'Bulk cooking, Event catering, Menu planning, Food presentation, Staff coordination, Cost estimation'],
    ['Event Planner', 'Event management, Vendor coordination, Budgeting, Venue selection, Decor planning, Client handling'],
    ['Wedding Planner', 'Wedding planning, Decor design, Vendor management, Budgeting, Guest management, Destination weddings'],
    ['Travel Agent', 'Trip planning, Ticketing, Visa assistance, Tour packages, Hotel booking, Customer service'],
    ['Tour Guide', 'Guiding, Local history, Storytelling, Foreign languages, Group management, Itinerary planning'],
    ['Flight Attendant', 'Passenger service, Safety procedures, First aid, Communication, Grooming, Emergency handling'],
    ['Housekeeping Manager', 'Housekeeping operations, Staff supervision, Inventory, Quality checks, Laundry operations, Guest service']
  ] },
  { name: 'Transport and Logistics', icon: 'local_shipping', professions: [
    ['Pilot', 'Flying, Navigation, Flight planning, Aircraft systems, Communication, Crew management, Safety procedures'],
    ['Driver', 'Driving, Route knowledge, Vehicle maintenance, Road safety, Customer service, Long-distance driving'],
    ['Merchant Navy Officer', 'Navigation, Ship operations, Marine engineering, Cargo handling, Safety at sea, Watchkeeping'],
    ['Loco Pilot', 'Train operation, Signalling, Safety rules, Locomotive systems, Route knowledge, Fault handling'],
    ['Logistics Manager', 'Logistics planning, Warehouse management, Transport coordination, Inventory control, Vendor management, Cost control'],
    ['Delivery Partner', 'Delivery, Route planning, Time management, Customer service, Vehicle care, App handling'],
    ['Air Traffic Controller', 'Air traffic control, Radar monitoring, Communication, Decision making, Aviation rules, Stress management'],
    ['Fleet Manager', 'Fleet operations, Vehicle maintenance planning, Driver management, Route optimisation, Fuel management, Compliance'],
    ['Customs Broker', 'Customs clearance, Import and export documentation, Tariff classification, Freight coordination, Compliance, Client handling']
  ] },
  { name: 'Beauty and Fashion', icon: 'content_cut', professions: [
    ['Hair Stylist', 'Hair cutting, Hair colouring, Styling, Hair treatments, Bridal hair, Client consultation'],
    ['Makeup Artist', 'Bridal makeup, Party makeup, Airbrush makeup, Skin preparation, Editorial makeup, Special effects makeup'],
    ['Beautician', 'Facials, Threading, Waxing, Skin care, Manicure and pedicure, Bridal packages'],
    ['Fashion Stylist', 'Personal styling, Wardrobe planning, Photo shoot styling, Trend knowledge, Colour matching, Celebrity styling'],
    ['Nail Artist', 'Nail art, Gel nails, Acrylic nails, Manicure, Nail care, Custom designs'],
    ['Spa Therapist', 'Massage therapy, Aromatherapy, Body treatments, Reflexology, Client care, Relaxation techniques'],
    ['Barber', 'Hair cutting, Beard styling, Shaving, Fades, Hair care, Customer service'],
    ['Image Consultant', 'Personal branding, Wardrobe styling, Grooming, Body language, Etiquette, Communication coaching']
  ] },
  { name: 'Social Work and Community', icon: 'volunteer_activism', professions: [
    ['Social Worker', 'Case work, Community outreach, Counselling, Child welfare, Field work, Programme coordination'],
    ['NGO Founder', 'Fundraising, Programme design, Volunteer management, Grant writing, Community building, Impact reporting'],
    ['Activist', 'Campaigning, Public speaking, Community organising, Advocacy, Awareness drives, Policy advocacy'],
    ['Counselor', 'Counselling, Active listening, Family counselling, Relationship counselling, Crisis support, Career guidance'],
    ['Life Coach', 'Goal setting, Motivation, Habit building, Accountability coaching, Confidence building, Time management'],
    ['Motivational Speaker', 'Public speaking, Storytelling, Workshop delivery, Audience engagement, Leadership talks, Personal branding'],
    ['Religious Leader', 'Rituals, Spiritual guidance, Scripture knowledge, Community service, Ceremonies, Counselling'],
    ['Community Organizer', 'Community organising, Event planning, Volunteer coordination, Local outreach, Fundraising, Public relations'],
    ['Humanitarian Worker', 'Disaster relief, Field operations, First aid, Logistics, Community support, Needs assessment']
  ] },
  { name: 'Other', icon: 'more_horiz', professions: [
    ['Freelancer', 'Client communication, Project management, Self-marketing, Time management, Negotiation, Invoicing'],
    ['Homemaker', 'Home management, Budgeting, Cooking, Child care, Event organising, Time management'],
    ['Retired Professional', 'Mentoring, Advisory, Teaching, Public speaking, Consulting, Volunteering'],
    ['Job Seeker', 'Communication, Teamwork, Computer basics, Problem solving, Adaptability, Quick learning'],
    ['Other', 'Communication, Teamwork, Leadership, Problem solving, Time management, Customer service']
  ] }
];

// What a member can say they welcome. The first of each pair is what the server stores.
const OPEN_TO_OPTIONS = [
  ['mentoring', 'Mentoring'], ['collaboration', 'Collaboration'], ['hiring', 'Hiring'],
  ['consulting', 'Consulting'], ['speaking', 'Speaking'], ['internships', 'Internships']
];

const STUDENT_PROFESSION = 'Student';
const OTHER_PROFESSION = 'Other';

// Every profession as { name, key, group, icon, skills }, in the order of the groups above
const PROFESSIONS = [];
const professionsByKey = new Map();
PROFESSION_GROUPS.forEach(group => {
  group.professions = group.professions.map(([name, skills]) => {
    const profession = { name, key: name.toLowerCase(), group: group.name, icon: group.icon, skills: skills.split(',').map(skill => skill.trim()) };
    PROFESSIONS.push(profession);
    professionsByKey.set(profession.key, profession);
    return profession;
  });
});

// The entry for a name, whatever its capitals. Undefined when the name is not in the list.
function findProfession(name) {
  return professionsByKey.get(String(name || '').trim().toLowerCase());
}

function professionSkills(name) {
  const profession = findProfession(name);
  return profession ? profession.skills : [];
}

// Professions whose name starts with the text come first, then those that contain it, then those in a matching group
function searchProfessions(text, limit = 8) {
  const typed = String(text || '').trim().toLowerCase();
  if (!typed) return [];
  const starts = [], contains = [], inGroup = [];
  PROFESSIONS.forEach(profession => {
    if (profession.key.startsWith(typed)) starts.push(profession);
    else if (profession.key.includes(typed)) contains.push(profession);
    else if (profession.group.toLowerCase().includes(typed)) inGroup.push(profession);
  });
  return [...starts, ...contains, ...inGroup].slice(0, limit);
}

// An account from before professions existed has none saved: a professional account counts as "Other", anyone else as a student
function professionOf(person) {
  const saved = String(person.profession || '').trim();
  if (saved) return (findProfession(saved) || { name: saved }).name;
  return person.account_type === 'professional' ? OTHER_PROFESSION : STUDENT_PROFESSION;
}

// The server uses the same rule to decide whether a chat may go to the Professionals section of Messages
function isProfessional(person) {
  return person.account_type === 'professional' || professionOf(person) !== STUDENT_PROFESSION;
}

// "mentoring,hiring" -> ['Mentoring', 'Hiring'], in the order of OPEN_TO_OPTIONS
function openToLabels(value) {
  const picked = new Set(String(value || '').split(',').map(part => part.trim().toLowerCase()));
  return OPEN_TO_OPTIONS.filter(([key]) => picked.has(key)).map(([, label]) => label);
}
