#!/usr/bin/env python3
"""
Kleenex Pollen Radar API Allergen Discovery Tool

This script systematically tests the Kleenex Pollen Radar API across different regions
to discover all possible allergens that could be returned by the integration.

Based on the kleenex_pollenradar Home Assistant integration:
https://github.com/MarcoGos/kleenex_pollenradar

Author: GitHub Copilot Agent
"""

import asyncio
import aiohttp
import json
import random
import time
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from bs4 import BeautifulSoup
import os

# Region definitions with geographic boundaries and API configurations
REGIONS = {
    "france": {
        "name": "France",
        "code": "fr",
        "api_url": "https://www.kleenex.fr/api/sitecore/Pollen/GetPollenContent",
        "method": "get",
        "bounds": {
            "lat_min": 41.3, "lat_max": 51.1,
            "lon_min": -5.1, "lon_max": 9.6
        },
        "calls": 5  # Smaller region
    },
    "italy": {
        "name": "Italy", 
        "code": "it",
        "api_url": "https://www.it.scottex.com/api/sitecore/Pollen/GetPollenContent",
        "method": "post", 
        "bounds": {
            "lat_min": 35.5, "lat_max": 47.1,
            "lon_min": 6.6, "lon_max": 18.5
        },
        "calls": 5  # Smaller region
    },
    "netherlands": {
        "name": "Netherlands",
        "code": "nl",
        "api_url": "https://www.kleenex.nl/api/sitecore/Pollen/GetPollenContent",
        "method": "get",
        "bounds": {
            "lat_min": 50.8, "lat_max": 53.6,
            "lon_min": 3.4, "lon_max": 7.2
        },
        "calls": 5  # Smaller region
    },
    "uk": {
        "name": "United Kingdom",
        "code": "uk", 
        "api_url": "https://www.kleenex.co.uk/api/sitecore/Pollen/GetPollenContent",
        "method": "get",
        "bounds": {
            "lat_min": 49.9, "lat_max": 60.8,
            "lon_min": -10.7, "lon_max": 1.8
        },
        "calls": 10  # Larger region
    },
    "usa": {
        "name": "United States",
        "code": "us",
        "api_url": "https://www.kleenex.com/api/sitecore/Pollen/GetPollenContent", 
        "method": "get",
        "bounds": {
            "lat_min": 24.4, "lat_max": 49.4,
            "lon_min": -125.0, "lon_max": -66.9
        },
        "calls": 10  # Larger region
    }
}



