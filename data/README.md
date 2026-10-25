# Zouave offline data

Fetched **2026-10-25 (UTC)**. This is a hackathon snapshot, not an insurance,
regulatory, evacuation or building-level risk assessment. All delivered geometries
are 2D WGS84 **EPSG:4326**, in GeoJSON longitude/latitude order. No frontend or
runtime API client is included.

## Reproduce

Python 3.12 and Node 24 were used. Node may need adding to PATH:

```sh
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
python3.12 -m venv .venv
.venv/bin/pip install -r scripts/requirements-data.txt
npm install --prefix "$HOME/zouave-tools" mapshaper@0.6.113
export MAPSHAPER="$HOME/zouave-tools/node_modules/.bin/mapshaper"
.venv/bin/python scripts/prepare_data.py
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py' -v
.venv/bin/python scripts/validate_data.py
```

`data/raw/` is an ignored download cache. Remove individual cache files to refresh
them; upstream sources are mutable, so a later refresh is not guaranteed to be
byte-identical. `manifest.json` records the delivered files' byte sizes and SHA256.
The preparation script checks HTTP failures and WFS completeness/uniqueness; it
fails rather than silently manufacturing missing data. All requested sources were
reachable. The validation script checks local geometry and schemas before doing
live geocoding and hydrometry checks; it requires network access.

## Files and attribution

| File in `web/public/data/` | Features | Bytes | Properties |
| --- | ---: | ---: | --- |
| `ppri_aleas.geojson` | 202 | 383,520 | `classe`, `h_min`, `h_max`, `source` |
| `ppri_zonage.geojson` | 6 | 509,483 | `nom`, `codezone`, `source` |
| `caves_1910.geojson` | 595 | 357,950 | `objectid`, `cdep`, `source` |
| `sdrife_zone_inondable.geojson` | 1 | 1,149,194 | `source` |
| `batiments.geojson` | 22,506 | 8,507,550 | `h`, `source` |

Flood layers total **2,400,147 bytes**; buildings **8.51 MB** uncompressed.

### Paris PPRI hazards and zoning — DRIEAT / Préfecture

Licence: **Licence Ouverte / Open Licence 2.0**, as declared by data.gouv.fr.
Source CRS, verified from `.prj`: **EPSG:2154 (Lambert-93)**.

- Hazard catalogue: https://www.data.gouv.fr/datasets/plan-de-prevention-des-risques-naturels-inondation-de-la-seine-zones-daleas-paris
- Verified ZIP: https://atom.geo-ide.developpement-durable.gouv.fr/atomArchive/GetResource?id=d19372e8-9451-4e1b-a927-d6c2efb4eb37&dataType=dataset
- ZIP member: `dataset/N_ZONE_ALEA_PPRN_20130001_S_075.shp` (203 source features).
- Zoning catalogue: https://www.data.gouv.fr/datasets/plan-de-prevention-des-risques-dinondation-a-paris
- Verified ZIP: https://atom.geo-ide.developpement-durable.gouv.fr/atomArchive/GetResource?id=c0e04297-99a3-4230-8975-991c33c37e1b&dataType=dataset
- Zoning member: `dataset/N_ZONE_REG_PPRN_20130001_S_075.shp` (7,946 source features, dissolved by six `codezone` values).

