import json
import sys

def load_jsonl(filepath):
    """Load JSONL file into a dictionary keyed by 'Major Code'."""
    data = {}
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            # Create a key like "MATH 101"
            key = f"{item['Major']} {item['Code']}".strip()
            data[key] = item
    return data

def load_scraped_data(filepath):
    """Load scraped data.min.json into a dictionary keyed by 'code'."""
    data = {}
    with open(filepath, 'r', encoding='utf-8') as f:
        content = json.load(f)
        # Handle if the root is a list or dict with "courses"
        courses = content.get("courses", []) if isinstance(content, dict) else content
        
        for course in courses:
            key = course.get("code", "").strip()
            data[key] = course
    return data

def normalize_credit(val):
    """Convert credit value to float for comparison, default to 0.0."""
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0

def main():
    if len(sys.argv) < 3:
        print("Usage: python compare_credits.py <scraped_json> <external_jsonl>")
        sys.exit(1)

    scraped_path = sys.argv[1]
    external_path = sys.argv[2]

    print(f"Loading scraped data from {scraped_path}...")
    scraped_data = load_scraped_data(scraped_path)
    
    print(f"Loading external data from {external_path}...")
    external_data = load_jsonl(external_path)

    print(f"Scraped courses: {len(scraped_data)}")
    print(f"External courses: {len(external_data)}")
    
    discrepancies = []
    missing_in_scraped = []
    missing_in_external = []
    matches = 0

    # Compare based on external data keys (assuming external is the "truth" or baseline)
    all_keys = set(scraped_data.keys()) | set(external_data.keys())
    
    for key in sorted(all_keys):
        scraped = scraped_data.get(key)
        external = external_data.get(key)

        if not scraped:
            missing_in_scraped.append(key)
            continue
        
        if not external:
            missing_in_external.append(key)
            continue

        # Compare Credits
        # Scraped keys: 'eng', 'bsc'   (null means the catalog stated nothing)
        # External keys: 'Engineering', 'Basic_Science'

        s_eng = normalize_credit(scraped.get("eng"))
        s_basic = normalize_credit(scraped.get("bsc"))
        
        e_eng = normalize_credit(external.get("Engineering"))
        e_basic = normalize_credit(external.get("Basic_Science"))

        if s_eng != e_eng or s_basic != e_basic:
            discrepancies.append({
                "course": key,
                "scraped": {"eng": s_eng, "basic": s_basic},
                "external": {"eng": e_eng, "basic": e_basic}
            })
        else:
            matches += 1

    # Report
    print("\n" + "="*40)
    print("COMPARISON REPORT")
    print("="*40)
    print(f"Total Matches: {matches}")
    print(f"Discrepancies: {len(discrepancies)}")
    print(f"Missing in Scraped: {len(missing_in_scraped)}")
    # print(f"Missing in External: {len(missing_in_external)}") # Less important probably
    
    if discrepancies:
        print("\n[!] Discrepancies found:")
        print(f"{'Course':<10} | {'Scraped (Eng/Basic)':<20} | {'External (Eng/Basic)':<20}")
        print("-" * 56)
        for d in discrepancies[:50]: # Show first 50
            s_fmt = f"{d['scraped']['eng']} / {d['scraped']['basic']}"
            e_fmt = f"{d['external']['eng']} / {d['external']['basic']}"
            print(f"{d['course']:<10} | {s_fmt:<20} | {e_fmt:<20}")
        
        if len(discrepancies) > 50:
            print(f"\n... and {len(discrepancies) - 50} more.")

    if missing_in_scraped:
        print("\n[?] Missing in Scraped Data (First 10):")
        print(", ".join(missing_in_scraped[:10]))

if __name__ == "__main__":
    main()
