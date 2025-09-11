#!/usr/bin/env python3
"""
Kleenex Quick Test Script

A lightweight version of the allergen tester for quick validation and debugging.
Tests just a few locations to verify the API integration is working correctly.

Author: GitHub Copilot Agent
"""

import asyncio
import aiohttp
import json
import random
from datetime import datetime
from typing import Dict, Optional, Tuple
from bs4 import BeautifulSoup

# Quick test configuration - just a few strategic locations
TEST_LOCATIONS = [
    {"name": "London, UK", "lat": 51.5074, "lon": -0.1278, "region": "uk"},
    {"name": "Paris, France", "lat": 48.8566, "lon": 2.3522, "region": "fr"},
    {"name": "Rome, Italy", "lat": 41.9028, "lon": 12.4964, "region": "it"},
    {"name": "Amsterdam, Netherlands", "lat": 52.3676, "lon": 4.9041, "region": "nl"},
    {"name": "New York, USA", "lat": 40.7128, "lon": -74.0060, "region": "us"},
]

# Kleenex API regions configuration (from the actual integration)
REGIONS = {
    "fr": {
        "name": "France",
        "url": "https://www.kleenex.fr/api/sitecore/Pollen/GetPollenContent",
        "method": "get"
    },
    "it": {
        "name": "Italy", 
        "url": "https://www.it.scottex.com/api/sitecore/Pollen/GetPollenContent",
        "method": "post"
    },
    "nl": {
        "name": "Netherlands",
        "url": "https://www.kleenex.nl/api/sitecore/Pollen/GetPollenContent", 
        "method": "get"
    },
    "uk": {
        "name": "United Kingdom",
        "url": "https://www.kleenex.co.uk/api/sitecore/Pollen/GetPollenContent",
        "method": "get"
    },
    "us": {
        "name": "United States of America",
        "url": "https://www.kleenex.com/api/sitecore/Pollen/GetPollenContent",
        "method": "get"
    },
}

class KleenexQuickTester:
    def __init__(self):
        self.session = None
        
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
            
    async def fetch_pollen_data(self, lat: float, lon: float, region_code: str) -> Optional[Dict]:
        """Fetch pollen data from Kleenex API using correct endpoints and methods."""
        if region_code not in REGIONS:
            print(f"❌ Unknown region: {region_code}")
            return None
            
        region_config = REGIONS[region_code]
        url = region_config["url"]
        method = region_config["method"]
        params = {"lat": lat, "lng": lon}
        
        try:
            if method == "get":
                async with self.session.get(url, params=params) as response:
                    if response.status == 200:
                        html = await response.text()
                        return self.parse_pollen_data(html, lat, lon, region_code)
                    else:
                        print(f"❌ HTTP {response.status} for {lat},{lon}")
                        return None
            else:  # POST method for Italy
                async with self.session.post(url, data=params) as response:
                    if response.status == 200:
                        html = await response.text()
                        return self.parse_pollen_data(html, lat, lon, region_code)
                    else:
                        print(f"❌ HTTP {response.status} for {lat},{lon}")
                        return None
                    
        except Exception as e:
            error_msg = str(e)
            if "No address associated with hostname" in error_msg:
                print(f"❌ Network blocked: Cannot resolve {region_code} API endpoint")
                print(f"   This is likely due to restricted network environment")
                print(f"   The scripts should work in environments with internet access")
            else:
                print(f"❌ Error: {e}")
            return None
            
    def parse_pollen_data(self, html: str, lat: float, lon: float, region_code: str) -> Dict:
        """Parse pollen data from HTML response using the actual integration logic."""
        soup = BeautifulSoup(html, 'html.parser')
        
        result = {
            "location": {"lat": lat, "lon": lon, "region": region_code},
            "timestamp": datetime.now().isoformat(),
            "allergens": {"trees": {}, "grass": {}, "weeds": {}},
            "raw_details": {},
            "days_found": 0
        }
        
        # Parse day buttons (actual integration logic)
        day_results = soup.find_all("button", class_="day-link")
        result["days_found"] = len(day_results)
        
        if not day_results:
            print(f"   ⚠️  No day-link buttons found in HTML")
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
        
    async def test_location(self, location: Dict) -> Optional[Dict]:
        """Test a single location."""
        print(f"📍 Testing {location['name']} ({location['lat']}, {location['lon']})")
        
        data = await self.fetch_pollen_data(
            location["lat"], 
            location["lon"], 
            location["region"]
        )
        
        if data:
            # Count discovered allergens
            total_allergens = sum(len(category) for category in data["allergens"].values())
            print(f"   ✅ Found {total_allergens} allergens in {data['days_found']} days")
            
            # Show allergens by category
            for category, allergens in data["allergens"].items():
                if allergens:
                    allergen_names = list(allergens.keys())
                    print(f"   {category.capitalize():6} {allergen_names}")
                    
            # Show raw details for debugging
            if any(data["raw_details"].values()):
                print(f"   Raw details found: {[k for k, v in data['raw_details'].items() if v]}")
        else:
            print(f"   ❌ Failed to get data")
            
        return data
        
    async def run_quick_test(self):
        """Run quick test of a few strategic locations."""
        print("⚡ KLEENEX QUICK TEST")
        print("=" * 50)
        print("Testing a few strategic locations to verify API integration...")
        
        results = []
        all_allergens = set()
        
        for i, location in enumerate(TEST_LOCATIONS):
            if i > 0:
                # Short delay between requests
                delay = random.randint(2, 5)
                print(f"⏳ Waiting {delay}s...")
                await asyncio.sleep(delay)
                
            data = await self.test_location(location)
            if data:
                results.append(data)
                
                # Collect all unique allergens
                for category in data["allergens"].values():
                    all_allergens.update(category.keys())
                    
        print(f"\n📊 SUMMARY")
        print(f"Successful tests: {len(results)}/{len(TEST_LOCATIONS)}")
        print(f"Total unique allergens: {len(all_allergens)}")
        print(f"Allergens found: {sorted(list(all_allergens))}")
        
        if len(results) == 0:
            print(f"\n⚠️  No successful API calls were made.")
            print(f"This is likely due to network restrictions in the current environment.")
            print(f"The Kleenex API testing scripts require internet access to external domains.")
            print(f"In a normal environment with internet access, these scripts should work correctly.")
        
        # Save results
        output_file = "kleenex_quick_test_results.json"
        with open(output_file, 'w') as f:
            json.dump({
                "test_results": results,
                "summary": {
                    "total_allergens": len(all_allergens),
                    "allergens": sorted(list(all_allergens)),
                    "successful_tests": len(results),
                    "total_tests": len(TEST_LOCATIONS)
                },
                "timestamp": datetime.now().isoformat()
            }, f, indent=2, ensure_ascii=False)
            
        print(f"📁 Results saved to {output_file}")

async def main():
    """Main entry point."""
    print("This is a quick test to verify the Kleenex API integration works correctly.")
    print("For full allergen discovery, use kleenex_allergen_tester.py instead.\n")
    
    async with KleenexQuickTester() as tester:
        await tester.run_quick_test()

if __name__ == "__main__":
    asyncio.run(main())