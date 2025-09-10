#!/usr/bin/env python3
"""
Kleenex Allergen Data Analyzer

Analyzes the output from kleenex_allergen_tester.py to:
1. Compare discovered allergens vs currently supported ones
2. Provide frequency analysis across regions
3. Generate implementation recommendations

Author: GitHub Copilot Agent
"""

import json
import os
from collections import defaultdict, Counter
from typing import Dict, List, Set
from datetime import datetime

# Currently supported allergens in the pollenprognos-card kleenex adapter
CURRENT_ALLERGENS = {
    # Categories
    'trees', 'grass', 'weeds',
    
    # Individual allergens currently supported in kleenex adapter
    'alder', 'birch', 'chenopod', 'cypress', 'elm', 'hazel', 
    'mugwort', 'nettle', 'oak', 'pine', 'plane', 'poaceae', 'poplar', 'ragweed',
    
    # Other allergens from general ALLERGEN_TRANSLATION (may not be kleenex-specific)
    'ash', 'beech', 'chestnut', 'lime', 'willow', 'rye',
    'artemisia', 'nettle_and_pellitory', 'plantain'
}

class KleenexAllergenAnalyzer:
    def __init__(self, data_file: str):
        self.data_file = data_file
        self.data = None
        self.analysis = {}
        
    def load_data(self) -> bool:
        """Load test data from JSON file."""
        if not os.path.exists(self.data_file):
            print(f"❌ Data file not found: {self.data_file}")
            return False
            
        try:
            with open(self.data_file, 'r') as f:
                self.data = json.load(f)
            print(f"✅ Loaded data from {self.data_file}")
            return True
        except Exception as e:
            print(f"❌ Error loading data: {e}")
            return False
            
    def extract_all_allergens(self) -> Dict[str, Dict]:
        """Extract all unique allergens found across all regions and locations."""
        allergens_by_category = defaultdict(set)
        allergen_details = defaultdict(lambda: {
            'regions': set(),
            'locations': 0,
            'values': [],
            'levels': [],
            'frequency': 0
        })
        
        for region_key, locations in self.data.items():
            if region_key.startswith('_'):  # Skip metadata
                continue
                
            for location in locations:
                for category, category_data in location.get('allergens', {}).items():
                    for allergen, details in category_data.items():
                        allergens_by_category[category].add(allergen)
                        
                        # Track allergen details
                        allergen_details[allergen]['regions'].add(region_key)
                        allergen_details[allergen]['locations'] += 1
                        allergen_details[allergen]['values'].append(details.get('value', 0))
                        allergen_details[allergen]['levels'].append(details.get('level', 0))
                        allergen_details[allergen]['frequency'] += 1
                        allergen_details[allergen]['category'] = category
                        
        return dict(allergens_by_category), dict(allergen_details)
        
    def analyze_coverage(self) -> Dict:
        """Analyze allergen coverage and discover new ones."""
        allergens_by_category, allergen_details = self.extract_all_allergens()
        
        all_discovered = set()
        for category_allergens in allergens_by_category.values():
            all_discovered.update(category_allergens)
            
        # Find new allergens not currently supported
        new_allergens = all_discovered - CURRENT_ALLERGENS
        missing_allergens = CURRENT_ALLERGENS - all_discovered
        
        return {
            'discovered_total': len(all_discovered),
            'currently_supported': len(CURRENT_ALLERGENS),
            'new_allergens': sorted(list(new_allergens)),
            'missing_allergens': sorted(list(missing_allergens)),
            'allergens_by_category': {k: sorted(list(v)) for k, v in allergens_by_category.items()},
            'allergen_details': allergen_details
        }
        
    def analyze_regional_differences(self) -> Dict:
        """Analyze which allergens are specific to certain regions."""
        regional_allergens = defaultdict(set)
        
        for region_key, locations in self.data.items():
            if region_key.startswith('_'):  # Skip metadata
                continue
                
            for location in locations:
                for category_data in location.get('allergens', {}).values():
                    for allergen in category_data:
                        regional_allergens[region_key].add(allergen)
                        
        # Find region-specific allergens
        all_regions = set(regional_allergens.keys())
        region_specific = {}
        
        for region, allergens in regional_allergens.items():
            other_regions = all_regions - {region}
            other_allergens = set()
            for other_region in other_regions:
                other_allergens.update(regional_allergens[other_region])
                
            specific_to_region = allergens - other_allergens
            if specific_to_region:
                region_specific[region] = sorted(list(specific_to_region))
                
        return {
            'regional_allergens': {k: sorted(list(v)) for k, v in regional_allergens.items()},
            'region_specific': region_specific
        }
        
    def prioritize_implementation(self, coverage_analysis: Dict) -> List[Dict]:
        """Prioritize new allergens for implementation based on frequency and coverage."""
        allergen_details = coverage_analysis['allergen_details']
        new_allergens = coverage_analysis['new_allergens']
        
        # Calculate priority scores for new allergens
        priority_list = []
        for allergen in new_allergens:
            details = allergen_details[allergen]
            
            # Priority factors:
            # 1. Frequency (how often it appears)
            # 2. Regional coverage (how many regions have it)  
            # 3. Value range (higher max values = more important)
            # 4. Level range (higher max levels = more important)
            
            frequency_score = details['frequency']
            region_score = len(details['regions']) * 10  # Weight regional coverage highly
            value_score = max(details['values']) if details['values'] else 0
            level_score = max(details['levels']) * 5 if details['levels'] else 0
            
            total_score = frequency_score + region_score + value_score + level_score
            
            priority_list.append({
                'allergen': allergen,
                'category': details['category'],
                'priority_score': total_score,
                'frequency': frequency_score,
                'regions': sorted(list(details['regions'])),
                'region_count': len(details['regions']),
                'max_value': max(details['values']) if details['values'] else 0,
                'max_level': max(details['levels']) if details['levels'] else 0,
                'avg_value': sum(details['values']) / len(details['values']) if details['values'] else 0
            })
            
        # Sort by priority score (highest first)
        priority_list.sort(key=lambda x: x['priority_score'], reverse=True)
        
        return priority_list
        
    def generate_implementation_recommendations(self, priority_list: List[Dict]) -> List[str]:
        """Generate specific implementation recommendations."""
        recommendations = []
        
        # High priority allergens (top 33%)
        high_priority_count = max(1, len(priority_list) // 3)
        high_priority = priority_list[:high_priority_count]
        
        if high_priority:
            recommendations.append("🔥 HIGH PRIORITY - Implement immediately:")
            for item in high_priority:
                recommendations.append(
                    f"   • {item['allergen']} ({item['category']}) - "
                    f"Score: {item['priority_score']:.0f}, "
                    f"Regions: {item['region_count']}, "
                    f"Frequency: {item['frequency']}"
                )
                
        # Medium priority allergens  
        medium_start = high_priority_count
        medium_end = high_priority_count + max(1, len(priority_list) // 3)
        medium_priority = priority_list[medium_start:medium_end]
        
        if medium_priority:
            recommendations.append("\n🟡 MEDIUM PRIORITY - Consider for next release:")
            for item in medium_priority:
                recommendations.append(
                    f"   • {item['allergen']} ({item['category']}) - "
                    f"Score: {item['priority_score']:.0f}"
                )
                
        # Low priority allergens
        low_priority = priority_list[medium_end:]
        if low_priority:
            recommendations.append(f"\n🔵 LOW PRIORITY - {len(low_priority)} additional allergens found")
            recommendations.append("   (See full analysis for details)")
            
        return recommendations
        
    def run_analysis(self) -> bool:
        """Run complete analysis and save results."""
        if not self.load_data():
            return False
            
        print("\n🔬 ANALYZING KLEENEX ALLERGEN DATA")
        print("=" * 50)
        
        # Run all analyses
        coverage = self.analyze_coverage()
        regional = self.analyze_regional_differences()
        priority_list = self.prioritize_implementation(coverage)
        recommendations = self.generate_implementation_recommendations(priority_list)
        
        # Compile full analysis
        self.analysis = {
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_discovered': coverage['discovered_total'],
                'currently_supported': coverage['currently_supported'],
                'new_allergens_count': len(coverage['new_allergens']),
                'missing_allergens_count': len(coverage['missing_allergens'])
            },
            'coverage_analysis': coverage,
            'regional_analysis': regional,
            'priority_implementation': priority_list,
            'recommendations': recommendations
        }
        
        # Print summary
        self.print_analysis_summary()
        
        # Save analysis
        analysis_file = self.data_file.replace('.json', '_analysis.json')
        with open(analysis_file, 'w') as f:
            # Convert sets to lists for JSON serialization
            analysis_copy = json.loads(json.dumps(self.analysis, default=lambda x: list(x) if isinstance(x, set) else x))
            json.dump(analysis_copy, f, indent=2, ensure_ascii=False)
            
        print(f"\n💾 Full analysis saved to {analysis_file}")
        return True
        
    def print_analysis_summary(self):
        """Print a summary of the analysis results."""
        coverage = self.analysis['coverage_analysis']
        regional = self.analysis['regional_analysis']
        recommendations = self.analysis['recommendations']
        
        print(f"📊 ANALYSIS RESULTS")
        print(f"  Total allergens discovered: {coverage['discovered_total']}")
        print(f"  Currently supported: {coverage['currently_supported']}")
        print(f"  NEW allergens found: {len(coverage['new_allergens'])}")
        print(f"  Missing from test: {len(coverage['missing_allergens'])}")
        
        print(f"\n🌍 REGIONAL BREAKDOWN")
        for region, allergens in regional['regional_allergens'].items():
            region_name = region.capitalize()
            print(f"  {region_name:12} {len(allergens):3} allergens")
            
        print(f"\n🆕 NEW ALLERGENS DISCOVERED")
        if coverage['new_allergens']:
            by_category = defaultdict(list)
            for allergen in coverage['new_allergens']:
                category = coverage['allergen_details'][allergen]['category']
                by_category[category].append(allergen)
                
            for category, allergens in by_category.items():
                print(f"  {category.capitalize():8} {allergens}")
        else:
            print("  None found")
            
        if coverage['missing_allergens']:
            print(f"\n❓ NOT FOUND IN TEST (may be region/season specific)")
            print(f"  {coverage['missing_allergens']}")
            
        print(f"\n{chr(10).join(recommendations)}")

def main():
    """Main entry point."""
    data_file = os.path.join(os.path.dirname(__file__), "kleenex_allergen_test_data.json")
    
    analyzer = KleenexAllergenAnalyzer(data_file)
    if analyzer.run_analysis():
        print("\n✅ Analysis completed successfully!")
    else:
        print("\n❌ Analysis failed. Make sure to run kleenex_allergen_tester.py first.")

if __name__ == "__main__":
    main()