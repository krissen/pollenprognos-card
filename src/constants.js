import * as PP  from './adapters/pp.js';
import * as DWD from './adapters/dwd.js';

export const ADAPTERS = {
  pp: PP,
  dwd: DWD
};

export const DWD_REGIONS = {
  '11': 'Schleswig-Holstein und Hamburg',
  '12': 'Schleswig-Holstein und Hamburg',
  '20': 'Mecklenburg-Vorpommern',
  '31': 'Niedersachsen und Bremen',
  '32': 'Niedersachsen und Bremen',
  '41': 'Nordrhein-Westfalen',
  '42': 'Nordrhein-Westfalen',
  '43': 'Nordrhein-Westfalen',
  '50': 'Brandenburg und Berlin',
  '61': 'Sachsen-Anhalt',
  '62': 'Sachsen-Anhalt',
  '71': 'Thüringen',
  '72': 'Thüringen',
  '81': 'Sachsen',
  '82': 'Sachsen',
  '91': 'Hessen',
  '92': 'Hessen',
  '101': 'Rheinland-Pfalz und Saarland',
  '102': 'Rheinland-Pfalz und Saarland',
  '103': 'Rheinland-Pfalz und Saarland',
  '111': 'Baden-Württemberg',
  '112': 'Baden-Württemberg',
  '113': 'Baden-Württemberg',
  '121': 'Bayern',
  '122': 'Bayern',
  '123': 'Bayern',
  '124': 'Bayern',
};

export const ALLERGEN_TRANSLATION = {
  // Svenska
  al:               'alder',
  alm:              'elm',
  bjork:            'birch',
  ek:               'oak',
  grabo:            'mugwort',
  gras:             'grass',
  hassel:           'hazel',
  malortsambrosia:  'ragweed',
  salg_och_viden:   'willow',

  // Tyska (DWD), normaliserade via replaceAAO
  erle:     'alder',
  ambrosia: 'ragweed',
  esche:    'ash',
  birke:    'birch',
  hasel:    'hazel',
  graeser:  'grass',    // från 'gräser'
  beifuss:  'mugwort',  // från 'beifuss'
  roggen:   'rye'
};



export const TRANSLATIONS = {
  en: {
    // Card-texter
    header_prefix:   'Pollen forecast for',
    error:           'No pollen sensors found. Have you installed the correct integration and selected a region in the card config?',
    // Editor-texter
    integration:      'Integration',
    city:             'City',
    region_id:        'Region ID',
    title:            'Title (empty = auto)',
    minimal:          'Minimal',
    show_text:        'Show text',
    show_empty_days:  'Show empty days',
    days_relative:    'Relative days (today/tomorrow)',
    days_abbreviated: 'Abbreviate weekdays',
    days_uppercase:   'Uppercase weekdays',
    days_boldfaced:   'Bold weekdays',
    days_to_show:     'Days to show:',
    pollen_threshold: 'Threshold:',
    sort:             'Sort order',
    locale:           'Locale',
    allergens:        'Allergens',
    phrases:          'Phrases',
    phrases_full:     'Phrases – full',
    phrases_short:    'Phrases – short',
    phrases_levels:   'Phrases – levels',
    phrases_days:     'Phrases – days',
    no_information:   'No information',
    debug:            'Debug',
  },
  sv: {
    // Card-texter
    header_prefix:   'Pollenprognos för',
    error:           'Inga pollen-sensorer hittades. Har du installerat rätt integration och valt region i kortets konfiguration?',
    // Editor-texter
    integration:      'Integration',
    city:             'Stad',
    region_id:        'Region ID',
    title:            'Titel (tom = auto)',
    minimal:          'Minimal',
    show_text:        'Visa text',
    show_empty_days:  'Visa tomma dagar',
    days_relative:    'Relativa dagar (idag/imorgon)',
    days_abbreviated: 'Förkorta veckodagar',
    days_uppercase:   'Versaler veckodagar',
    days_boldfaced:   'Fetstil veckodagar',
    days_to_show:     'Antal dagar:',
    pollen_threshold: 'Tröskelvärde:',
    sort:             'Sortering',
    locale:           'Locale',
    allergens:        'Allergener',
    phrases:          'Fraser',
    phrases_full:     'Fraser – full',
    phrases_short:    'Fraser – kort',
    phrases_levels:   'Fraser – nivåer',
    phrases_days:     'Fraser – dagar',
    no_information:   'Ingen information',
    debug:            'Debug',
  },
  de: {
    // Card-texter
    header_prefix:   'Pollenprognose für',
    error:           'Keine Pollensensoren gefunden. Haben Sie die richtige Integration installiert und eine Region in der Kartenkonfiguration ausgewählt?',
    // Editor-texter
    integration:      'Integration',
    city:             'Stadt',
    region_id:        'Region ID',
    title:            'Titel (leer = Auto)',
    minimal:          'Minimal',
    show_text:        'Text anzeigen',
    show_empty_days:  'Leere Tage anzeigen',
    days_relative:    'Relative Tage (heute/morgen)',
    days_abbreviated: 'Wochentage abkürzen',
    days_uppercase:   'Wochentage groß',
    days_boldfaced:   'Wochentage fett',
    days_to_show:     'Anzahl Tage:',
    pollen_threshold: 'Schwelle:',
    sort:             'Sortierung',
    locale:           'Locale',
    allergens:        'Allergene',
    phrases:          'Phrasen',
    phrases_full:     'Phrasen – full',
    phrases_short:    'Phrasen – kurz',
    phrases_levels:   'Phrasen – Stufen',
    phrases_days:     'Phrasen – Tage',
    no_information:   'Keine Information',
    debug:            'Debug',
  }
};

export const PP_POSSIBLE_CITIES   = [
      'Borlänge','Bräkne-Hoby','Eskilstuna','Forshaga','Gävle','Göteborg',
      'Hässleholm','Jönköping','Kristianstad','Ljusdal','Malmö',
      'Norrköping','Nässjö','Piteå','Skövde','Stockholm',
      'Storuman','Sundsvall','Umeå','Visby','Västervik','Östersund'
    ];
