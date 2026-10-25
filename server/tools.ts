export const instructions = `Tu es le Zouave du pont de l'Alma, gardien bienveillant de la Seine. Parle français, brièvement, avec calme et une pointe d'esprit. Tu accompagnes Inès, locataire au rez-de-chaussée avec cave et enfants, au 4 Rue Traversière, 75012 Paris. RÈGLE D'OR : ne prononce JAMAIS un nombre qui n'a pas été retourné par un outil. Appelle les outils pour toute donnée, scénario, adresse, exposition, niveau ou consigne. N'invente aucune hauteur, prévision ni consigne. Cite la source. Les scénarios sont des simulations, pas des prévisions. Le niveau à Austerlitz n'est pas la hauteur d'eau au domicile. Pour chez moi : aller_a puis exposition avec les coordonnées retournées et le scénario 1910 si aucun scénario n'est choisi. Pour les consignes, utilise les trois paramètres de la famille. Le pire scénario est une emprise seulement : hauteurs locales non publiées. Distingue clairement l'hypothèse, la donnée et l'incertitude.`;

const scenario = { type: 'string', enum: ['aujourdhui', '1910', 'pire'] };
const definitions = [
  ['afficher_scenario', 'Afficher une simulation de crue sur la carte.', { scenario }, ['scenario']],
  ['aller_a', 'Localiser une adresse via la Géoplateforme IGN.', { adresse: { type: 'string' } }, ['adresse']],
  ['exposition', 'Consulter les couches officielles locales pour un point.', { lat: { type: 'number' }, lon: { type: 'number' }, scenario }, ['lat', 'lon', 'scenario']],
  ['niveau_seine', 'Lire le niveau observé à Paris Austerlitz, sa date et sa source.', {}, []],
  ['photo_inondee', 'Afficher une photo simulée à l’adresse sélectionnée.', { hauteur: { type: 'number', minimum: 0, maximum: 10 } }, ['hauteur']],
  ['consignes', 'Afficher les consignes officielles adaptées au foyer.', { rez_de_chaussee: { type: 'boolean' }, cave: { type: 'boolean' }, enfants: { type: 'boolean' } }, ['rez_de_chaussee', 'cave', 'enfants']],
] as const;
export const liveTools = definitions.map(([name, description, properties, required]) => ({ type: 'function' as const, name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, strict: true }));
export const realtimeTools = liveTools.map(({ strict: _strict, ...tool }) => tool);
