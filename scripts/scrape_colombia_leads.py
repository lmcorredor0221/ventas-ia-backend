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
    "Chrome/120.0 Safari/537.36"
)


SEEDS = [
    # Broad store directories by major city.
    ("Bogota tiendas", "https://www.findglocal.com/CO/Bogot%C3%A1/1492559-42/{page}"),
    ("Medellin tiendas", "https://www.findglocal.com/CO/Medell%C3%ADn/1493004-42/{page}"),
    ("Cali tiendas", "https://www.findglocal.com/CO/Cali/1493055-42/{page}"),
    ("Barranquilla tiendas", "https://www.findglocal.com/CO/Barranquilla/1492905-42/{page}"),
    ("Cartagena tiendas", "https://www.findglocal.com/CO/Cartagena/1492934-42/{page}"),
    ("Bucaramanga tiendas", "https://www.findglocal.com/CO/Bucaramanga/1492949-42/{page}"),
    # High-intent categories we already validated.
    ("Bogota cosmeticos", "https://www.findglocal.com/CO/Bogot%C3%A1/1492559-23/genre/144873802247220/Tienda%2Bde%2Bcosm%C3%A9ticos/{page}"),
    ("Medellin cosmeticos", "https://www.findglocal.com/CO/Medell%C3%ADn/1493004-23/genre/144873802247220/Tienda%2Bde%2Bcosm%C3%A9ticos/{page}"),
    ("Cali cosmeticos", "https://www.findglocal.com/CO/Cali/1493055-23/genre/144873802247220/Tienda%2Bde%2Bcosm%C3%A9ticos/{page}"),
    ("Barranquilla cosmeticos", "https://www.findglocal.com/CO/Barranquilla/1492905-23/genre/144873802247220/Tienda%2Bde%2Bcosm%C3%A9ticos/{page}"),
    ("Bogota autopartes", "https://www.findglocal.com/CO/Bogot%C3%A1/1492559-28/genre/1628617144122365/Tienda%2Bde%2Bpiezas%2Bde%2Bautom%C3%B3viles/{page}"),
    ("Medellin autopartes", "https://www.findglocal.com/CO/Medell%C3%ADn/1493004-28/genre/1628617144122365/Tienda%2Bde%2Bpiezas%2Bde%2Bautom%C3%B3viles/{page}"),
    ("Bogota coleccionables", "https://www.findglocal.com/CO/Bogot%C3%A1/1492559-42/genre/187679647929203/Tienda%2Bde%2Bart%C3%ADculos%2Bcoleccionables/{page}"),
    ("Medellin reposteria", "https://www.findglocal.com/CO/Medell%C3%ADn/1493004-39/genre/187153754656815/Tienda%2Bde%2Breposter%C3%ADa/{page}"),
]


CATEGORY_RULES = [
    ("Belleza / cuidado personal", r"skincare|cuidado facial|maquillaje|makeup|cosm[eé]tic|belleza|labial|rubor|pesta[ñn]a|capilar|shampoo|perfume|parfum|fragancia|crema|facial|corporal|uñas|nails"),
    ("Moda / calzado", r"ropa|moda|boutique|camisa|pantal[oó]n|body|zapato|sneaker|tenis|gorras|uniforme|vestido|outfit|prenda"),
    ("Tecnologia / gadgets", r"tecnolog|celular|aud[ií]fono|cargador|telefono|tel[eé]fono|televisor|intercomunicador|computador|laptop|gaming|videojuego|consola|iphone"),
    ("Hogar / decoracion", r"hogar|mueble|vela|aroma|deco|cocina|zapatero|organizador|jard[ií]n|iluminaci[oó]n|ferreter"),
    ("Accesorios / joyeria", r"joyer|accesorio|oro|plata|manilla|collar|cadena|arete|bisuter"),
    ("Salud / bienestar", r"suplemento|bienestar|salud|vitamina|natural|fitness|deporte|gym|ergonom"),
    ("Alimentos / bebidas", r"comida|bebida|caf[eé]|postre|brownie|chocolate|panader|reposter|licor|vinos|cervezas"),
    ("Auto / moto accesorios", r"autoparte|repuesto|moto|veh[ií]culo|carro|luces led|tuning|llanta|yamaha"),
    ("Juguetes / coleccionables", r"juguete|coleccion|coleccionable|figura|manga|hobbies|toy|hot wheels|videojuego"),
]


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def clean(text):
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def abs_url(url):
    return urllib.parse.urljoin("https://www.findglocal.com", html.unescape(url))


