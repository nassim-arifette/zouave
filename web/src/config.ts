export const config = {
  demoAddress: '4 Rue Traversière, 75012 Paris',
  demoPosition: { lon: 2.369632, lat: 48.844929 },
  initialCenter: [2.357, 48.850] as [number, number],
  waterExaggeration: 2,
  waterRenderer: 'three' as 'three' | 'extrusion',
  sources: {
    ppri: 'https://www.prefectures-regions.gouv.fr/content/download/12314/84310/file/PPRI2003-pr%C3%A9sentation.pdf',
    reference: 'https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/bilan_1910_cle7c8919.pdf',
    sdrif: 'https://data.iledefrance.fr/explore/dataset/zone-inondable-sdrif-e/',
    extremeReference: 'https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/strategie_inondation_idf_v231121.pdf',
    caves: 'https://opendata.paris.fr/explore/dataset/zones-de-caves-inondees-1910/',
    buildings: 'https://geoservices.ign.fr/bdtopo',
  },
};
