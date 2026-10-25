# Historical flood timeline

The rule lives in `web/src/flood-level.ts`, independent of the map, DOM and voice.
Subtract 8.62 m from the Austerlitz level, then translate the whole PPRI depth
band by that difference. Positive bands are solid; bands crossing zero are
hatched “peut-être”; non-positive bands are dry. The official 1910 map is kept
official, including its lowest class. The open >2 m band never acquires a finite
upper bound. Display depths are rounded to one decimal, not presented as precision
of the underlying simplified polygons.

As explicitly requested, below 6.62 m (approximately 6.6 m), inland bands are
suppressed. Between 3.20 and 6.62 m the red PPRI zoning is used only as an indicative
berges/quais-bas proxy. It is not a measured historical inundation map. This
low-level override is essential: applying a shift to an unbounded >2 m class alone
would incorrectly keep inland areas “possibly flooded” even in 2016.

Above 8.62 m, the SDRIF-E footprint minus the PPRI polygons is hatched and labelled
“moins de 50 cm (estimation)”. The footprint is official; this depth is not.
The timeline uses flat solid/hatched overlays, leaving the existing Three.js water
implementation intact for the classic scenarios and a later renderer rework.

## Levels and sources

- 1658 8.96, 1740 8.05, 1799 7.65, 1802 7.62, 1924 7.32, 1955 7.12,
  1982 6.16 and 2001 5.21 m: DRIEE information reproduced by the Ville de Draveil:
  https://www.draveil.fr/fileadmin/draveil/MEDIA/Habitat_et_environnement/Urbanisme/crues_PPRI_urbanisme.pdf
  This is a municipal republication, not the original DRIEE archive. Old levels
  are referenced to the later Austerlitz scale, not literally measured there then.
- 1910 8.62 m: DRIEAT synthesis, already verified in data/README.md:
  https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/bilan_1910_cle7c8919.pdf
- 2016 6.10 m: DRIEAT return of experience:
  https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/rex4m_spc_smyl_mai_juin_2016_vf.pdf
- February 2026 3.54 m: France 3 reporting the 17 February reading:
  https://france3-regions.franceinfo.fr/paris-ile-de-france/paris/crue-de-la-seine-pres-d-une-vingtaine-de-voies-fermees-a-la-circulation-a-paris-ce-jeudi-jusqu-a-nouvel-ordre-3301782.html
  A primary archive was not located. The UI explicitly flags this and does not
  claim that reading is the maximum for the year.
- 1945 6.83, 1959 6.20, 2018 5.84 m: owner-supplied values, **primary sources not
  located**. Included as requested but visibly flagged “à vérifier”. Alternative
  accounts differ (notably for 2018); these values must not be silently promoted
  to verified measurements.
- 115% scenario 9.10 m: DRIEAT strategy p.3 footnote 1, already verified:
  https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/strategie_inondation_idf_v231121.pdf
- Today: live Hub'Eau station F700000103; any stale/offline fallback is explicitly
  labelled with its observation date, never silently called live.

## Consequence thresholds

Ville de Paris, “Fermeture des voies sur berges” explicitly lists initial closure
at 3.20 m and notes navigation stops at 4.30 m:
https://www.paris.fr/pages/crues-5472

SNCF explains preventive interruption at 4.75 m and water entry through ventilation
openings at 5.75 m:
https://monrercetlignev.transilien.com/2021/02/04/crue-de-la-seine-retrouvez-les-dernieres-infos-rer-c/
These are consequence reference thresholds, not current operating instructions.

## Address and photographs

The 4 Rue Traversière tests cover 1910 (1–2 m), 1658 (1.3–2.3 m),
1740 (0.4–1.4 m), 1955 (dry or up to 0.5 m), 2016/2026 (dry), and 115%
(1.5–2.5 m). Illustrations use available 0.5/1.5/2.5 m images, not new generated
photographs or a claim of measured water at that building. The extreme preset uses
the upper illustration rather than understating the band; 1955 is labelled
“peut-être”; dry presets show the original. Missing images fail independently of
the data. Source-photo attribution is retained; no parallax is added.

The future has no calendar date. The annual centennial probability of 1/100 gives
1 − 0.99^30 ≈ 26% over 30 years under a stationary independent-year assumption.
The latter is labelled estimated, not a climate projection or property probability.

Optional period photographs, climate projections, external Géorisques verification,
catastrophe orders and flood-marker APIs are not implemented by this step. No
“verified by Géorisques” claim is made without an API response.
