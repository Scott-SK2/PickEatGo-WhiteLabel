"""
tenant/icons.py — Génération des icônes d'installation (PWA) à partir d'une image.

    build_icons(file_or_bytes, bg="#FF6B2C") → {"icon_192": bytes, "icon_512": bytes, "icon_maskable": bytes}

  - recadrage carré centré ;
  - 192 × 192 et 512 × 512 (PNG, fond transparent conservé) ;
  - « maskable » 512 × 512 : l'image occupe 80 % du canevas (zone sûre Android), sur fond `bg`.
"""
from io import BytesIO

from PIL import Image, ImageOps

SIZES = {"icon_192": 192, "icon_512": 512}
MASKABLE_SIZE = 512
SAFE_RATIO = 0.8     # Android masque jusqu'à 10 % de chaque bord


def _square(img):
    img = ImageOps.exif_transpose(img).convert("RGBA")
    side = min(img.size)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    return img.crop((left, top, left + side, top + side))


def _hex_to_rgb(color):
    color = (color or "#FF6B2C").lstrip("#")
    if len(color) == 3:
        color = "".join(c * 2 for c in color)
    try:
        return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return (255, 107, 44)


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build_icons(source, bg="#FF6B2C"):
    """`source` : fichier ouvert, chemin ou bytes. Retourne les trois PNG en mémoire."""
    if isinstance(source, (bytes, bytearray)):
        source = BytesIO(source)
    with Image.open(source) as raw:
        square = _square(raw)
    out = {}
    for key, size in SIZES.items():
        out[key] = _png(square.resize((size, size), Image.LANCZOS))
    inner = int(MASKABLE_SIZE * SAFE_RATIO)
    canvas = Image.new("RGBA", (MASKABLE_SIZE, MASKABLE_SIZE), _hex_to_rgb(bg) + (255,))
    logo = square.resize((inner, inner), Image.LANCZOS)
    offset = (MASKABLE_SIZE - inner) // 2
    canvas.alpha_composite(logo, (offset, offset))
    out["icon_maskable"] = _png(canvas.convert("RGB").convert("RGBA"))
    return out


def normalize_share_image(source, size=(1200, 630)):
    """Image de partage : recadrée au format 1200 × 630 (centrée), JPEG."""
    if isinstance(source, (bytes, bytearray)):
        source = BytesIO(source)
    with Image.open(source) as raw:
        img = ImageOps.exif_transpose(raw).convert("RGB")
        img = ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.5))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue()
