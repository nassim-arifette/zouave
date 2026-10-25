#!/usr/bin/env python3
"""Check static layers and record current API / demo-address evidence."""
import datetime
import json
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/data'


def main():
    layers = {}
    for path in sorted(OUT.glob('*.geojson')):
        frame = gpd.read_file(path)
        assert len(frame) > 0, path
        assert frame.is_valid.all() and not frame.is_empty.any(), path
        assert frame.crs.to_epsg() == 4326, path
        assert all(frame.geometry.geom_type.isin(['Polygon', 'MultiPolygon'])), path
        assert -180 <= frame.total_bounds[0] < frame.total_bounds[2] <= 180, path
        assert -90 <= frame.total_bounds[1] < frame.total_bounds[3] <= 90, path
        layers[path.stem] = frame
        print(f'PASS {path.name}: {len(frame)} valid nonempty WGS84 features; {path.stat().st_size} bytes')
    aleas = layers['ppri_aleas']
    assert set(aleas.classe) == {'0-1', '1-2', '2+'}
    for cls, low, high in [('0-1', 0, 1), ('1-2', 1, 2), ('2+', 2, None)]:
        part = aleas[aleas.classe == cls]
        assert (part.h_min == low).all()
        assert part.h_max.isna().all() if high is None else (part.h_max == high).all()
    assert layers['batiments'].h.gt(0).all()
    assert (OUT / 'batiments.geojson').stat().st_size < 30_000_000
    assert sum(p.stat().st_size for p in OUT.glob('*.geojson') if p.stem != 'batiments') < 5_000_000
    addresses = []
    for address in ['20 Quai de la Rapée', '24 Quai de la Rapée', '4 Rue Traversière', '230 Rue de Bercy']:
        response = requests.get('https://data.geopf.fr/geocodage/search',
                                params={'q': address + ' 75012 Paris', 'limit': 1}, timeout=60)
        response.raise_for_status()
        feature = response.json()['features'][0]
        assert feature['properties']['type'] == 'housenumber'
        assert feature['properties']['citycode'] == '75112'
        point = Point(feature['geometry']['coordinates'])
        classes = aleas.loc[aleas.covers(point), 'classe'].tolist()
        caves = bool(layers['caves_1910'].covers(point).any())
        assert classes == ['1-2'] and caves
        addresses.append({'geocoding': feature, 'ppri_classes': classes, 'in_caves_sector': caves})
        print(f"PASS {feature['properties']['label']}: lon={point.x}, lat={point.y}, PPRI={classes}, caves={caves}")
    # A point outside France must not acquire a flood class or cave sector.
    assert not aleas.covers(Point(0, 0)).any()
    assert not layers['caves_1910'].covers(Point(0, 0)).any()
    response = requests.get('https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr',
                            params={'code_entite': 'F700000103', 'grandeur_hydro': 'H', 'size': 1, 'sort': 'desc'}, timeout=60)
    response.raise_for_status()
    hydro = response.json()
    observation = hydro['data'][0]
    assert observation['code_station'] == 'F700000103' and observation['grandeur_hydro'] == 'H'
    print(f"PASS Hub'Eau: {observation['date_obs']} H={observation['resultat_obs']} mm")
    evidence = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'hubeau': hydro, 'addresses': addresses}
    (ROOT / 'data/verification.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
