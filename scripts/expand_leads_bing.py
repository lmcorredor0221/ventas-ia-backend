import csv
import html
import re
import time
import urllib.parse
import urllib.request
from collections import OrderedDict


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)


CITIES = [
    "Bogotá",
    "Medellín",
    "Cali",
    "Barranquilla",
    "Cartagena",
    "Bucaramanga",
    "Pereira",
    "Manizales",
    "Cúcuta",
    "Villavicencio",
]


CATEGORY_QUERIES = [
    ("Belleza / cuidado personal", ["maquillaje", "skincare", "perfumes", "productos de belleza", "cuidado capilar"]),
    ("Moda / calzado", ["tienda de ropa", "boutique", "zapatos", "sneakers", "ropa deportiva"]),
    ("Tecnologia / gadgets", ["gadgets", "accesorios celulares", "tecnología", "videojuegos", "computadores"]),
    ("Hogar / decoracion", ["hogar decoración", "cocina hogar", "organizadores hogar", "ferretería online", "muebles"]),
    ("Accesorios / joyeria", ["accesorios", "joyería", "bisutería", "oro laminado", "relojes"]),
    ("Salud / bienestar", ["suplementos", "fitness", "bienestar", "productos naturales", "vitaminas"]),
    ("Alimentos / bebidas", ["repostería", "café", "licores", "chocolates", "alimentos saludables"]),
    ("Auto / moto accesorios", ["autopartes", "accesorios moto", "repuestos motos", "lujos carros", "luces led carro"]),
    ("Juguetes / coleccionables", ["juguetes", "coleccionables", "manga", "figuras de acción", "hobbies"]),
]


BLOCKED_DOMAINS = {
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "tiktok.com",
    "linkedin.com",
    "pinterest.com",
    "reddit.com",
    "wikipedia.org",
    "mercadolibre.com.co",
}


def request(url, timeout=18):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "es-CO,es;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def clean(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def domain(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def normalize_phone(value):
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 10 and digits.startswith("3"):
        digits = "57" + digits
    if len(digits) == 12 and digits.startswith("57"):
        return "+" + digits
    return ""


def phones_from(text):
    phones = OrderedDict()
    for raw in re.findall(r"(?:\+?57[\s\-\.\u00a0]*)?3\d{2}[\s\-\.\u00a0]*\d{3}[\s\-\.\u00a0]*\d{4}", text or ""):
        phone = normalize_phone(raw)
        if phone:
            phones[phone] = True
    for raw in re.findall(r"(?:wa\.me/|phone=)(57\d{10})", text or "", flags=re.I):
        phone = normalize_phone(raw)
        if phone:
            phones[phone] = True
    return list(phones)


def classify(text, fallback):
    low = (text or "").lower()
    rules = [
        ("Belleza / cuidado personal", r"skincare|maquillaje|cosm[eé]tic|belleza|perfume|capilar|shampoo|facial|uñas|nails|barber"),
        ("Moda / calzado", r"ropa|moda|boutique|camisa|vestido|sneaker|zapato|calzado|tenis|outfit"),
        ("Tecnologia / gadgets", r"tecnolog|celular|aud[ií]fono|cargador|gaming|videojuego|computador|iphone|gadget"),
        ("Hogar / decoracion", r"hogar|decoraci[oó]n|cocina|mueble|ferreter|jard[ií]n|organizador"),
        ("Accesorios / joyeria", r"joyer|bisuter|accesorio|collar|arete|oro laminado|reloj"),
        ("Salud / bienestar", r"suplement|fitness|bienestar|vitamina|natural|gym|deporte"),
        ("Alimentos / bebidas", r"reposter|caf[eé]|licor|vino|cerveza|chocolate|alimentos|panader"),
        ("Auto / moto accesorios", r"autoparte|moto|repuesto|carro|veh[ií]culo|luces led|tuning"),
        ("Juguetes / coleccionables", r"juguete|coleccionable|manga|figura|hobbies|toy"),
    ]
    for category, pattern in rules:
        if re.search(pattern, low, flags=re.I):
            return category
    return fallback or "Otros / revisar"


def city_from(text, fallback=""):
    for city in CITIES:
        plain = city.replace("á", "a").replace("é", "e").replace("í", "i").replace("ú", "u")
        if re.search(city, text or "", flags=re.I) or re.search(plain, text or "", flags=re.I):
            return city
    return fallback


def priority(category, city, phone, evidence):
    score = 0
    if category != "Otros / revisar":
        score += 2
    if category == "Belleza / cuidado personal":
        score += 2
    if city in CITIES[:5]:
        score += 1
    if phone:
        score += 1
    if re.search(r"whatsapp|env[ií]os|tienda online|tienda virtual|cat[aá]logo|domicilio|compra", evidence or "", flags=re.I):
        score += 1
    if score >= 5:
        return "A"
    if score >= 3:
        return "B"
    return "C"