`DESCRIPT` is normalized: `Aléa faible` → `0-1`, `Aléa moyen` → `1-2`,
`Aléa fort` → `2+`; `h_min` is 0/1/2 m and `h_max` is 1/2/**null**.
**Schema decision:** the open-ended `2+` class has no finite upper bound. JSON
cannot encode infinity; null is deliberately used instead of inventing a numeric
maximum. This is the one exception to the requested numeric `h_max` contract.
The source contains qualitative labels, not explicit numeric depth fields.
**Owner-confirmed mapping:** 0–1 / 1–2 / >2 m, termed **modéré / fort / très fort**
in the regional convention. The UI displays depths, never “aléa moyen”.
The 1 m boundary is directly verified in the Ville de Paris presentation and
the 2003 presentation p.22 (dark blue: potentially more than one metre).
The 2 m boundary is confirmed by consistency, not an independently read numeric
legend in the source shapefile. The owner's spatial cross-check of hazards against
zoning found faible 72% light blue, moyen 76% dark blue, fort 59% red. These
percentages are corroboration, not a substitute for a parcel-level assessment.
Ville de Paris presentation:
https://cdn.paris.fr/paris/2019/07/24/64f1ae7872a6521d629e5b8e2e432143.pdf
Class counts: `0-1`: 50, `1-2`: 78, `2+`: 74.

Reference report, successfully downloaded:
https://www.prefectures-regions.gouv.fr/content/download/12314/84310/file/PPRI2003-pr%C3%A9sentation.pdf
It models the **1910 water levels (8.62 m at Austerlitz)** on the mapped terrain,
not a literal copy of the historical 1910 footprint. It explicitly does not account
for all reservoir/protection/hydraulic changes. Its indicative precision is ±30 cm
vertically and ±25 m horizontally, with interpolated block interiors. Do not call
this a current real-time flood prediction.

### Flooded cellar sectors — Ville de Paris

Licence: **Open Database License (ODbL) 1.0**:
https://opendatacommons.org/licenses/odbl/1-0/
Attribution: Direction de la Prévention et de la Protection, Ville de Paris.
This derived cellar database remains available here under ODbL; keep attribution
and applicable share-alike obligations when redistributing it.

- Catalogue: https://opendata.paris.fr/explore/dataset/zones-de-caves-inondees-1910/
- Verified GeoJSON export: https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/zones-de-caves-inondees-1910/exports/geojson
- Export CRS: WGS84 EPSG:4326 (API GeoJSON).

These are sectors of flooded cellars **under a 1910-type scenario**, not evidence
that a particular cellar actually flooded in 1910. Full source coverage is kept
(including areas beyond Paris); `cdep=0` means beyond Paris/petite couronne.

### Application references (verified 2026-10-25)

- DRIEAT, *Synthèse de la crue de janvier 1910 sur le bassin de la Seine*,
  section 1.3/1.4: maximum **8.62 m at Paris-Austerlitz on 28 January 1910**.
  https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/bilan_1910_cle7c8919.pdf
- DRIEAT, *Stratégie inondation francilienne*, approved December 2023,
  **page 3, footnote 1** explicitly describes **115% of January 1910 discharges,
  9.1 m at Paris-Austerlitz**. This verifies the extreme scenario gauge reference,
  not a local depth in the SDRIF-E footprint. The application returns both this
  URL and the SDRIF-E source, and never extrudes that footprint.
  https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/strategie_inondation_idf_v231121.pdf
- The 2003 Paris PPRI presentation, **page 4**, also lists 8.62 m for 1910;
  **page 8** explains the hydraulic/terrain interpolation and ±30 cm vertical,
  ±25 m horizontal indicative precision. The 2007 regulation and 2003 presentation
  were downloaded and checked. Page 22 explicitly separates light/dark blue at
  one metre. The complete class mapping is now owner-confirmed as described above.
- Safety wording was checked against https://www.paris.fr/pages/crues-5472,
  https://www.georisques.gouv.fr/me-preparer-me-proteger/que-faire-en-cas-d-inondation
  and the Paris DICRIM https://www.georisques.gouv.fr/DICRIM/75056.

### Offline basemap and UI assets

`web/public/data/paris.pmtiles` is a 38 MB OpenStreetMap/Protomaps extract from
https://build.protomaps.com/20261024.pmtiles, fetched 2026-10-25, WGS84/Web Mercator
vector tiles, bbox 2.22,48.80,2.48,48.92, maximum zoom 15 (581 tiles). OSM data is
ODbL: https://www.openstreetmap.org/copyright. Attribution is shown on the map.
Reproduce with the standalone go-pmtiles 1.31.2 CLI:

```sh
pmtiles extract https://build.protomaps.com/20261024.pmtiles \
  web/public/data/paris.pmtiles --bbox=2.22,48.80,2.48,48.92 --maxzoom=15
```

Local Noto Sans glyph ranges (Latin, Latin extended and punctuation) and v4 dark
sprites come from https://protomaps.github.io/basemaps-assets/ (Protomaps BSD-3-Clause;
Noto Sans SIL OFL). The local Manrope Latin variable font comes from Google Fonts
(SIL OFL). Font license texts are bundled in `web/public/fonts/`.
The bundled level snapshot is the previously verified 1.021 m observation from
2026-10-25 09:00 UTC; the server always marks it stale. Geocode fallback points
are the four previously verified IGN addresses, never a generic search fallback.

### SDRIF-E zone potentially at flood risk

Attribution: **Région Île-de-France / L'Institut Paris Region**.
Licence: **Licence Ouverte 2.0 (Etalab)**. Source CRS: **EPSG:2154**.

- Catalogue: https://data.iledefrance.fr/explore/dataset/zone-inondable-sdrif-e/
- Verified ZIP: https://data.iledefrance.fr/api/v2/catalog/datasets/zone-inondable-sdrif-e/attachments/zone_inondable_sdrif_e_zip
- Member: `Zone_inondable_-_SDRIF-E.shp`.

Clipped to `[2.20, 48.80, 2.50, 48.92]`. This is a **composite planning footprint**:
the official metadata explicitly combines PPRI, PHEC in Bassée-Montois, and
**scenario 1.15 in the Métropole du Grand Paris**. It does not contain depths or
per-feature scenario identifiers. The user-provided 9.1 m Austerlitz interpretation
was not independently established from this file. The official intended scale is
**1:150,000**: do not imply building-level precision at zoom 16.

### Buildings — IGN BD TOPO, not Paris Volumes bâtis

Licence: **Licence Ouverte 2.0**. Catalogue:
https://www.data.gouv.fr/datasets/bd-topo-r

- Verified WFS endpoint: https://data.geopf.fr/wfs/ows
- Layer: `BDTOPO_V3:batiment`, WFS 2.0, GeoJSON, `srsName=EPSG:4326`.
- Query BBOX in WFS EPSG axis order:
  `48.825,2.25,48.865,2.405,urn:ogc:def:crs:EPSG::4326`.
- Pages of 5,000, sorted by `cleabs`, with unique-ID and matched-count checks.
- Clip: query rectangle intersected with a **250 m buffer of the Paris PPRI
  floodplain** (buffer/clip in Lambert-93). This includes Bercy and the riverside
  12th arrondissement, but is intentionally not all Paris/petite couronne.
- `h` is the source's **`hauteur` in metres**, only known positive values retained.
  Geometry Z values are removed; `h` supplies browser extrusion height.
- Height definition: ground to high gutter point, not necessarily roof ridge:
  https://documentation.geoservices.ign.fr/batiment&BDTopo

Paris `volumesbatisparis` was inspected and deliberately **not used**: its
`h_et_max` is a **number of storeys, not metres**. Verified explanatory PDF:
https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/volumesbatisparis/attachments/volumes_batis_paris_pdf
No guessed storey-to-metre conversion is made.

## Geometry processing and checks

Shapely `make_valid`, polygon extraction, reprojection, mapshaper Douglas-Peucker
with `keep-shapes` (0.4 m flood layers, 0.2 m buildings), 6 decimal coordinate
precision, then a second Shapely repair. Mapshaper reports unresolved intersections
in the source-derived topology; final features were individually checked and are
all valid, nonempty polygons/multipolygons. This does not establish global topology
or eliminate cross-feature overlaps. One hazard source feature has no polygonal
area after repair and is excluded; tiny non-polygon remnants are not delivered.
Some tiny building geometries disappear at coordinate rounding. Source zoning
also emits a GDAL winding-order warning, corrected on read, not an environment
failure. No browser/visual zoom-16 check has been performed.

## Live API checks and demo addresses

Both endpoints were verified with curl on 2026-10-25. No deprecated address API
was used.

```sh
curl 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr?code_entite=F700000103&grandeur_hydro=H&size=1&sort=desc'
curl -G 'https://data.geopf.fr/geocodage/search' \
  --data-urlencode 'q=20 quai de la Rapée 75012 Paris' --data 'limit=1'
```

Hub'Eau JSON shape: object with `count`, `first`, `prev`, `next`, `api_version`,
`data` array. Observed `api_version=2.0.1`, `count=8053`; latest returned observation:
`code_station=F700000103`, `grandeur_hydro=H`,
`date_obs=2026-10-25T09:00:00Z`, **`resultat_obs=1021.0 mm` = 1.021 m**,
`libelle_statut=Brute`, `libelle_qualification_obs=Non qualifiée`.
This is a gauge reading, not water depth at an address. Units independently
confirmed at https://hubeau.eaufrance.fr/page/api-hydrometrie (mm for height).
A subsequent Python validation request to Hub'Eau timed out after 60 seconds;
local data and all four address checks completed before that transient failure.

Géoplateforme returns a GeoJSON `FeatureCollection` with `features` and `query`.
The first feature is a Point with longitude/latitude coordinates; its `properties`
include `label`, `score`, `housenumber`, `id`, `banId`, `postcode`, `citycode`,
`district`, `type`. For 20 Quai de la Rapée: type `housenumber`, citycode `75112`,
score `0.9761090909090908`, id `75112_8037_00020`.

Shapely point-in-polygon (`covers`, boundaries included) on the **delivered** data:

| Geocoded address | Latitude | Longitude | PPRI class | In cellar sector |
| --- | ---: | ---: | --- | --- |
| 20 Quai de la Rapée 75012 Paris | 48.840482 | 2.374491 | `1-2` | Yes |
| 24 Quai de la Rapée 75012 Paris | 48.840616 | 2.374334 | `1-2` | Yes |
| 4 Rue Traversière 75012 Paris | 48.844929 | 2.369632 | `1-2` | Yes |
| 230 Rue de Bercy 75012 Paris | 48.846486 | 2.370073 | `1-2` | Yes |

All are exact house-number matches in the 12th, not street-centroid fallbacks.
**Suggested persona address: 4 Rue Traversière** (or retain the originally
suggested 20 Quai de la Rapée, which also meets both polygon tests).
These are plausible street-level demo locations, not verified residential
ground-floor flats: building access, occupancy, floor level, cellar presence and
actual vulnerability have not been surveyed. Geocoded entrance positions and
generalized polygons do not prove a particular dwelling will flood.
