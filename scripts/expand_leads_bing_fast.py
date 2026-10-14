import csv
import os
import re
import time
from collections import OrderedDict

import expand_leads_bing as core


EXTRA_TERMS = {
    "Belleza / cuidado personal": [
        "maquillaje", "skincare", "perfumes", "cosméticos", "cuidado capilar",
        "productos de belleza", "barbería", "uñas", "dermocosmética",
    ],
    "Moda / calzado": [
        "tienda de ropa", "boutique", "zapatos", "sneakers", "ropa deportiva",
        "streetwear", "ropa mujer", "ropa hombre", "bolsos",
    ],
    "Tecnologia / gadgets": [
        "accesorios celulares", "gadgets", "tecnología", "videojuegos",
        "computadores", "audífonos", "cargadores", "smartwatch",
    ],
    "Hogar / decoracion": [
        "decoración hogar", "cocina hogar", "muebles", "organizadores",
        "ferretería", "iluminación", "jardinería", "electrodomésticos",
    ],
    "Accesorios / joyeria": [
        "joyería", "bisutería", "accesorios", "oro laminado", "relojes",
        "plata", "collares", "aretes",
    ],
    "Salud / bienestar": [
        "suplementos", "fitness", "vitaminas", "productos naturales",
        "bienestar", "deporte", "proteína", "creatina",
    ],
    "Alimentos / bebidas": [
        "repostería", "café", "chocolates", "licores", "alimentos saludables",
        "panadería", "postres", "vino",
    ],
    "Auto / moto accesorios": [
        "autopartes", "repuestos motos", "accesorios moto", "lujos carros",
        "tuning", "luces led carro", "llantas", "repuestos carros",
    ],
    "Juguetes / coleccionables": [
        "juguetes", "coleccionables", "figuras de acción", "manga",
        "hobbies", "cartas pokemon", "hot wheels", "anime store",
    ],
}


TEMPLATES = [
    '{term} {city} WhatsApp envíos Colombia tienda',
    '{term} {city} tienda online WhatsApp Colombia',
    '{term} {city} catálogo WhatsApp',
    '{term} {city} compra por WhatsApp',
    'site:findglocal.com/CO {city} {term} "WhatsApp"',
    'site:.com.co {city} {term} "WhatsApp"',
    'site:.com.co {city} {term} "envíos a toda Colombia"',
]


def key_for(row):
    phone = (row.get("whatsapp") or "").split(" / ")[0].strip()
    if phone:
        return "phone:" + phone
    return "url:" + (row.get("url") or "").split("?")[0].rstrip("/")


def from_result(url, title, snippet, fallback_category, fallback_city):
    text = " ".join([title, snippet, url])
    phones = core.phones_from(text)
    category = core.classify(text, fallback_category)
    city = core.city_from(text, fallback_city)
    evidence = core.clean(snippet or title)[:260]
    return {
        "prioridad": core.priority(category, city, " / ".join(phones[:2]), evidence),
        "nombre": core.clean(title)[:120],
        "ciudad": city,
        "categoria": category,
        "productos_aprox": "",
        "whatsapp": " / ".join(phones[:2]),
        "fuente": "Bing/Snippet",
        "url": url,
        "evidencia": evidence,
    }


def good_result(url, title, snippet):
    host = core.domain(url)
    if not host:
        return False
    text = " ".join([url, title, snippet]).lower()
    bad = [
        "wikipedia", "youtube.com", "linkedin.com", "reddit.com", "pdf",
        "empleo", "trabajo", "computrabajo", "indeed", "sena", "universidad",
        "mercadolibre.com.co", "falabella.com.co/category", "exito.com/",
        "mercadolibre.com", "support.google.com", "google.com", "terra.com.co",
        "lowyat.net", "bancodebogota.co", "bancolombia.com", "noticias",
        "eltiempo.com", "semana.com", "elespectador.com", "larepublica.co",
        "caracol.com.co", "bluradio.com", "infobae.com", "amazon.com",
        "aliexpress.com", "temu.com",
    ]
    if any(token in text for token in bad):
        return False
    commerce = r"tienda|shop|store|boutique|whatsapp|env[ií]os|cat[aá]logo|comprar|domicilio|distribuidor|mayorista|findglocal"
    product = r"maquillaje|skincare|perfume|cosm[eé]tic|ropa|zapato|sneaker|joyer|bisuter|accesorio|celular|gadgets|hogar|decoraci[oó]n|mueble|ferreter|suplement|fitness|reposter|caf[eé]|autoparte|moto|juguete|coleccionable|anime|uñas|barber"
    return bool(re.search(commerce, text, flags=re.I) and re.search(product, text, flags=re.I))


def main():
    target = int(os.environ.get("TARGET", "500"))
    rows = core.load_rows("leads_colombia_ecommerce_whatsapp_100.csv")
    seen = OrderedDict((key_for(row), True) for row in rows)
    queries = 0

    def write_rows():
        ordered = sorted(
            rows,
            key=lambda r: (
                {"A": 0, "B": 1, "C": 2}.get(r.get("prioridad", "C"), 2),
                r.get("categoria", ""),
                r.get("ciudad", ""),
                r.get("nombre", ""),
            ),
        )[:target]
        fields = ["prioridad", "nombre", "ciudad", "categoria", "productos_aprox", "whatsapp", "fuente", "url", "evidencia"]
        with open("leads_colombia_ecommerce_whatsapp_350.csv", "w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(ordered)

    for category, terms in EXTRA_TERMS.items():
        for city in core.CITIES:
            for term in terms:
                for template in TEMPLATES:
                    if len(rows) >= target:
                        break
                    query = template.format(term=term, city=city)
                    queries += 1
                    try:
                        results = []
                        for page in range(3):
                            results.extend(core.bing_results(query, page=page))
                            time.sleep(0.08)
                    except Exception as exc:
                        print(f"query_error {queries}: {exc}")
                        continue
                    for url, title, snippet in results:
                        if len(rows) >= target:
                            break
                        if not good_result(url, title, snippet):
                            continue
                        row = from_result(url, title, snippet, category, city)
                        key = key_for(row)
                        if key in seen:
                            continue
                        seen[key] = True
                        rows.append(row)
                        if len(rows) % 25 == 0:
                            write_rows()
                            print(f"rows={len(rows)} queries={queries}")
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
    out_path = f"leads_colombia_ecommerce_whatsapp_{target}.csv"
    with open(out_path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    with_phone = sum(1 for row in rows if row.get("whatsapp"))
    print(f"wrote={out_path} rows={len(rows)} with_whatsapp={with_phone} queries={queries}")


if __name__ == "__main__":
    main()
