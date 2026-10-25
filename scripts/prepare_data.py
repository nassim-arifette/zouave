#!/usr/bin/env python3
"""Download official sources and prepare WGS84 demo layers (no web application)."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

import geopandas as gpd
import requests
from shapely import force_2d, make_valid
from shapely.geometry import box, MultiPolygon

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'
OUT = ROOT / 'web/public/data'
ATOM = 'https://atom.geo-ide.developpement-durable.gouv.fr/atomArchive/GetResource?id={}&dataType=dataset'
SOURCES = {
    'aleas': ATOM.format('d19372e8-9451-4e1b-a927-d6c2efb4eb37'),
    'ppri': ATOM.format('c0e04297-99a3-4230-8975-991c33c37e1b'),
    'sdrif': 'https://data.iledefrance.fr/api/v2/catalog/datasets/zone-inondable-sdrif-e/attachments/zone_inondable_sdrif_e_zip',
    'caves': 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/zones-de-caves-inondees-1910/exports/geojson',
}
BBOX = box(2.20, 48.80, 2.50, 48.92)


def download(url, path, params=None):
    if not path.exists():
        response = requests.get(url, params=params, timeout=180)
        response.raise_for_status()
        temporary = path.with_suffix(path.suffix + '.partial')
        temporary.write_bytes(response.content)
        temporary.replace(path)
    return path


def archive(name):
    path = download(SOURCES[name], RAW / f'{name}.zip')
    folder = RAW / name
    with zipfile.ZipFile(path) as zipped:
        zipped.extractall(folder)
    return gpd.read_file(next(folder.rglob('*.shp'))).to_crs(4326)


def write(frame, name, interval=0.4):
    frame = frame.copy()
    frame.geometry = force_2d(make_valid(frame.geometry))
    def polygons(geometry):
        if geometry is None:
            return []
        if geometry.geom_type == 'Polygon':
            return [geometry]
        return [polygon for part in getattr(geometry, 'geoms', []) for polygon in polygons(part)]
    frame.geometry = frame.geometry.map(lambda geometry: MultiPolygon(polygons(geometry)))
    frame = frame[~frame.geometry.is_empty]
    if frame.empty:
        raise ValueError(f'{name}: empty output')
    raw = RAW / f'{name}.geojson'
    raw.write_text(frame.to_json(drop_id=True), encoding='utf-8')
    target = OUT / f'{name}.geojson'
    subprocess.run([os.environ.get('MAPSHAPER', 'mapshaper'), str(raw),
                    '-simplify', 'dp', f'interval={interval}', 'keep-shapes',
                    '-o', 'force', 'format=geojson', 'precision=0.000001', str(target)], check=True)
    cleaned = gpd.read_file(target)
    cleaned.geometry = make_valid(cleaned.geometry)
    cleaned.geometry = cleaned.geometry.map(lambda geometry: MultiPolygon(polygons(geometry)))
    cleaned = cleaned[~cleaned.geometry.is_empty]
    target.write_text(cleaned.to_json(drop_id=True, separators=(',', ':')), encoding='utf-8')
    print(f'{target.name}: {len(cleaned)} features, {target.stat().st_size} bytes')


def buildings():
    # WFS 2 uses latitude/longitude for the EPSG:4326 BBOX; GeoJSON is lon/lat.
    params = dict(service='WFS', version='2.0.0', request='GetFeature',
                  typeNames='BDTOPO_V3:batiment', outputFormat='application/json',
                  srsName='EPSG:4326', bbox='48.825,2.25,48.865,2.405,urn:ogc:def:crs:EPSG::4326',
                  count=5000, sortBy='cleabs')
    url = 'https://data.geopf.fr/wfs/ows'

    def page(offset):
        path = download(url, RAW / f'buildings-{offset}.json', dict(params, startIndex=offset))
        data = json.loads(path.read_text())
        if data.get('type') != 'FeatureCollection':
            raise ValueError(f'Invalid WFS response: {path}')
        return data

    first = page(0)
    total = int(first['numberMatched'])
    features = first['features']
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(page, range(5000, total, 5000)):
            features.extend(result['features'])
    if len(features) != total or len({f['properties']['cleabs'] for f in features}) != total:
        raise ValueError('Incomplete or duplicated WFS pagination')
    frame = gpd.GeoDataFrame.from_features(features, crs=4326)
    frame['h'] = frame.hauteur
    frame = frame[frame.h.notna() & (frame.h > 0)]
    # Restrict to a 250 m buffer of the Paris floodplain, including Bercy/12e.
    flood = gpd.read_file(OUT / 'ppri_aleas.geojson').to_crs(2154)
    extent = gpd.GeoSeries([box(2.25, 48.825, 2.405, 48.865)], crs=4326).to_crs(2154).iloc[0]
    corridor = flood.geometry.union_all().buffer(250).intersection(extent)
    frame = frame.to_crs(2154)
    frame = frame[frame.intersects(corridor)].copy()
    frame.geometry = frame.geometry.intersection(corridor)
    frame = frame.to_crs(4326)
    frame['source'] = 'IGN BD TOPO'
    write(frame[['h', 'source', 'geometry']], 'batiments', 0.2)
    if (OUT / 'batiments.geojson').stat().st_size >= 30_000_000:
        raise ValueError('Buildings exceed 30 MB')


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    aleas = archive('aleas')
    classes = {'Aléa faible': ('0-1', 0, 1), 'Aléa moyen': ('1-2', 1, 2),
               'Aléa fort': ('2+', 2, None)}
    if not set(aleas.DESCRIPT).issubset(classes):
        raise ValueError('Unknown PPRI hazard class')
    for i, key in enumerate(['classe', 'h_min', 'h_max']):
        aleas[key] = aleas.DESCRIPT.map(lambda value: classes[value][i])
    aleas['source'] = 'DRIEAT PPRI Paris'
    write(aleas[['classe', 'h_min', 'h_max', 'source', 'geometry']], 'ppri_aleas')
    zonage = archive('ppri')
    zonage.geometry = make_valid(zonage.geometry)
    zonage = zonage.dissolve(by='codezone', as_index=False)
    zonage['source'] = 'DRIEAT PPRI Paris'
    write(zonage[['nom', 'codezone', 'source', 'geometry']], 'ppri_zonage')
    caves = gpd.read_file(download(SOURCES['caves'], RAW / 'caves.json')).to_crs(4326)
    caves['source'] = 'Ville de Paris - sectors of flooded cellars, 1910 scenario'
    write(caves[['objectid', 'cdep', 'source', 'geometry']], 'caves_1910')
    sdrif = archive('sdrif')
    sdrif.geometry = make_valid(sdrif.geometry).intersection(BBOX)
    sdrif['source'] = 'Région Île-de-France / Institut Paris Region SDRIF-E'
    write(sdrif[['source', 'geometry']], 'sdrife_zone_inondable')
    buildings()
    manifest = {p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in sorted(OUT.glob('*.geojson'))}
    (ROOT / 'data/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
