# Kleenex Pollen Radar API Testing Suite

This directory contains a comprehensive testing suite for discovering all possible allergens from the Kleenex Pollen Radar API across different geographic regions.

## 🎯 Purpose

The Kleenex integration in pollenprognos-card supports multiple allergens, but the exact set of allergens available depends on geographic location and season. This testing suite systematically explores the API to discover:

- All possible individual allergens across different regions
- Regional variations in allergen availability  
- Frequency and priority of newly discovered allergens
- Implementation recommendations for expanding card support

## 📁 Files

### Core Testing Scripts

**`kleenex_allergen_tester.py`** - Main discovery tool
- Tests 5 geographic regions (France, Italy, Netherlands, UK, USA)
- Generates random coordinates within each region's boundaries
- Makes 5-10 API calls per region with courtesy delays
- Outputs hierarchical JSON data showing discovered allergens

**`kleenex_allergen_analyzer.py`** - Analysis tool  
- Processes test data to identify new vs currently supported allergens
- Provides regional coverage analysis and frequency statistics
- Generates priority-ranked implementation recommendations
- Outputs detailed analysis report

**`kleenex_quick_test.py`** - Validation tool
- Lightweight tester for API verification  
- Tests just 5 strategic locations (major cities)
- Quick way to verify API integration is working
- Useful for debugging and development

### Output Files (Generated)

**`kleenex_allergen_test_data.json`** - Raw test data
- Hierarchical structure: region → location → allergens → details
- Includes geographic coordinates, timestamps, allergen values/levels
- Appends to existing data when script is re-run

**`kleenex_allergen_test_data_analysis.json`** - Analysis results
- Coverage analysis (new vs supported allergens)
- Regional breakdown and allergen-specific statistics  
- Priority-ranked recommendations for implementation

**`kleenex_quick_test_results.json`** - Quick test results
- Summary of quick validation test
- List of allergens found in major cities

## 🚀 Usage

### Prerequisites

Install required Python packages:
```bash
pip install aiohttp beautifulsoup4
```

### Quick Test (2-3 minutes)

Verify API integration with a few strategic locations:
```bash
cd scripts/
python3 kleenex_quick_test.py
```

### Full Discovery Test (20-45 minutes)

Comprehensive allergen discovery across all regions:
```bash
cd scripts/
python3 kleenex_allergen_tester.py
```

### Analysis

Process test data to identify implementation opportunities:
```bash
cd scripts/
python3 kleenex_allergen_analyzer.py
```

## 🌍 Tested Regions

The suite tests these geographic regions with the following call frequencies:

| Region | Code | Calls | Rationale |
|--------|------|-------|-----------|
| France | FR | 5 | Smaller European region |
| Italy | IT | 5 | Smaller European region |
| Netherlands | NL | 5 | Smallest region |
| United Kingdom | UK | 10 | Larger European region |
| United States | US | 10 | Largest region |

**Total API calls:** 35 per full test run
**Estimated runtime:** 20-45 minutes (with courtesy delays)

## 🎲 Random Coordinate Generation

Each test run generates fresh random coordinates within precise geographic boundaries:

- **France:** 41.3°N-51.1°N, 5.1°W-9.6°E
- **Italy:** 35.5°N-47.1°N, 6.6°E-18.5°E  
- **Netherlands:** 50.8°N-53.6°N, 3.4°E-7.2°E
- **United Kingdom:** 49.9°N-60.8°N, 10.7°W-1.8°E
- **United States:** 24.4°N-49.4°N, 125.0°W-66.9°W

Coordinates are rounded to 4 decimal places (~11m precision) for realistic location testing.

## 📊 Expected Discoveries

Based on Kleenex documentation and European/North American flora, the testing may discover these additional allergens:

### Trees
- ash, beech, willow, lime, chestnut, walnut, maple, cedar

### Weeds  
- nettle, plantain, chenopod, dock

### Grass Types
- poaceae, timothy, bermuda, rye grass

### Regional Variations
Different regions may have unique allergens not found elsewhere, particularly:
- Mediterranean species (Italy, Southern France)
- Northern European species (Netherlands, UK) 
- North American species (US)

## ⚠️ API Courtesy

The testing suite implements several courtesy measures:

- **Random delays:** 3-12 seconds between API calls
- **Reasonable request volume:** Maximum 35 calls per full test
- **Standard User-Agent:** Uses common browser identification
- **Error handling:** Graceful failure handling without retry storms
- **Appending data:** Re-runs append to existing data rather than duplicating calls

## 📈 Analysis Output

The analyzer provides:

### Priority Rankings
Allergens ranked by implementation priority based on:
- Frequency of appearance across tests
- Regional coverage (how many regions have it)
- Value ranges (higher values = more medically significant)
- Level ranges (higher levels = more severe reactions)

### Implementation Recommendations
- **High Priority:** Allergens found frequently across multiple regions
- **Medium Priority:** Regionally common allergens  
- **Low Priority:** Rare or region-specific allergens

### Regional Analysis
- Which allergens are specific to certain regions
- Coverage gaps in current implementation
- Frequency statistics for decision making

## 🔧 Integration with pollenprognos-card

Test results directly inform expansion of the card's allergen support:

1. **`src/constants.js`** - Add new allergens to `ALLERGEN_TRANSLATION`
2. **`src/locales/en.json`** - Add English translations for new allergens  
3. **`src/adapters/kleenex.js`** - Update allergen detection patterns if needed
4. **`src/pollenprognos-images.js`** - Add SVG icons for new allergens

The analyzer output provides specific recommendations for which allergens to prioritize based on real-world API data.

## 🐛 Troubleshooting

### Network Issues
- Check internet connectivity
- Verify Kleenex website accessibility  
- Try the quick test first to isolate issues

### API Changes
- Kleenex may update their API structure
- HTML parsing patterns may need updates
- Check browser dev tools for current API format

### Data Issues
- Empty results may indicate API blocking or rate limiting
- Try reducing call frequency or changing User-Agent
- Check output JSON for parsing errors in raw_details

## 📄 License

This testing suite is part of the pollenprognos-card project and follows the same MIT license terms.