def bing_results(query, page=0):
    first = page * 10 + 1
    url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": query, "first": first, "setlang": "es-CO"})
    doc = request(url, timeout=20)
    results = []
    matches = list(re.finditer(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>\s*</h2>', doc, flags=re.I | re.S))
    for index, match in enumerate(matches):
        raw_url = html.unescape(match.group(1))
        title = clean(match.group(2))
        next_start = matches[index + 1].start() if index + 1 < len(matches) else min(len(doc), match.end() + 2500)
        block = doc[match.end():next_start]
        snippet_match = re.search(r'<p[^>]*>(.*?)</p>', block, flags=re.I | re.S)
        snippet = clean(snippet_match.group(1)) if snippet_match else ""
        parsed = urllib.parse.urlparse(raw_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "u" in qs:
            encoded = qs["u"][0]
            if encoded.startswith("a1"):
                try:
                    import base64

                    raw_url = base64.urlsafe_b64decode(encoded[2:] + "==").decode("utf-8", errors="replace")
                except Exception:
                    pass
        results.append((raw_url, title, snippet))
    return results


def parse_page(url, title, snippet, fallback_category, fallback_city):
    evidence = snippet
    phone = ""
    page_title = title
    try:
        doc = request(url, timeout=14)
        text = clean(doc)
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", doc, flags=re.I | re.S)
        if h1:
            page_title = clean(h1.group(1)) or page_title
        title_tag = re.search(r"<title[^>]*>(.*?)</title>", doc, flags=re.I | re.S)
        if title_tag and not page_title:
            page_title = clean(title_tag.group(1))
        evidence = clean(" ".join([snippet, text[:900]]))[:260]
        phones = phones_from(doc + " " + text)
        phone = " / ".join(phones[:2])
    except Exception:
        phones = phones_from(" ".join([title, snippet, url]))
        phone = " / ".join(phones[:2])
        evidence = clean(" ".join([snippet, url]))[:260]
    text_for_class = " ".join([page_title, snippet, evidence, url])
    category = classify(text_for_class, fallback_category)
    city = city_from(text_for_class, fallback_city)
    return {
        "prioridad": priority(category, city, phone, evidence),
        "nombre": page_title[:120],
        "ciudad": city,
        "categoria": category,
        "productos_aprox": "",
        "whatsapp": phone,
        "fuente": "Bing/Web",
        "url": url,
        "evidencia": evidence,
    }


def load_rows(path):
    try:
        with open(path, newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle))
    except FileNotFoundError:
        return []


def key_for(row):
    phone = (row.get("whatsapp") or "").split(" / ")[0].strip()
    if phone:
        return "phone:" + phone
    url = row.get("url") or ""
    host = domain(url)
    name = re.sub(r"\W+", "", (row.get("nombre") or "").lower())
    return "site:" + host + ":" + name[:40]


def useful_result(url, title, snippet):
    host = domain(url)
    if not host or any(host == d or host.endswith("." + d) for d in BLOCKED_DOMAINS):
        return False
    text = " ".join([url, title, snippet]).lower()
    if any(bad in text for bad in ["empleo", "trabajo", "pdf", "sena", "universidad", "noticias"]):
        return False
    return bool(re.search(r"tienda|whatsapp|env[ií]os|comprar|cat[aá]logo|shop|store|boutique|productos", text, flags=re.I))


def main():
    target = 500
    rows = load_rows("leads_colombia_ecommerce_whatsapp_100.csv")
    seen = OrderedDict((key_for(row), True) for row in rows)
    query_count = 0

    query_templates = [
        '"{term}" "{city}" "WhatsApp" "envíos a toda Colombia"',
        '"{term}" "{city}" "tienda online" "WhatsApp"',
        '"{term}" "{city}" "catálogo" "WhatsApp"',
        '"{term}" "{city}" "compra por WhatsApp"',
    ]

    for fallback_category, terms in CATEGORY_QUERIES:
        for city in CITIES:
            for term in terms:
                for template in query_templates:
                    if len(rows) >= target:
                        break
                    query = template.format(term=term, city=city)
                    query_count += 1
                    try:
                        results = []
                        for page in range(2):
                            results.extend(bing_results(query, page=page))
                            time.sleep(0.1)
                    except Exception as exc:
                        print(f"query failed: {query[:55]} {exc}")
                        continue
                    for url, title, snippet in results:
                        if len(rows) >= target:
                            break
                        if not useful_result(url, title, snippet):
                            continue
                        candidate = parse_page(url, title, snippet, fallback_category, city)
                        key = key_for(candidate)
                        if key in seen:
                            continue
                        if candidate["categoria"] == "Otros / revisar" and not candidate["whatsapp"]:
                            continue
                        seen[key] = True
                        rows.append(candidate)
                        if len(rows) % 25 == 0:
                            print(f"rows={len(rows)} queries={query_count}")
                        time.sleep(0.08)
                if len(rows) >= target:
                    break
            if len(rows) >= target:
                break
        if len(rows) >= target:
            break

    rows = sorted(
        rows,
        key=lambda r: (
            {"A": 0, "B": 1, "C": 2}.get(r.get("prioridad", "C"), 2),
            r.get("categoria", ""),
            r.get("ciudad", ""),
            r.get("nombre", ""),
        ),
    )[:target]

    fields = ["prioridad", "nombre", "ciudad", "categoria", "productos_aprox", "whatsapp", "fuente", "url", "evidencia"]
    with open("leads_colombia_ecommerce_whatsapp_500.csv", "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    with_phone = sum(1 for row in rows if row.get("whatsapp"))
    print(f"wrote rows={len(rows)} with_whatsapp={with_phone} queries={query_count}")


if __name__ == "__main__":
    main()
