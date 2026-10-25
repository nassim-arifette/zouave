import './style.css';
import { config } from './config.ts';
import { map, mapReady } from './map.ts';
import { $, state, afficher_scenario, afficher_crue, aller_a, exposition, niveau_seine, photo_inondee, consignes, notify } from './tools.ts';
import { initializeTimeline } from './timeline.ts';
import { initializeVoice, toggleVoice } from './voice.ts';
import { initializeAvatar, animateAnswer, setSpeaking } from './avatar.ts';
let running = false;
async function routeIntent(message: string) {
  const intent = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const historical = intent.match(/\b(1658|1740|1955|2016|2026|115)\b/);
  if (historical) return (await afficher_crue({ annee: historical[1] })).description;
  if (/pire|extreme/.test(intent)) { const result = await afficher_scenario({ scenario: 'pire' }); return result.description; }
  if (/aujourd|actuel/.test(intent)) { const result = await afficher_scenario({ scenario: 'aujourdhui' }); return result.description; }
  if (/chez moi|adresse|rue|quai|avenue|boulevard/.test(intent)) {
    const address = /chez moi|mon adresse/.test(intent) ? config.demoAddress : message.replace(/^(?:va|aller|montre|emmene.moi)\s+(?:a|à|au)\s+/i, '');
    if (state.scenario === 'aujourdhui' && !state.timeline) await afficher_scenario({ scenario: '1910' });
    const point = await aller_a({ adresse: address });
    const result = await exposition({ lat: point.lat, lon: point.lon, scenario: state.scenario });
    if (state.scenario === 'pire') return `${point.label} : ${result.sdrife_en_zone ? 'dans' : 'hors'} l’emprise SDRIF-E. Hauteurs locales non publiées. Source : Institut Paris Région.`;
    const photo = result.hauteur_visuelle_m === null ? null : await photo_inondee({ hauteur: result.hauteur_visuelle_m });
    return `${point.label} : ${result.hauteur_texte}${result.classe ? ' d’eau dans le scénario de référence' : ''}. ${result.cave_inondee_1910 ? 'Votre adresse est dans un secteur de caves exposé au scénario 1910.' : 'Hors secteur de caves cartographié ; cela n’exclut pas un risque.'} Sources : PPRI de Paris, Ville de Paris. ${photo && !photo.affichee ? 'La photo simulée arrive bientôt. Préparons les bons réflexes.' : 'Regardons les bons réflexes.'}`;
  }
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
  return 'Je peux montrer le scénario de référence, regarder votre adresse, donner les consignes ou lire le niveau de la Seine. Choisissez un bouton pour commencer.';
}
export async function runIntent(message: string) {
  if (running || !message.trim()) return;
  running = true;
  setSpeaking(false);
  $('caption').textContent = 'Je consulte les données officielles…';
  $('input-caption').textContent = `Vous · ${message}`; $('input-caption').hidden = false;
  try { const answer = await routeIntent(message); $('caption').textContent = answer; animateAnswer(answer); }
  catch (error) { const text = error instanceof Error ? error.message : 'La donnée est indisponible.'; $('caption').textContent = text; notify(text); }
  finally { running = false; }
}
document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.intent!); }));
document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.scenario === 'pire' ? 'pire' : button.dataset.scenario === '1910' ? '1910' : 'aujourd’hui'); }));
$('chat-form').addEventListener('submit', event => { event.preventDefault(); const input = $<HTMLInputElement>('chat'); const message = input.value; input.value = ''; void runIntent(message); });
window.addEventListener('keydown', event => { if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || $<HTMLDialogElement>('photo-dialog').open) return; const button = document.querySelectorAll<HTMLButtonElement>('[data-intent]')[Number(event.key) - 1]; if (button) { event.preventDefault(); void runIntent(button.dataset.intent!); } });
$('mic').addEventListener('click', () => { void toggleVoice(); });
$('photo-close').addEventListener('click', () => $<HTMLDialogElement>('photo-dialog').close());
initializeAvatar();
initializeTimeline();
void initializeVoice();
void niveau_seine().catch(error => notify(error.message));
setInterval(() => { void niveau_seine().catch(error => notify(error.message)); }, 15 * 60_000);
void mapReady.catch(error => notify(`${error.message} — rechargez la page pour réessayer.`));
map.on('error', event => { console.warn('Map data error:', event.error.message); });
