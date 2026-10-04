# Galerie photos : restaurant et plats

Deux galeries coexistent dans PickEatGo :

| Galerie | Rôle | Maximum | Où la gérer |
|---|---|---|---|
| Photos du restaurant (le lieu) | Donner envie de venir : façade, salle, terrasse, cuisine, équipe. Fournit aussi la **bannière** de la page publique. | 10 photos | Tableau de bord → Paramètres → carte « 📷 Photos du restaurant » |
| Photos des plats | Donner envie de manger : plusieurs angles d'un même plat. | 5 photos par plat, photo principale comprise | Tableau de bord → Menu → formulaire du plat |

Les deux galeries utilisent la même visionneuse plein écran côté client.

## Pourquoi une galerie du lieu

Les photos des plats vendent le repas ; celles du lieu vendent la visite. Une façade permet
de reconnaître l'endroit dans la rue, la salle et la terrasse aident à choisir entre sur
place et à emporter, la cuisine et l'équipe rassurent. C'est ce qui distingue une page
« vivante » d'une simple liste de prix.

## Côté restaurateur

### Photos du restaurant (Paramètres)

- **Ajouter** : bouton « Ajouter des photos », sélection multiple possible. Formats JPEG,
  PNG ou WebP, 5 Mo maximum par image. Au-delà de 10 photos, l'ajout est refusé.
- **Légende** : champ texte sous chaque vignette (80 caractères max), par exemple
  « Façade », « Terrasse », « Salle principale ». Enregistrée à la sortie du champ.
- **Bannière** : la photo marquée 🖼 est la bannière. C'est l'image de couverture affichée
  en grand en haut de la page publique et sur la carte du restaurant dans « Populaires
  maintenant » sur l'accueil.
  - La première photo ajoutée devient automatiquement la bannière si le restaurant
    n'en avait pas.
  - Un clic sur 🖼 d'une autre photo la remplace.
  - Supprimer la photo bannière retire la bannière ; la page publique revient alors à la
    couleur de bannière et au logo.
- **Retirer** : croix sur la vignette, après confirmation « Retirer cette photo ? ».
- **Aperçu** : un clic sur la vignette ouvre la visionneuse en grand.

Conseil pour la bannière : une photo horizontale, lumineuse, sans texte incrusté, car le
nom du restaurant s'affiche par-dessus en blanc.

### Photos des plats (Menu)

- Dans le formulaire d'un plat, la zone photos accepte jusqu'à 5 images (sélection
  multiple).
- La première photo envoyée devient la photo principale si le plat n'en a pas. Elle
  apparaît sur la carte du plat ; les autres sont visibles dans la visionneuse.
- Chaque vignette propose ★ « Définir comme photo principale » et × « Retirer ».
- Les photos sont stockées sur Cloudinary dans `menus/<restaurant_id>/<item_id>`.

## Côté client

- **Page publique du restaurant** : la bannière occupe le haut de page et s'agrandit au
  toucher. En dessous, le bandeau « 📷 Photos du restaurant » défile horizontalement, avec
  les légendes.
- **Page de commande** : le bouton « Galerie » ouvre deux onglets, « 🏠 Le lieu » et
  « 🍽️ Les plats », chacun avec son nombre de photos.
- **Carte d'un plat** : un clic sur la photo ouvre la visionneuse sur ce plat, avec ses
  photos supplémentaires.
- **Visionneuse** : flèches, balayage tactile, clavier (←, →, Échap), compteur, légende
  et points de navigation. Composant `frontend/app/Lightbox.jsx`.

Sans photo du lieu, l'affichage reste celui d'avant : couleur de bannière et logo.

## Stockage des images

- En production, les images sont envoyées sur Cloudinary (dossier
  `restaurants/<id>/gallery` pour le lieu, dossier du plat pour les photos de plats).
  La suppression d'une photo détruit aussi le fichier Cloudinary.
- Sans configuration Cloudinary (développement local), les fichiers sont écrits dans
  `MEDIA_ROOT` et servis par Django en mode `DEBUG`.
- Le serializer ne construit une URL Cloudinary que si le nom stocké commence par le
  préfixe Cloudinary configuré (`is_cloudinary_name`), ce qui permet de mélanger des
  images locales et distantes.

## API

Toutes les routes de modification exigent le propriétaire du restaurant (ou un admin).
Les envois sont en `multipart/form-data`, champ `image`.

### Restaurant

| Méthode | Route | Effet |
|---|---|---|
| `POST` | `/api/v1/restaurants/{id}/photos/` | Ajoute une photo du lieu. Champ optionnel `caption`. Devient la bannière si le restaurant n'en a pas. |
| `PATCH` | `/api/v1/restaurants/{id}/photos/{photo_id}/` | Met à jour `caption`. |
| `POST` | `/api/v1/restaurants/{id}/photos/{photo_id}/` | Fait de cette photo la bannière. |
| `DELETE` | `/api/v1/restaurants/{id}/photos/{photo_id}/` | Retire la photo (et la bannière si c'était elle). |

Chaque réponse renvoie `{"restaurant": {...}}` avec le restaurant complet, dont :

- `gallery` : liste `[{ id, url, caption, order }]` ;
- `banner_url` : URL de la bannière ou `null`.

Modèle : `RestaurantPhoto` (`backend/apps/restaurants/models.py`), `MAX_PHOTOS = 10`,
relation `restaurant.gallery`.

### Plat

| Méthode | Route | Effet |
|---|---|---|
| `POST` | `/api/v1/menus/items/{id}/photos/` | Ajoute une photo (5 au total, principale comprise). Devient principale si le plat n'en a pas. |
| `POST` | `/api/v1/menus/items/{id}/photos/{photo_id}/` | Fait de cette photo la principale. |
| `DELETE` | `/api/v1/menus/items/{id}/photos/{photo_id}/` | Retire la photo. |

Le plat expose `image_url` (principale), `photos` (`[{ id, url, order }]`) et
`image_urls` (principale suivie des autres, prête pour la visionneuse).

Modèle : `MenuItemPhoto` (`backend/apps/menus/models.py`), `MAX_PHOTOS = 5`,
relation `item.photos`.

### Erreurs courantes

| Message | Cause |
|---|---|
| `Aucun fichier image fourni (champ 'image' requis).` | Champ `image` absent du multipart. |
| `L'image ne doit pas dépasser 5 MB.` | Fichier trop lourd. |
| `Format non supporté. Utilisez JPEG, PNG ou WebP.` | Type MIME refusé. |
| `Maximum 10 photos du restaurant.` / `Maximum 5 photos par plat.` | Quota atteint : retirer une photo d'abord. |
| `Photo introuvable.` | `photo_id` inexistant ou appartenant à un autre restaurant / plat. |

## Tests

- `backend/tests/test_restaurant_gallery.py` : ajout, légende, bannière automatique et
  manuelle, suppression, quota, refus pour un non-propriétaire.
- `backend/tests/test_photos.py` : photos de plats, quota de 5, photo principale.

```
cd backend && pytest tests/test_restaurant_gallery.py tests/test_photos.py
```
