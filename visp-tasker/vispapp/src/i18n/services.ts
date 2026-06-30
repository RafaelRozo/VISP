/**
 * VISP - Service Name Translations
 *
 * Client-side translation map for service categories and tasks.
 * Uses slug as key, returns translated name based on current language.
 */

import { useAppStore } from '../stores/appStore';

const categoryTranslations: Record<string, Record<string, string>> = {
  'cleaning': { en: 'Cleaning', fr: 'Nettoyage' },
  'assembly': { en: 'Assembly', fr: 'Assemblage' },
  'gardening': { en: 'Gardening & Landscaping', fr: 'Jardinage et aménagement' },
  'moving': { en: 'Moving & Hauling', fr: 'Déménagement et transport' },
  'seasonal': { en: 'Seasonal', fr: 'Saisonnier' },
  'pet-care': { en: 'Pet Care', fr: 'Soins des animaux' },
  'painting': { en: 'Painting', fr: 'Peinture' },
  'errands': { en: 'Errands & Delivery', fr: 'Courses et livraison' },
  'events': { en: 'Events', fr: 'Événements' },
  'plumbing': { en: 'Plumbing', fr: 'Plomberie' },
  'electrical': { en: 'Electrical', fr: 'Électricité' },
  'hvac': { en: 'HVAC', fr: 'Chauffage et climatisation' },
};

