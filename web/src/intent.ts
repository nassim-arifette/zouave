import { config } from './config.ts';
import { state, afficher_scenario, afficher_crue, aller_a, exposition, niveau_seine, photo_inondee, consignes } from './tools.ts';

export async function routeIntent(message: string) {
  const intent = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/chez moi|adresse|\b(?:rue|quai|avenue|boulevard|place|allee|impasse|passage|route|chemin|cours|square|voie|sentier|faubourg)\b|\b\d{5}\b/.test(intent)) {
    const address = /chez moi|mon adresse/.test(intent) ? config.demoAddress : message.replace(/^(?:va|aller|montre|emmene.moi)\s+(?:a|à|au)\s+/i, '');
    if (state.scenario === 'aujourdhui' && !state.timeline) await afficher_scenario({ scenario: '1910' });
    const point = await aller_a({ adresse: address });
    const result = await exposition({ lat: point.lat, lon: point.lon, scenario: state.scenario });
    if (state.scenario === 'pire') return `${point.label} : ${result.sdrife_en_zone ? 'dans' : 'hors'} l’emprise SDRIF-E. Hauteurs locales non publiées. Source : Institut Paris Région.`;
    const photo = result.hauteur_visuelle_m === null ? null : await photo_inondee({ hauteur: result.hauteur_visuelle_m });
    return `${point.label} : ${result.hauteur_texte}${result.classe ? ' d’eau dans le scénario de référence' : ''}. ${result.cave_inondee_1910 ? 'Votre adresse est dans un secteur de caves exposé au scénario 1910.' : 'Hors secteur de caves cartographié ; cela n’exclut pas un risque.'} Sources : PPRI de Paris, Ville de Paris. ${photo && !photo.affichee ? 'La photo simulée arrive bientôt. Préparons les bons réflexes.' : 'Regardons les bons réflexes.'}`;
  }
  const historical = intent.match(/\b(1658|1740|1955|2016|2026|115)\b/);
  if (historical) return (await afficher_crue({ annee: historical[1] })).description;
  if (/pire|extreme/.test(intent)) { const result = await afficher_scenario({ scenario: 'pire' }); return result.description; }
  if (/aujourd|actuel/.test(intent)) { const result = await afficher_scenario({ scenario: 'aujourdhui' }); return result.description; }
  if (/consigne|fais|faire|enfant|prepar|reflexe|conseil/.test(intent)) {
    const result = await consignes({ rez_de_chaussee: true, cave: true, enfants: true });
    return `${result.consignes.map(item => item.title).join('. ')}. Sources : ${[...new Set(result.consignes.map(item => item.source.split(' · ')[0]))].join(', ')}. Suivez toujours les consignes des autorités.`;
  }
  if (/niveau|hauteur.*seine|seine.*hauteur/.test(intent)) {
    const result = await niveau_seine();
    return `À Austerlitz, la Seine est mesurée à ${Number(result.hauteur_m).toLocaleString('fr-FR')} m, relevé du ${new Date(result.date_obs).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}. ${result.stale ? 'Attention : dernier relevé connu, connexion indisponible. ' : ''}Source : ${result.source}. Ce n’est pas une hauteur d’eau dans votre rue.`;
  }
  if (/photo|image|simulation.*rue/.test(intent)) {
    const result = await exposition({ ...state.address, scenario: state.scenario });
    if (!result.hauteur_visuelle_m || state.scenario !== '1910') return 'Choisissez d’abord le scénario de référence et une adresse dans son emprise.';
    const photo = await photo_inondee({ hauteur: result.hauteur_visuelle_m });
    return photo.affichee ? `Voici une simulation, pas une prévision. Crédit : ${photo.credit}.` : photo.error!;
  }
  if (/1910|crue|monte/.test(intent)) { const result = await afficher_scenario({ scenario: '1910' }); return `${result.description} Source : ${result.source}. Et chez vous ?`; }
  // Small talk keeps the conversation going without inventing facts: every number still comes from a tool above.
  if (/qui es|t'?es qui|tu es qui|presente|zouave|alma|statue/.test(intent)) return 'Je suis le Zouave du pont de l’Alma, soldat de pierre planté dans la Seine. Les Parisiens regardent l’eau monter le long de mes jambes ; en 1910, elle m’a atteint aux épaules. Je vous aide à comprendre les crues avec les données officielles. On regarde la crue de 1910 ?';
  if (/merci|super|genial|parfait|top\b/.test(intent)) return 'Avec plaisir ! Je veille sur la Seine jour et nuit. Voulez-vous voir votre adresse, ou les bons réflexes ?';
  if (/au revoir|bye|a bientot|bonne (?:journee|soiree)/.test(intent)) return 'À bientôt ! Si la Seine monte, je serai là, les pieds dans l’eau.';
  if (/^(?:bonjour|bonsoir|salut|coucou|hello|hey)\b|ca va|comment vas/.test(intent)) return 'Bonjour ! Toujours debout sous le pont de l’Alma, les pieds au frais. Demandez-moi de montrer 1910, de regarder votre adresse ou le niveau de la Seine aujourd’hui.';
  return 'Je ne suis qu’un soldat de pierre, mais je sais montrer la crue de 1910, regarder votre adresse, lire le niveau de la Seine ou rappeler les bons réflexes. Que voulez-vous voir ?';
}