class KleenexAllergenTester:
    def __init__(self, output_file: str = "kleenex_allergen_test_data.json"):
        self.output_file = output_file
        self.session = None
        self.results = {}
        
    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=30)
        headers = {
            "User-Agent": "Home Assistant (kleenex_pollenradar)",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        }
        self.session = aiohttp.ClientSession(
            timeout=timeout,
            headers=headers
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    def generate_random_coordinates(self, region_key: str) -> Tuple[float, float]:
        """Generate random coordinates within the specified region bounds."""
        region = REGIONS[region_key]
        bounds = region["bounds"]
        
        lat = random.uniform(bounds["lat_min"], bounds["lat_max"])
        lon = random.uniform(bounds["lon_min"], bounds["lon_max"])
        
        # Round to reasonable precision
        lat = round(lat, 4)
        lon = round(lon, 4)
        
        return lat, lon
        
    async def fetch_pollen_data(self, lat: float, lon: float, region_key: str) -> Optional[Dict]:
        """Fetch pollen data from Kleenex API using correct endpoints and methods."""
        region = REGIONS[region_key]
        url = region["api_url"]
        method = region["method"]
        region_code = region["code"]
        params = {"lat": lat, "lng": lon}
        
        try:
            if method == "get":
                async with self.session.get(url, params=params) as response:
                    if response.status == 200:
                        html = await response.text()
                        return self.parse_pollen_data(html, lat, lon, region_code)
                    else:
                        print(f"HTTP {response.status} for {lat},{lon} in {region_key}")
                        return None
            else:  # POST method for Italy
                async with self.session.post(url, data=params) as response:
                    if response.status == 200:
                        html = await response.text()
                        return self.parse_pollen_data(html, lat, lon, region_code)
                    else:
                        print(f"HTTP {response.status} for {lat},{lon} in {region_key}")
                        return None
                    
        except Exception as e:
            error_msg = str(e)
            if "No address associated with hostname" in error_msg:
                print(f"Network blocked: Cannot resolve {region_key} API endpoint")
            else:
                print(f"Error fetching data for {lat},{lon} in {region_key}: {e}")
            return None
            
    def parse_pollen_data(self, html: str, lat: float, lon: float, region_code: str) -> Dict:
        """Parse pollen data from HTML response using actual integration logic."""
        soup = BeautifulSoup(html, 'html.parser')
        
        result = {
            "location": {
                "lat": lat,
                "lon": lon,
                "region_code": region_code
            },
            "timestamp": datetime.now().isoformat(),
            "allergens": {
                "trees": {},
                "grass": {}, 
                "weeds": {}
            },
            "raw_details": {},
            "days_found": 0
        }
        
        # Parse day buttons (actual integration logic)
        day_results = soup.find_all("button", class_="day-link")
        result["days_found"] = len(day_results)
        
        if not day_results:
            return result
        
        # Process first day for allergen discovery
        first_day = day_results[0]
        
        # Parse individual allergen details using actual integration attribute mapping  
        pollen_detail_types = {
            "trees": "tree",
            "weeds": "weed", 
            "grass": "grass",
        }
        
        for pollen_type, detail_type in pollen_detail_types.items():
            detail_attr = f"data-{detail_type}-detail"
            detail_string = first_day.get(detail_attr, "")
            result["raw_details"][pollen_type] = detail_string
            
            # Parse individual allergens: "name,value,level|name,value,level|..."
            if detail_string:
                allergen_details = detail_string.split("|")
                for detail in allergen_details:
                    parts = detail.split(",")
                    if len(parts) >= 3:
                        name = parts[0].strip()
                        try:
                            value = float(parts[1]) if parts[1].strip() else 0
                        except (ValueError, TypeError):
                            value = 0
                        try:
                            level = int(parts[2]) if parts[2].strip().isdigit() else 0
                        except (ValueError, TypeError):
                            level = 0
                            
                        result["allergens"][pollen_type][name] = {
                            "value": value,
                            "level": level
                        }
        
        return result
        
    async def test_region(self, region_key: str) -> List[Dict]:
        """Test a specific region with multiple random coordinates."""
        region = REGIONS[region_key]
        num_calls = region["calls"]
        results = []
        
        print(f"\n🌍 Testing {region['name']} ({region['code']}) - {num_calls} locations")
        
        for i in range(num_calls):
            lat, lon = self.generate_random_coordinates(region_key)
            print(f"  📍 {i+1}/{num_calls}: {lat}, {lon}")
            
            data = await self.fetch_pollen_data(lat, lon, region_key)
            if data:
                results.append(data)
                
                # Show discovered allergens for this location
                total_allergens = 0
                for category in data["allergens"].values():
                    total_allergens += len(category)
                print(f"    ✅ Found {total_allergens} allergens in {data['days_found']} days")
            else:
                print(f"    ❌ Failed to get data")
                
            # Courtesy delay between API calls
            if i < num_calls - 1:  # Don't sleep after last call
                sleep_time = random.randint(3, 12)
                print(f"    ⏳ Sleeping {sleep_time}s...")
                await asyncio.sleep(sleep_time)
                
        return results
        
    def load_existing_data(self) -> Dict:
        """Load existing test data if file exists."""
        if os.path.exists(self.output_file):
            try:
                with open(self.output_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"⚠️  Warning: Could not load existing data: {e}")
        return {}
        
    def save_results(self):
        """Save results to JSON file, appending to existing data."""
        existing_data = self.load_existing_data()
        
        # Merge new results with existing data
        for region, data in self.results.items():
            if region not in existing_data:
                existing_data[region] = []
            existing_data[region].extend(data)
            
        # Add metadata
        existing_data["_metadata"] = {
            "last_updated": datetime.now().isoformat(),
            "total_regions": len(existing_data) - 1,  # -1 for metadata
            "script_version": "1.0",
            "description": "Kleenex Pollen Radar API allergen discovery data"
        }
        
        with open(self.output_file, 'w') as f:
            json.dump(existing_data, f, indent=2, ensure_ascii=False)
            
        print(f"\n💾 Results saved to {self.output_file}")
        
    def print_summary(self):
        """Print a summary of discovered allergens."""
        print("\n📊 DISCOVERY SUMMARY")
        print("=" * 50)
        
        all_allergens = set()
        region_counts = {}
        
        for region_key, region_data in self.results.items():
            region_allergens = set()
            for location in region_data:
                for category in location["allergens"].values():
                    for allergen in category:
                        region_allergens.add(allergen)
                        all_allergens.add(allergen)
            
            region_counts[region_key] = len(region_allergens)
            print(f"{REGIONS[region_key]['name']:15} {len(region_allergens):3} allergens")
            
        print(f"{'TOTAL UNIQUE':15} {len(all_allergens):3} allergens")
        print(f"\nUnique allergens found: {sorted(all_allergens)}")
        
    async def run_full_test(self):
        """Run the complete test suite across all regions."""
        print("🧪 KLEENEX ALLERGEN DISCOVERY TEST")
        print("=" * 50)
        print("This will test the Kleenex Pollen Radar API across multiple regions")
        print("to discover all possible allergens that could be returned.")
        print(f"\nOutput file: {self.output_file}")
        
        total_calls = sum(region["calls"] for region in REGIONS.values())
        estimated_time = total_calls * 7.5  # Average delay + request time
        print(f"Total API calls: {total_calls}")
        print(f"Estimated runtime: {estimated_time/60:.1f} minutes")
        
        start_time = time.time()
        
        for region_key in REGIONS.keys():
            region_results = await self.test_region(region_key)
            self.results[region_key] = region_results
            
        self.save_results()
        self.print_summary()
        
        elapsed = time.time() - start_time
        print(f"\n⏱️  Completed in {elapsed/60:.1f} minutes")

async def main():
    """Main entry point."""
    output_file = os.path.join(os.path.dirname(__file__), "kleenex_allergen_test_data.json")
    
    async with KleenexAllergenTester(output_file) as tester:
        await tester.run_full_test()

if __name__ == "__main__":
    asyncio.run(main())