"""Captures each product's Home Depot listing photos into tools/photos/listings.json.

For every model in models/products/*/manifest.json it opens the listing
(the manifest's homeDepotUrl, else homedepot.com/s/<model>, which redirects
to the product when Home Depot sells it) and reads the listing's photo list
from the page. A listing is kept only when its model number matches exactly,
so a near match (another color, the old version) never shows as this product.

Which photos show the product in a home is picked by eye into
home-photos.json (indexes into each listing's photos, best first). After a
re-run, check those indexes still point at the same photos, then run
node tools/photos/build-product-photos.mjs to write js/product-photos.js.

Usage: python3 tools/photos/fetch_listing_photos.py [cache-dir]
"""

import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
IMAGE = re.compile(r"^https://images\.thdstatic\.com/productImages/(.+)_<SIZE>\.jpg$")


def products():
    for brand in sorted(os.listdir(os.path.join(ROOT, "models/products"))):
        path = os.path.join(ROOT, "models/products", brand, "manifest.json")
        if os.path.exists(path):
            for p in json.load(open(path))["products"]:
                yield p["mmn"], p.get("homeDepotUrl")


def page(url, cache, mmn):
    path = os.path.join(cache, re.sub(r"[^A-Za-z0-9-]", "_", mmn) + ".html")
    if not os.path.exists(path) or os.path.getsize(path) < 50000:
        subprocess.run(["curl", "-sS", "-L", "-m", "60", "-A", UA, "-H", "Accept-Language: en-US", url, "-o", path])
        time.sleep(1)
    return open(path, encoding="utf8", errors="replace").read()


def images(html):
    start = html.find('"images":[{"__typename":"Image"')
    if start < 0:
        return []
    i = start + len('"images":')
    depth = 0
    for end in range(i, len(html)):
        if html[end] == "[":
            depth += 1
        elif html[end] == "]":
            depth -= 1
            if depth == 0:
                break
    out = []
    for im in json.loads(html[i : end + 1]):
        m = IMAGE.match(im["url"])
        if m:
            out.append({"path": m.group(1), "type": im["type"]})
    return out


def same(a, b):
    return a.upper().replace("K-", "") == b.upper().replace("K-", "")


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".photo-cache")
    os.makedirs(cache, exist_ok=True)
    out = {}
    for mmn, url in products():
        html = page(url or "https://www.homedepot.com/s/" + mmn, cache, mmn)
        model = re.search(r'"modelNumber":"([^"]*)"', html)
        canonical = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        if not model or not same(model.group(1), mmn):
            continue
        out[mmn] = {"listing": canonical.group(1) if canonical else url, "images": images(html)}
    path = os.path.join(ROOT, "tools/photos/listings.json")
    note = json.load(open(path))["note"] if os.path.exists(path) else ""
    json.dump({"note": note, "products": out}, open(path, "w"), indent=1)
    print(len(out), "listings")


if __name__ == "__main__":
    main()