def normalize_phone(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10 and digits.startswith("3"):
        digits = "57" + digits
    if len(digits) == 12 and digits.startswith("57"):
        return "+" + digits
    return ""


def extract_phones(text):
    phones = OrderedDict()
    patterns = [
        r"(?:\+?57[\s\-\u00a0]*)?3\d{2}[\s\-\u00a0]*\d{3}[\s\-\u00a0]*\d{4}",
        r"wa\.me/(57\d{10})",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.I):
            phone = normalize_phone(match if isinstance(match, str) else match[0])
            if phone:
                phones[phone] = True
    return list(phones)


def classify(text):
    low = text.lower()
    for category, pattern in CATEGORY_RULES:
        if re.search(pattern, low, flags=re.I):
            return category
    return "Otros / revisar"


def priority(category, city, phone, evidence):
    score = 0
    if category != "Otros / revisar":
        score += 2
    if category == "Belleza / cuidado personal":
        score += 2
    if re.search(r"Bogot|Medell|Cali|Barranquilla|Cartagena", city or "", flags=re.I):
        score += 1
    if phone:
        score += 1
    if re.search(r"env[ií]os|tienda online|tienda virtual|whatsapp|cat[aá]logo|domicilio|contra entrega", evidence or "", flags=re.I):
        score += 1
    if score >= 5:
        return "A"
    if score >= 3:
        return "B"
    return "C"


def listing_links(page_html):
    links = OrderedDict()
    for href, label in re.findall(r'href="([^"]+/CO/[^"]+/\d+/[^"#?]+)[^"]*"[^>]*>(.*?)</a>', page_html, flags=re.I | re.S):
        label = clean(label)
        if not label or len(label) < 2:
            continue
        if any(bad in href.lower() for bad in ["/genre/", "/category/", "/search/"]):
            continue
        url = abs_url(href)
        links[url] = label
    return links


def parse_detail(url, fallback_name=""):
    doc = fetch(url)
    title = clean(re.search(r"<h1[^>]*>(.*?)</h1>", doc, flags=re.I | re.S).group(1)) if re.search(r"<h1[^>]*>(.*?)</h1>", doc, flags=re.I | re.S) else fallback_name
    title = title or fallback_name
    city = ""
    address_match = re.search(r"### Dirección(.*?)(?:###|Horario de Apertura|Categoría|$)", doc, flags=re.I | re.S)
    address_text = clean(address_match.group(1)) if address_match else ""
    city_match = re.search(r"\b(Bogot[aá]|Medell[ií]n|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|Armenia|C[úu]cuta|Ibagu[eé]|Villavicencio|Santa Marta)\b", address_text + " " + doc, flags=re.I)
    if city_match:
        city = city_match.group(1)
    category = ""
    category_match = re.search(r"### Categoría(.*?)(?:###|Teléfono|Página web|Dirección|$)", doc, flags=re.I | re.S)
    category_text = clean(category_match.group(1)) if category_match else ""
    body_text = clean(doc)
    phones = extract_phones(body_text)
    category = classify(" ".join([title, category_text, body_text[:2500]]))
    evidence = clean(" ".join([category_text, body_text[:700]]))
    return {
        "nombre": title,
        "ciudad": city,
        "categoria": category,
        "whatsapp": " / ".join(phones[:2]),
        "fuente": "FindGlocal",
        "url": url,
        "evidencia": evidence[:240],
    }


def load_existing(path):
    rows = []
    try:
        with open(path, newline="", encoding="utf-8-sig") as handle:
            rows.extend(csv.DictReader(handle))
    except FileNotFoundError:
        pass
    return rows


def dedupe_key(row):
    phone = row.get("whatsapp", "").split(" / ")[0].strip()
    if phone:
        return "phone:" + phone
    return "name:" + re.sub(r"\W+", "", (row.get("nombre", "") + row.get("ciudad", "")).lower())


def main():
    target = 500
    rows = load_existing("leads_colombia_ecommerce_whatsapp_100.csv")
    seen = OrderedDict((dedupe_key(row), True) for row in rows)
    detail_links = OrderedDict()

    for seed_name, pattern in SEEDS:
        for page in range(1, 61):
            url = pattern.format(page=page)
            try:
                doc = fetch(url)
            except Exception:
                if page > 5:
                    break
                continue
            links = listing_links(doc)
            if not links and page > 3:
                break
            for link, name in links.items():
                detail_links.setdefault(link, name)
            if len(detail_links) > 900:
                break
            time.sleep(0.08)
        if len(detail_links) > 900:
            break

    print(f"detail_links={len(detail_links)}")

    for idx, (url, name) in enumerate(detail_links.items(), start=1):
        if len(rows) >= target:
            break
        try:
            row = parse_detail(url, name)
        except Exception:
            continue
        key = dedupe_key(row)
        if key in seen:
            continue
        row["prioridad"] = priority(row["categoria"], row["ciudad"], row["whatsapp"], row["evidencia"])
        row["productos_aprox"] = ""
        if row["categoria"] == "Otros / revisar" and not row["whatsapp"]:
            continue
        seen[key] = True
        rows.append(row)
        if idx % 25 == 0:
            print(f"checked={idx} rows={len(rows)}")
        time.sleep(0.12)

    rows = sorted(
        rows,
        key=lambda r: (
            {"A": 0, "B": 1, "C": 2}.get(r.get("prioridad", "C"), 2),
            r.get("categoria", ""),
            r.get("ciudad", ""),
            r.get("nombre", ""),
        ),
    )[:target]

    fieldnames = ["prioridad", "nombre", "ciudad", "categoria", "productos_aprox", "whatsapp", "fuente", "url", "evidencia"]
    with open("leads_colombia_ecommerce_whatsapp_500.csv", "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    with_whatsapp = sum(1 for row in rows if row.get("whatsapp"))
    print(f"wrote=leads_colombia_ecommerce_whatsapp_500.csv rows={len(rows)} with_whatsapp={with_whatsapp}")


if __name__ == "__main__":
    main()
