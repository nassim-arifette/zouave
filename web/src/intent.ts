import { config } from './config.ts';
import * as tools from './tools.ts';
import { traced } from './trace.ts';
import { depthAtLevel, evidenceLabel, type Evidence, type FloodClass } from './flood-level.ts';

const { state } = tools;
// Typed questions go through the same announced tool calls as the voice agent, so the conversation shows its sources.
const { afficher_scenario, afficher_crue, aller_a, exposition, niveau_seine, photo_inondee, consignes } = traced({ afficher_scenario: tools.afficher_scenario, afficher_crue: tools.afficher_crue, aller_a: tools.aller_a, exposition: tools.exposition, niveau_seine: tools.niveau_seine, photo_inondee: tools.photo_inondee, consignes: tools.consignes }, 'local');

// English first (the demo language), French keywords kept so Parisian visitors can still type naturally.
const HOME = /\bmy (?:home|house|address|flat|apartment|place|street|building|cellar|basement)\b|chez moi|mon adresse/;
// Unambiguous street types anywhere; English-looking ones (place, route, square…) only after a house number.
const ADDRESS = /\b(?:rue|quai|avenue|boulevard|allee|impasse|chemin|faubourg)\b|\b\d+\s*(?:bis|ter)?\s*,?\s*(?:place|passage|route|cours|square|voie|sentier)\b|\b\d{5}\b|^(?:go to|take me to|fly to)\s/;
export async function routeIntent(message: string) {
  const intent = message.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (HOME.test(intent) || ADDRESS.test(intent)) {
    const address = HOME.test(intent) ? config.demoAddress : message.replace(/^(?:go to|take me to|fly to|va|aller|montre|emmene.moi)\s+(?:to\s+|a\s+|à\s+|au\s+)?/i, '');
    const point = await aller_a({ adresse: address });
    if (state.scenario === 'aujourdhui' && !state.timeline) await afficher_scenario({ scenario: '1910' });
    const result = await exposition({ lat: point.lat, lon: point.lon, scenario: state.scenario });
    const timeline = state.timeline;
    if (timeline) {
      // A timeline level is an estimate derived from the official 1910 classes: say so, and give the official reference.
      const band = result as unknown as { label?: string; evidence?: Evidence };
      const reference = result.classe ? depthAtLevel(result.classe as FloodClass, 8.62).label : 'outside the mapped footprint';
      return `${point.label}: ${band.label ?? result.hauteur_texte} (${evidenceLabel(band.evidence ?? 'Estimé')}) at the ${timeline.label} level, ${timeline.level.toLocaleString('en-GB')} m at Austerlitz. Official 1910 reference here: ${reference}. Source: Paris PPRI.`;
    }
    if (state.scenario === 'pire') return `${point.label}: ${result.sdrife_en_zone ? 'inside' : 'outside'} the SDRIF-E extreme footprint. Local depths are not published. Source: Institut Paris Région.`;
    const photo = result.hauteur_visuelle_m === null ? null : await photo_inondee({ hauteur: result.hauteur_visuelle_m });
    return `${point.label}: ${result.classe ? `${result.hauteur_texte} of water in the reference scenario` : result.hauteur_texte}. ${result.cave_inondee_1910 ? 'Your address is in a cellar sector exposed in the 1910 scenario.' : 'Outside the mapped cellar sectors; that does not rule out risk.'} Sources: Paris PPRI, City of Paris. ${photo && !photo.affichee ? 'The simulated photo is not available here. Let’s look at the right moves.' : 'Let’s look at the right moves.'}`;
  }
  const historical = intent.match(/\b(1658|1740|1955|2016|2026|115)\b/);
  if (historical) return (await afficher_crue({ annee: historical[1] })).description;
  if (/what (?:should|do|can) i do|prepare|advice|safety|instructions|children|\bkids?\b|consigne|fais|faire|enfant|prepar|reflexe|conseil/.test(intent)) {
    const result = await consignes({ rez_de_chaussee: true, cave: true, enfants: true });
    return `${result.consignes.map(item => item.title).join('. ')}. Sources: ${[...new Set(result.consignes.map(item => item.source.split(' · ')[0]))].join(', ')}. Always follow the authorities’ instructions.`;
  }
  if (/worst|worse|extreme|pire/.test(intent)) { const result = await afficher_scenario({ scenario: 'pire' }); return result.description; }
  if (/\b1910\b/.test(intent)) { const result = await afficher_scenario({ scenario: '1910' }); return `${result.description} Source: ${result.source}. What about your home?`; }
  if (/level|how high|gauge|niveau|hauteur.*seine|seine.*hauteur|\b(?:rising|rise|monte)\b.*\b(?:seine|now|today)\b|seine.*\b(?:rising|rise|monte)\b/.test(intent)) {
    const result = await niveau_seine();
    return `At Austerlitz, the Seine reads ${Number(result.hauteur_m).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m, measured ${new Date(result.date_obs).toLocaleString('en-GB', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. ${result.stale ? 'Careful: last known reading, the live connection is unavailable. ' : ''}Source: ${result.source}. That is not a water depth in your street.`;
  }
  if (/^today\b|current situation|aujourd|actuel/.test(intent)) { const result = await afficher_scenario({ scenario: 'aujourdhui' }); return result.description; }
  if (/photo|picture|image|simulation/.test(intent)) {
    const result = await exposition({ ...state.address, scenario: state.scenario });
    if (!result.hauteur_visuelle_m || state.scenario !== '1910') return 'First pick the reference scenario and an address inside its footprint.';
    const photo = await photo_inondee({ hauteur: result.hauteur_visuelle_m });
    return photo.affichee ? `Here is a simulation, not a forecast. Credit: ${photo.credit}.` : photo.error!;
  }
  if (/flood|rise|rising|crue|monte/.test(intent)) { const result = await afficher_scenario({ scenario: '1910' }); return `${result.description} Source: ${result.source}. What about your home?`; }
  // Small talk keeps the conversation going without inventing facts: every number still comes from a tool above.
  if (/who are you|introduce|qui es|t'?es qui|tu es qui|presente|zouave|alma|statue/.test(intent)) return 'I am the Zouave of the Pont de l’Alma, a stone soldier standing in the Seine. Parisians watch the water climb my legs; in 1910 it reached my shoulders. I help you understand floods with official data. Shall we look at 1910?';
  if (/thank|great|awesome|perfect|merci|super|genial|parfait|top\b/.test(intent)) return 'With pleasure! I watch over the Seine day and night. Shall we check your address, or the right moves?';
  if (/goodbye|\bbye\b|see you|au revoir|a bientot|bonne (?:journee|soiree)/.test(intent)) return 'À bientôt! If the Seine rises, I will be here, feet in the water.';
  if (/^(?:hello|hi|hey|good (?:morning|evening)|bonjour|bonsoir|salut|coucou)\b|how are you|ca va|comment vas/.test(intent)) return 'Bonjour! Still standing under the Pont de l’Alma, feet in the water. Ask me to show 1910, check your address, or read the Seine level today.';
  return 'I am only a stone soldier, but I can show the 1910 flood, check your address, read the Seine level or remind you of the right moves. What would you like to see?';
}