const taskTranslations: Record<string, Record<string, string>> = {
  // Cleaning
  'standard-residential-cleaning': { en: 'Standard Residential Cleaning', fr: 'Nettoyage résidentiel standard' },
  'bathroom-deep-cleaning': { en: 'Bathroom Deep Cleaning', fr: 'Nettoyage en profondeur de salle de bain' },
  'kitchen-deep-cleaning': { en: 'Kitchen Deep Cleaning', fr: 'Nettoyage en profondeur de cuisine' },
  'carpet-steam-cleaning': { en: 'Carpet Steam Cleaning', fr: 'Nettoyage à vapeur de tapis' },
  'carpet-vacuuming-spot-treatment': { en: 'Carpet Vacuuming & Spot Treatment', fr: 'Aspiration et traitement de taches' },
  'window-cleaning-interior': { en: 'Window Cleaning (Interior)', fr: 'Nettoyage de vitres (intérieur)' },
  'move-out-cleaning': { en: 'Move-Out Cleaning', fr: 'Nettoyage de déménagement' },
  'oven-stovetop-cleaning': { en: 'Oven & Stovetop Cleaning', fr: 'Nettoyage de four et cuisinière' },
  'refrigerator-deep-cleaning': { en: 'Refrigerator Deep Cleaning', fr: 'Nettoyage en profondeur de réfrigérateur' },
  'garage-cleanup-organization': { en: 'Garage Cleanup & Organization', fr: 'Nettoyage et organisation de garage' },
  'post-construction-cleaning-light': { en: 'Post-Construction Cleaning (Light)', fr: 'Nettoyage post-construction (léger)' },
  'mold-remediation': { en: 'Mold Remediation', fr: 'Traitement de moisissure' },
  'asbestos-testing-abatement': { en: 'Asbestos Testing & Abatement', fr: 'Test et désamiantage' },
  'lead-paint-remediation': { en: 'Lead Paint Remediation', fr: 'Traitement de peinture au plomb' },
  'biohazard-cleanup': { en: 'Biohazard Cleanup', fr: 'Nettoyage de matières dangereuses' },
  'emergency-flood-water-extraction': { en: 'Emergency Flood Water Extraction', fr: 'Extraction d\'eau d\'urgence' },
  'emergency-fire-damage-board-up': { en: 'Emergency Fire Damage Board-Up', fr: 'Barricadage d\'urgence après incendie' },
  // Assembly
  'ikea-furniture-assembly': { en: 'IKEA Furniture Assembly', fr: 'Assemblage de meubles IKEA' },
  'bed-frame-assembly': { en: 'Bed Frame Assembly', fr: 'Assemblage de cadre de lit' },
  'desk-assembly': { en: 'Desk Assembly', fr: 'Assemblage de bureau' },
  'bookshelf-assembly': { en: 'Bookshelf Assembly', fr: 'Assemblage de bibliothèque' },
  'outdoor-furniture-assembly': { en: 'Outdoor Furniture Assembly', fr: 'Assemblage de mobilier extérieur' },
  'exercise-equipment-assembly': { en: 'Exercise Equipment Assembly', fr: 'Assemblage d\'équipement d\'exercice' },
  'closet-organizer-assembly': { en: 'Closet Organizer Assembly', fr: 'Assemblage d\'organisateur de garde-robe' },
  'tv-wall-mount-no-wiring': { en: 'TV Wall Mount Setup (No Wiring)', fr: 'Installation de support TV (sans câblage)' },
  'tv-wall-mount-concealed-wiring': { en: 'TV Wall Mount with Concealed Wiring', fr: 'Support TV avec câblage dissimulé' },
  'floating-shelf-installation': { en: 'Floating Shelf Installation', fr: 'Installation d\'étagères flottantes' },
  'blinds-curtain-rod-installation': { en: 'Blinds & Curtain Rod Installation', fr: 'Installation de stores et tringles' },
  'baby-proofing-safety': { en: 'Baby-Proofing & Safety Installation', fr: 'Sécurité et protection pour bébé' },
  'appliance-installation-non-gas': { en: 'Appliance Installation (Non-Gas)', fr: 'Installation d\'appareil (sans gaz)' },
  'garage-shelving-installation': { en: 'Garage Shelving Installation', fr: 'Installation d\'étagères de garage' },
  'door-adjustment-hardware': { en: 'Door Adjustment & Hardware Replacement', fr: 'Ajustement de porte et quincaillerie' },
  'weatherstripping-caulking': { en: 'Weatherstripping & Caulking', fr: 'Calfeutrage et coupe-froid' },
  'baseboard-crown-moulding': { en: 'Baseboard & Crown Moulding Installation', fr: 'Installation de plinthes et moulures' },
  'interior-door-installation-prehung': { en: 'Interior Door Installation (Pre-Hung)', fr: 'Installation de porte intérieure' },
  'exterior-door-replacement-entry': { en: 'Exterior Door Replacement (Entry)', fr: 'Remplacement de porte d\'entrée' },
  'window-replacement': { en: 'Window Replacement', fr: 'Remplacement de fenêtre' },
  'garage-door-replacement': { en: 'Garage Door Replacement', fr: 'Remplacement de porte de garage' },
  'kitchen-cabinet-installation': { en: 'Kitchen Cabinet Installation', fr: 'Installation d\'armoires de cuisine' },
  'fence-board-replacement': { en: 'Fence Board Replacement', fr: 'Remplacement de planches de clôture' },
  'structural-beam-installation': { en: 'Structural Beam Installation', fr: 'Installation de poutre structurale' },
  'emergency-door-lock-repair': { en: 'Emergency Door / Lock Repair', fr: 'Réparation d\'urgence de porte/serrure' },
  'emergency-window-board-up': { en: 'Emergency Window Board-Up', fr: 'Barricadage de fenêtre d\'urgence' },
  // Gardening
  'lawn-mowing': { en: 'Lawn Mowing', fr: 'Tonte de pelouse' },
  'garden-weeding': { en: 'Garden Weeding', fr: 'Désherbage de jardin' },
  'hedge-trimming-low': { en: 'Hedge Trimming (Under 6ft)', fr: 'Taille de haie (moins de 6 pieds)' },
  'flower-bed-planting': { en: 'Flower Bed Planting', fr: 'Plantation de plates-bandes' },
  'mulching': { en: 'Mulching', fr: 'Paillage' },
  'leaf-raking-yard-cleanup': { en: 'Leaf Raking & Yard Cleanup', fr: 'Ratissage et nettoyage de cour' },
  'watering-plants-gardens': { en: 'Watering Plants & Gardens', fr: 'Arrosage de plantes et jardins' },
  'tree-pruning-small': { en: 'Tree Pruning (Small Trees)', fr: 'Élagage de petits arbres' },
  'sod-laying': { en: 'Sod Laying', fr: 'Pose de gazon' },
  'garden-bed-edging-border': { en: 'Garden Bed Edging & Border Install', fr: 'Bordure de plates-bandes' },
  'sprinkler-head-replacement': { en: 'Sprinkler Head Replacement', fr: 'Remplacement de tête d\'arroseur' },
  'pressure-washing-driveway-patio': { en: 'Pressure Washing (Driveway & Patio)', fr: 'Lavage à pression (entrée et patio)' },
  'pressure-washing-house-exterior': { en: 'Pressure Washing (House Exterior)', fr: 'Lavage à pression (extérieur maison)' },
  'fence-installation-full': { en: 'Fence Installation (Full)', fr: 'Installation de clôture complète' },
  'paver-patio-installation-small': { en: 'Paver Patio Installation (Small)', fr: 'Installation de patio en pavé (petit)' },
  'deck-construction-new-build': { en: 'Deck Construction (New Build)', fr: 'Construction de terrasse (neuve)' },
  'irrigation-system-installation': { en: 'Irrigation System Installation', fr: 'Installation de système d\'irrigation' },
  'retaining-wall-construction': { en: 'Retaining Wall Construction', fr: 'Construction de mur de soutènement' },
  'concrete-patio-walkway-pouring': { en: 'Concrete Patio / Walkway Pouring', fr: 'Coulée de béton patio/allée' },
  'driveway-paving-asphalt': { en: 'Driveway Paving (Asphalt)', fr: 'Pavage d\'entrée (asphalte)' },
  'french-drain-installation': { en: 'French Drain Installation', fr: 'Installation de drain français' },
  'pool-installation-above-ground': { en: 'Pool Installation (Above-Ground)', fr: 'Installation de piscine hors terre' },
  'large-tree-removal': { en: 'Large Tree Removal', fr: 'Abattage de grand arbre' },
  // Moving
  'small-item-moving-same-building': { en: 'Small Item Moving (Same Building)', fr: 'Déplacement de petits objets (même bâtiment)' },
  'furniture-rearrangement': { en: 'Furniture Rearrangement', fr: 'Réaménagement de meubles' },
  'local-apartment-move-small': { en: 'Local Apartment Move (Studio/1BR)', fr: 'Déménagement local (studio/1 ch.)' },
  'junk-removal-light': { en: 'Junk Removal (Light)', fr: 'Enlèvement de déchets (léger)' },
  'donation-drop-off': { en: 'Donation Drop-Off', fr: 'Dépôt de dons' },
  'storage-unit-organization': { en: 'Storage Unit Organization', fr: 'Organisation d\'unité de rangement' },
  'heavy-furniture-moving-stairs': { en: 'Heavy Furniture Moving (Stairs)', fr: 'Déplacement de meubles lourds (escaliers)' },
  'hot-tub-spa-moving': { en: 'Hot Tub / Spa Moving', fr: 'Déplacement de spa' },
  // Pet Care
  'dog-walking-30': { en: 'Dog Walking (30 min)', fr: 'Promenade de chien (30 min)' },
  'dog-walking-60': { en: 'Dog Walking (60 min)', fr: 'Promenade de chien (60 min)' },
  'pet-feeding-visit': { en: 'Pet Feeding Visit', fr: 'Visite d\'alimentation d\'animal' },
  'dog-bathing-small-medium': { en: 'Dog Bathing (Small/Medium)', fr: 'Bain de chien (petit/moyen)' },
  'litter-box-pet-area-cleaning': { en: 'Litter Box & Pet Area Cleaning', fr: 'Nettoyage de litière et espace animal' },
  'pet-sitting-half-day': { en: 'Pet Sitting (Half Day)', fr: 'Gardiennage d\'animal (demi-journée)' },
  // Errands
  'grocery-shopping': { en: 'Grocery Shopping', fr: 'Épicerie' },
  'package-pickup-delivery': { en: 'Package Pickup & Delivery', fr: 'Ramassage et livraison de colis' },
  'prescription-pickup': { en: 'Prescription Pickup', fr: 'Ramassage de prescription' },
  'dry-cleaning-pickup-dropoff': { en: 'Dry Cleaning Pickup & Drop-Off', fr: 'Nettoyage à sec (ramassage/dépôt)' },
  'return-item-to-store': { en: 'Return Item to Store', fr: 'Retour d\'article en magasin' },
  'waiting-in-line': { en: 'Waiting in Line', fr: 'Faire la file' },
  // Events
  'party-setup-tables-chairs': { en: 'Party Setup (Tables & Chairs)', fr: 'Installation de fête (tables et chaises)' },
  'balloon-decoration-setup': { en: 'Balloon & Decoration Setup', fr: 'Installation de ballons et décorations' },
  'tent-canopy-setup': { en: 'Tent & Canopy Setup', fr: 'Installation de tente et auvent' },
  'event-serving-assistance': { en: 'Event Serving Assistance', fr: 'Aide au service d\'événement' },
  'event-teardown-cleanup': { en: 'Event Teardown & Cleanup', fr: 'Démontage et nettoyage d\'événement' },
  // Painting
  'single-room-painting-basic': { en: 'Single Room Painting (Basic)', fr: 'Peinture d\'une pièce (basique)' },
  'touch-up-painting-small': { en: 'Touch-Up Painting (Small Area)', fr: 'Retouche de peinture (petite zone)' },
  'multi-room-interior-painting': { en: 'Multi-Room Interior Painting', fr: 'Peinture intérieure multi-pièces' },
  'deck-staining-sealing': { en: 'Deck Staining & Sealing', fr: 'Teinture et scellement de terrasse' },
  'fence-painting-staining': { en: 'Fence Painting / Staining', fr: 'Peinture/teinture de clôture' },
  'exterior-painting-single-storey': { en: 'Exterior Painting (Single Storey)', fr: 'Peinture extérieure (un étage)' },
  'wallpaper-removal': { en: 'Wallpaper Removal', fr: 'Retrait de papier peint' },
  'popcorn-ceiling-removal': { en: 'Popcorn Ceiling Removal', fr: 'Retrait de plafond texturé' },
  'drywall-patching-repair': { en: 'Drywall Patching & Repair', fr: 'Réparation de gypse' },
  'stucco-application-repair': { en: 'Stucco Application / Repair', fr: 'Application/réparation de stucco' },
  'exterior-siding-replacement': { en: 'Exterior Siding Replacement', fr: 'Remplacement de revêtement extérieur' },
};

/**
 * Translate a service name by slug.
 * Falls back to the original name if no translation found.
 */
export function translateServiceName(slug: string, originalName: string): string {
  const lang = useAppStore.getState().language;
  const entry = taskTranslations[slug] || categoryTranslations[slug];
  if (entry && entry[lang]) return entry[lang];
  return originalName;
}

/**
 * Translate a category name by slug.
 */
export function translateCategoryName(slug: string, originalName: string): string {
  const lang = useAppStore.getState().language;
  const entry = categoryTranslations[slug];
  if (entry && entry[lang]) return entry[lang];
  return originalName;
}
