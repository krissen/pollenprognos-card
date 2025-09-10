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
    {"name": "London, UK", "lat": 51.5074, "lon": -0.1278, "region": "UK"},
    {"name": "Paris, France", "lat": 48.8566, "lon": 2.3522, "region": "FR"},
    {"name": "Rome, Italy", "lat": 41.9028, "lon": 12.4964, "region": "IT"},
    {"name": "Amsterdam, Netherlands", "lat": 52.3676, "lon": 4.9041, "region": "NL"},
    {"name": "New York, USA", "lat": 40.7128, "lon": -74.0060, "region": "US"},
]

BASE_URL = "https://www.kleenex.co.uk/en-gb/pollen-forecast"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

class KleenexQuickTester:
    def __init__(self):
        self.session = None
        
    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(
            timeout=timeout,
            headers={"User-Agent": USER_AGENT}
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            
    async def fetch_pollen_data(self, lat: float, lon: float, region_code: str) -> Optional[Dict]:
        """Fetch pollen data from Kleenex API."""
        url = f"{BASE_URL}?lat={lat}&lng={lon}&region={region_code}"
        
        try:
            async with self.session.get(url) as response:
                if response.status == 200:
                    html = await response.text()
                    return self.parse_pollen_data(html, lat, lon, region_code)
                else:
                    print(f"❌ HTTP {response.status} for {lat},{lon}")
                    return None
                    
        except Exception as e:
            print(f"❌ Error: {e}")
            return None
            
    def parse_pollen_data(self, html: str, lat: float, lon: float, region_code: str) -> Dict:
        """Parse pollen data from HTML response."""
        soup = BeautifulSoup(html, 'html.parser')
        
        result = {
            "location": {"lat": lat, "lon": lon, "region": region_code},
            "timestamp": datetime.now().isoformat(),
            "allergens": {"trees": {}, "grass": {}, "weeds": {}},
            "raw_details": {}
        }
        
        # Parse individual allergen details
        for pollen_type in ["trees", "grass", "weeds"]:
            detail_attr = f"data-{pollen_type}-detail"
            detail_element = soup.find(attrs={detail_attr: True})
            
            if detail_element:
                detail_string = detail_element.get(detail_attr, "")
                result["raw_details"][pollen_type] = detail_string
                
                if detail_string:
                    allergen_details = detail_string.split("|")
                    for detail in allergen_details:
                        parts = detail.split(",")
                        if len(parts) >= 3:
                            name = parts[0].strip()
                            try:
                                value = float(parts[1]) if parts[1].strip() else 0
                            except ValueError:
                                value = 0
                            level = int(parts[2]) if parts[2].strip().isdigit() else 0
                            
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
            print(f"   ✅ Found {total_allergens} allergens")
            
            # Show allergens by category
            for category, allergens in data["allergens"].items():
                if allergens:
                    allergen_names = list(allergens.keys())
                    print(f"   {category.capitalize():6} {allergen_names}")
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