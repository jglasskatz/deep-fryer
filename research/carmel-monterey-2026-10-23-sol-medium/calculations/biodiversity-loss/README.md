# Protected-land calculation: 2024 mapped conservation inventory

Final findings use the official CNRA CA Nature 2024 snapshot, `Release_Year=2024 AND reGAP IN (1,2)`. This is the state's mapped conservation inventory, not a legal parcel audit. The publisher methodology uniformly assigns operative Conservation Units when >80% of the area matches one GAP code (or combined GAP1/2). Thus accepted 2024 geometry is explicitly generalized. The official guide defines GAP1/2 as permanently protected with a biodiversity management emphasis. The archived 2024 county category query confirms all GAP1/2 categories are `DefaultSelection=Yes`, while GAP3/4 categories are `No`.

## Reproduce final calculation

Use Python with `shapely==2.2.0 pyproj==3.8.0 pyshp==3.1.6`:

```sh
python calculate.py
```

The script resolves paths relative to itself and needs no network. Inputs needed:

- `raw/conservation2024-features-*.json.gz` and `raw/conservation2024-ids.json` (complete archived responses)
- `raw/carmel-lafco-boundary.json`, `raw/monterey-census-boundary.json`, `raw/carmel-census-boundary.json`
- `raw/tl_2026_06053_faces.zip`

It writes `results.json`, `clipped-feature-areas.csv`, and compressed derived GeoJSON (EPSG:3310). `raw-manifest.json` contains exact URLs and SHA-256 hashes for archived inputs; `raw/download-provenance.json` additionally records initial boundary requests. `download2024.py` records the 2024 acquisition queries. `publish.py` writes findings and HTML from results; `render-exhibits.mjs` makes the PNG exhibits. Both final exhibits and the official guide text extract have been visually reviewed.

## Scope and method

The envelope `-122.1,35.7,-120.1,37.1` strictly contains Monterey County. Downloading by envelope avoids dropping protected units with imperfect county labels. All 2,125 candidate IDs returned; 1,316 belong to 2024 and 809 belong to the older 2023 snapshot. The older snapshot is excluded before union. Of the 2024 features, 517 have positive area within county land and 3 within local LAFCO city land.

Carmel boundary is the official Monterey County LAFCO Incorporated Cities_2 layer, `CITY='CARMEL BY-THE-SEA'`. County boundary is current Census TIGERweb GEOID 06053. Both were retrieved 2026-10-23; the local service does not state an effective boundary date. These include city limits only for Carmel and all incorporated and unincorporated county land for Monterey. The observation measures the 2024 conservation inventory against retrieved boundaries, not gains through 2026.

Census 2026 topological faces identify ocean, bays, lakes and other perennial water as `LWFLAG=P`; union all 1,485 such faces and subtract from both numerator and denominator. Intermittent water (`I`) remains Census land. Initial area-water files were rejected because 14 records contain ALAND, including one mixed ALAND/AWATER record; topological faces resolve this precisely. ArcGIS GeoJSON uses WGS84, Census shapefile uses NAD83. Coordinates use the common null geographic transform at this precision and then California Albers EPSG:3310 for equal-area measurement. Every geometry is made valid; protected polygons are unioned and intersected with land before area measurement. Acres divide m² by 4046.8564224.

## Final results

Carmel: 140,384.972633980 m² protected / 2,747,428.280958295 m² land = **5.109686524192514%** (34.689882215 / 678.904313420 acres); score **82.96771158602495**. Census place-boundary sensitivity gives 5.092243503%; local LAFCO governs the finding.

County: 1,564,208,099.1453793 m² protected / 8,499,610,982.289927 m² land = **18.403290484760014%** (386,524.239033349 / 2,100,299.614101260 acres); score **38.65569838413329**. Union removes 754.581983 m² overlap. Calculated land differs from Census AREALAND 8,499,610,214 m² by 768 m² (0.000009%); calculated water differs from Census AREAWATER by 103 m².

## Rejected newer data and other limitations

The 2026 layer was investigated first but cannot be treated as uniform protected-area geometry. It contains partial GAP-acre fractions inside operative units; e.g. Monterey State Beach has reGAP=1 but only 94.084% GAP1. Some GAP3/4 features also have qualifying fractions and `DefaultSelection=Yes`. Therefore neither clipping all GAP1/2 geometry nor summing current unit fractions into city limits gives an exact protected area. `raw/all-gap-county-attribute-statistics.json` and the archived 2026 records preserve this issue. None of the exploratory 2026 results is used by the final findings.

Generalization and omitted/misclassified conservation remain limitations: medium confidence is intentional. The first dynamic StoryMaps capture showed only a title and failed content review. Its source API was subsequently archived and a labelled faithful extract rendered. Official metadata/methodology/boundary captures accompany the clearly labelled derived calculation exhibits. Older guide/method definitions are methodological support, not old measurements substituted for recent observations.
