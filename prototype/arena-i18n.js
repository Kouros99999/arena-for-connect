/*
 * Arena languages. The pages are written in English; this file translates what people see.
 *
 * Dictionaries are keyed by the exact English text, so pages need no markup changes: apply() walks the text nodes,
 * placeholders, titles and option labels under a root, swaps any that match, and keeps watching for content the
 * pages render later (the panel and console redraw every few seconds). Translated text never matches an English
 * key, so it is never translated twice. Strings with numbers inside them stay in English in this version.
 *
 * Language: ?lang= in the URL, then the browser's saved choice (arena.lang), then the browser language, else English.
 * Plain script: defines window.ArenaI18n in a browser, module.exports in node (for tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LANGS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', 'pt-BR': 'Português' };

  // One row per English string: [es, fr, de, pt-BR]. Keep the English exactly as it appears on the pages.
  const ROWS = {
    // shared
    'Today': ['Hoy', "Aujourd'hui", 'Heute', 'Hoje'],
    'today': ['hoy', "aujourd'hui", 'heute', 'hoje'],
    'This week': ['Esta semana', 'Cette semaine', 'Diese Woche', 'Esta semana'],
    'this week': ['esta semana', 'cette semaine', 'diese Woche', 'esta semana'],
    'Loading…': ['Cargando…', 'Chargement…', 'Wird geladen…', 'Carregando…'],
    'Save': ['Guardar', 'Enregistrer', 'Speichern', 'Salvar'],
    'Cancel': ['Cancelar', 'Annuler', 'Abbrechen', 'Cancelar'],
    'Close': ['Cerrar', 'Fermer', 'Schließen', 'Fechar'],
    'Send': ['Enviar', 'Envoyer', 'Senden', 'Enviar'],
    'Request': ['Solicitar', 'Demander', 'Anfragen', 'Solicitar'],
    'Set': ['Fijar', 'Définir', 'Festlegen', 'Definir'],
    'Clear': ['Quitar', 'Effacer', 'Löschen', 'Limpar'],
    'Approve': ['Aprobar', 'Approuver', 'Genehmigen', 'Aprovar'],
    'Decline': ['Rechazar', 'Refuser', 'Ablehnen', 'Recusar'],
    'Remove': ['Eliminar', 'Supprimer', 'Entfernen', 'Remover'],
    'Help': ['Ayuda', 'Aide', 'Hilfe', 'Ajuda'],
    'Menu': ['Menú', 'Menu', 'Menü', 'Menu'],
    'Switch between light and dark': ['Cambiar entre claro y oscuro', 'Basculer entre clair et sombre', 'Zwischen hell und dunkel wechseln', 'Alternar entre claro e escuro'],
    'Language': ['Idioma', 'Langue', 'Sprache', 'Idioma'],
    // agent panel
    'pts today': ['pts hoy', "pts aujourd'hui", 'Pkt. heute', 'pts hoje'],
    'of': ['de', 'sur', 'von', 'de'],
    'on team': ['en el equipo', "dans l'équipe", 'im Team', 'na equipe'],
    'of your best day': ['de tu mejor día', 'de votre meilleur jour', 'deines besten Tages', 'do seu melhor dia'],
    'day quality streak': ['días de racha de calidad', 'jours de série qualité', 'Tage Qualitätsserie', 'dias de sequência de qualidade'],
    'contacts handled': ['contactos atendidos', 'contacts traités', 'bearbeitete Kontakte', 'contatos atendidos'],
    'avg evaluation': ['evaluación media', 'évaluation moyenne', 'Ø Bewertung', 'avaliação média'],
    'customer sentiment': ['sentimiento del cliente', 'sentiment client', 'Kundenstimmung', 'sentimento do cliente'],
    'survey score': ['puntuación de encuesta', 'score de sondage', 'Umfragewert', 'nota da pesquisa'],
    'kudos received': ['kudos recibidos', 'kudos reçus', 'erhaltene Kudos', 'kudos recebidos'],
    'Your 13 weeks': ['Tus 13 semanas', 'Vos 13 semaines', 'Deine 13 Wochen', 'Suas 13 semanas'],
    'My goal': ['Mi meta', 'Mon objectif', 'Mein Ziel', 'Minha meta'],
    'Set a goal for yourself: a number to beat this week. Only you and your supervisor see it.': ['Fija una meta para ti: una cifra que superar esta semana. Solo tú y tu supervisor la ven.', 'Fixez-vous un objectif : un chiffre à battre cette semaine. Seuls vous et votre superviseur le voient.', 'Setz dir ein Ziel: eine Zahl, die du diese Woche schlagen willst. Nur du und deine Führungskraft sehen es.', 'Defina uma meta para você: um número a superar esta semana. Só você e seu supervisor a veem.'],
    'Target': ['Meta', 'Cible', 'Ziel', 'Meta'],
    'Keep going': ['Sigue así', 'Continuez', 'Weiter so', 'Continue'],
    'Goal met. Set a higher one?': ['Meta cumplida. ¿Subimos el listón?', 'Objectif atteint. Plus haut ?', 'Ziel erreicht. Höher setzen?', 'Meta atingida. Que tal subir?'],
    'Nothing to measure yet': ['Aún no hay nada que medir', 'Rien à mesurer pour le moment', 'Noch nichts zu messen', 'Ainda nada para medir'],
    'Goal set.': ['Meta fijada.', 'Objectif défini.', 'Ziel festgelegt.', 'Meta definida.'],
    'Your coaching plan': ['Tu plan de coaching', 'Votre plan de coaching', 'Dein Coaching-Plan', 'Seu plano de coaching'],
    'Got it': ['Entendido', 'Compris', 'Verstanden', 'Entendi'],
    'Team leaderboard': ['Clasificación del equipo', "Classement de l'équipe", 'Team-Rangliste', 'Ranking da equipe'],
    'Your own best': ['Tu propio récord', 'Votre propre record', 'Deine Bestleistung', 'Seu próprio recorde'],
    'my own best': ['mi propio récord', 'mon propre record', 'meine Bestleistung', 'meu próprio recorde'],
    'hide me from others': ['ocultarme a los demás', 'me cacher aux autres', 'vor anderen verbergen', 'ocultar-me dos outros'],
    'Teammates and wallboards will not list you. Your supervisor still sees you.': ['Tus compañeros y las pantallas no te mostrarán. Tu supervisor sí te ve.', 'Vos collègues et les écrans ne vous afficheront pas. Votre superviseur vous voit toujours.', 'Kolleginnen, Kollegen und Wandtafeln zeigen dich nicht. Deine Führungskraft sieht dich weiterhin.', 'Colegas e painéis não vão listar você. Seu supervisor continua vendo.'],
    'Active challenge': ['Reto activo', 'Défi en cours', 'Aktive Challenge', 'Desafio ativo'],
    'No active challenge. Your supervisor can start one from the console.': ['No hay reto activo. Tu supervisor puede iniciar uno desde la consola.', "Aucun défi en cours. Votre superviseur peut en lancer un depuis la console.", 'Keine aktive Challenge. Deine Führungskraft kann eine über die Konsole starten.', 'Nenhum desafio ativo. Seu supervisor pode iniciar um pelo console.'],
    'Send kudos': ['Enviar kudos', 'Envoyer des kudos', 'Kudos senden', 'Enviar kudos'],
    'No badge': ['Sin insignia', 'Sans badge', 'Kein Abzeichen', 'Sem distintivo'],
    'What did they do?': ['¿Qué hizo?', "Qu'a-t-il fait ?", 'Was war es?', 'O que a pessoa fez?'],
    'Pick a teammate and write a note.': ['Elige a un compañero y escribe una nota.', 'Choisissez un collègue et écrivez un mot.', 'Wähle jemanden aus und schreib eine Notiz.', 'Escolha um colega e escreva uma nota.'],
    'Kudos sent.': ['Kudos enviados.', 'Kudos envoyés.', 'Kudos gesendet.', 'Kudos enviados.'],
    'Redeem points': ['Canjear puntos', 'Échanger des points', 'Punkte einlösen', 'Resgatar pontos'],
    'pts to spend': ['pts para gastar', 'pts à dépenser', 'Pkt. verfügbar', 'pts para gastar'],
    'Badges': ['Insignias', 'Badges', 'Abzeichen', 'Distintivos'],
    'Recent points': ['Puntos recientes', 'Points récents', 'Letzte Punkte', 'Pontos recentes'],
    'Points appear here as contacts, evaluations and kudos come in.': ['Los puntos aparecen aquí a medida que llegan contactos, evaluaciones y kudos.', 'Les points apparaissent ici au fil des contacts, évaluations et kudos.', 'Punkte erscheinen hier, sobald Kontakte, Bewertungen und Kudos eingehen.', 'Os pontos aparecem aqui conforme chegam contatos, avaliações e kudos.'],
    'Loading your history…': ['Cargando tu historial…', 'Chargement de votre historique…', 'Dein Verlauf wird geladen…', 'Carregando seu histórico…'],
    'Best day': ['Mejor día', 'Meilleur jour', 'Bester Tag', 'Melhor dia'],
    'Best week': ['Mejor semana', 'Meilleure semaine', 'Beste Woche', 'Melhor semana'],
    'Only you and your supervisor see this view.': ['Solo tú y tu supervisor ven esta vista.', 'Seuls vous et votre superviseur voient cette vue.', 'Nur du und deine Führungskraft sehen diese Ansicht.', 'Só você e seu supervisor veem esta visão.'],
    'Points this week': ['Puntos esta semana', 'Points cette semaine', 'Punkte diese Woche', 'Pontos esta semana'],
    'Contacts handled today': ['Contactos atendidos hoy', "Contacts traités aujourd'hui", 'Heute bearbeitete Kontakte', 'Contatos atendidos hoje'],
    'Evaluation average': ['Evaluación media', 'Moyenne des évaluations', 'Bewertungsdurchschnitt', 'Média das avaliações'],
    'Customer sentiment': ['Sentimiento del cliente', 'Sentiment client', 'Kundenstimmung', 'Sentimento do cliente'],
    'Survey score': ['Puntuación de encuesta', 'Score de sondage', 'Umfragewert', 'Nota da pesquisa'],
    'Handle time (seconds, lower is better)': ['Tiempo de gestión (segundos, menos es mejor)', 'Temps de traitement (secondes, moins c\'est mieux)', 'Bearbeitungszeit (Sekunden, weniger ist besser)', 'Tempo de atendimento (segundos, menos é melhor)'],
    'Points': ['Puntos', 'Points', 'Punkte', 'Pontos'],
    'Contacts handled': ['Contactos atendidos', 'Contacts traités', 'Bearbeitete Kontakte', 'Contatos atendidos'],
    'Schedule adherence': ['Adherencia al horario', 'Respect du planning', 'Dienstplantreue', 'Aderência à escala'],
    'Handle time': ['Tiempo de gestión', 'Temps de traitement', 'Bearbeitungszeit', 'Tempo de atendimento'],
    'Escalation rate': ['Tasa de escalado', "Taux d'escalade", 'Eskalationsrate', 'Taxa de escalonamento'],
    'Kudos received': ['Kudos recibidos', 'Kudos reçus', 'Erhaltene Kudos', 'Kudos recebidos'],
    'The trend could not be loaded.': ['No se pudo cargar la tendencia.', "La tendance n'a pas pu être chargée.", 'Der Trend konnte nicht geladen werden.', 'Não foi possível carregar a tendência.'],
    'Team average per active agent': ['Media del equipo por agente activo', "Moyenne de l'équipe par agent actif", 'Teamdurchschnitt pro aktivem Agent', 'Média da equipe por agente ativo'],
    'You': ['Tú', 'Vous', 'Du', 'Você'],
    'Lifesaver': ['Salvavidas', 'Sauveur', 'Lebensretter', 'Salva-vidas'],
    'Calm under pressure': ['Calma bajo presión', 'Calme sous pression', 'Ruhe unter Druck', 'Calma sob pressão'],
    'Team player': ['Jugador de equipo', "Esprit d'équipe", 'Teamplayer', 'Espírito de equipe'],
    'Problem solver': ['Resuelve problemas', 'Résout les problèmes', 'Problemlöser', 'Solucionador'],
    'Customer champion': ['Campeón del cliente', 'Champion du client', 'Kundenchampion', 'Campeão do cliente'],
    'Mentor': ['Mentor', 'Mentor', 'Mentor', 'Mentor'],
    // wallboard
    'Leaderboard': ['Clasificación', 'Classement', 'Rangliste', 'Ranking'],
    'live': ['en vivo', 'en direct', 'live', 'ao vivo'],
    'team points': ['puntos del equipo', "points de l'équipe", 'Teampunkte', 'pontos da equipe'],
    'day team streak': ['días de racha del equipo', "jours de série d'équipe", 'Tage Teamserie', 'dias de sequência da equipe'],
    'Loading challenge…': ['Cargando reto…', 'Chargement du défi…', 'Challenge wird geladen…', 'Carregando desafio…'],
    'No active challenge': ['Sin reto activo', 'Aucun défi en cours', 'Keine aktive Challenge', 'Nenhum desafio ativo'],
    'Team is': ['El equipo va', "L'équipe est", 'Das Team ist', 'A equipe está'],
    'on track': ['en camino', 'sur la bonne voie', 'auf Kurs', 'no caminho'],
    'behind': ['por detrás', 'en retard', 'im Rückstand', 'atrás'],
    'Kudos sent by teammates scroll here': ['Aquí pasan los kudos que envían los compañeros', 'Les kudos envoyés par les collègues défilent ici', 'Kudos von Kolleginnen und Kollegen laufen hier durch', 'Os kudos enviados por colegas passam aqui'],
    'Light or dark': ['Claro u oscuro', 'Clair ou sombre', 'Hell oder dunkel', 'Claro ou escuro'],
    'Larger text': ['Texto más grande', 'Texte plus grand', 'Größerer Text', 'Texto maior'],
    'High contrast': ['Alto contraste', 'Contraste élevé', 'Hoher Kontrast', 'Alto contraste'],
    // supervisor console: headings, counters, buttons (dynamic sentences stay in English in this version)
    'Supervisor console': ['Consola de supervisión', 'Console superviseur', 'Supervisor-Konsole', 'Console do supervisor'],
    'Results report': ['Informe de resultados', 'Rapport de résultats', 'Ergebnisbericht', 'Relatório de resultados'],
    'Open wallboard': ['Abrir pantalla', "Ouvrir l'écran", 'Wandtafel öffnen', 'Abrir painel'],
    'TV link': ['Enlace para TV', 'Lien TV', 'TV-Link', 'Link para TV'],
    'Brand': ['Marca', 'Marque', 'Marke', 'Marca'],
    'People': ['Personas', 'Personnes', 'Personen', 'Pessoas'],
    'Data': ['Datos', 'Données', 'Daten', 'Dados'],
    'agents online': ['agentes en línea', 'agents en ligne', 'Agenten online', 'agentes online'],
    'team points today': ['puntos del equipo hoy', "points de l'équipe aujourd'hui", 'Teampunkte heute', 'pontos da equipe hoje'],
    'avg evaluation today': ['evaluación media hoy', "évaluation moyenne aujourd'hui", 'Ø Bewertung heute', 'avaliação média hoje'],
    'need attention': ['necesitan atención', "nécessitent de l'attention", 'brauchen Aufmerksamkeit', 'precisam de atenção'],
    'rewards awaiting approval': ['recompensas por aprobar', 'récompenses à approuver', 'Prämien zur Genehmigung', 'recompensas aguardando aprovação'],
    'Challenges': ['Retos', 'Défis', 'Challenges', 'Desafios'],
    'New challenge': ['Nuevo reto', 'Nouveau défi', 'Neue Challenge', 'Novo desafio'],
    'Coaching': ['Coaching', 'Coaching', 'Coaching', 'Coaching'],
    'Kudos activity': ['Actividad de kudos', 'Activité kudos', 'Kudos-Aktivität', 'Atividade de kudos'],
    'last hour': ['última hora', 'dernière heure', 'letzte Stunde', 'última hora'],
    'Spot award': ['Premio al momento', 'Prime instantanée', 'Spontanprämie', 'Prêmio instantâneo'],
    'Needs attention': ['Necesita atención', "Nécessite de l'attention", 'Braucht Aufmerksamkeit', 'Precisa de atenção'],
    'auto-detected': ['detección automática', 'détecté automatiquement', 'automatisch erkannt', 'detectado automaticamente'],
    'Coach': ['Coachear', 'Coacher', 'Coachen', 'Orientar'],
    'Notifications': ['Notificaciones', 'Notifications', 'Benachrichtigungen', 'Notificações'],
    'Slack, Teams and a daily digest': ['Slack, Teams y un resumen diario', 'Slack, Teams et un résumé quotidien', 'Slack, Teams und eine tägliche Zusammenfassung', 'Slack, Teams e um resumo diário'],
    'Send a test': ['Enviar una prueba', 'Envoyer un test', 'Test senden', 'Enviar um teste'],
    'Reward approvals': ['Aprobación de recompensas', 'Approbation des récompenses', 'Prämien genehmigen', 'Aprovação de recompensas'],
    'Catalog': ['Catálogo', 'Catalogue', 'Katalog', 'Catálogo'],
    'Budget': ['Presupuesto', 'Budget', 'Budget', 'Orçamento'],
    'Scoring mix': ['Mezcla de puntuación', 'Pondération des scores', 'Punktemix', 'Composição da pontuação'],
    'Quality': ['Calidad', 'Qualité', 'Qualität', 'Qualidade'],
    'Productivity': ['Productividad', 'Productivité', 'Produktivität', 'Produtividade'],
    'Adherence': ['Adherencia', 'Respect du planning', 'Dienstplantreue', 'Aderência'],
    'Pause stream': ['Pausar flujo', 'Mettre le flux en pause', 'Stream anhalten', 'Pausar fluxo'],
    'Resume stream': ['Reanudar flujo', 'Reprendre le flux', 'Stream fortsetzen', 'Retomar fluxo'],
    'today · click a column to sort': ['hoy · haz clic en una columna para ordenar', "aujourd'hui · cliquez sur une colonne pour trier", 'heute · Spalte anklicken zum Sortieren', 'hoje · clique numa coluna para ordenar'],
  };
  const DICT = { es: {}, fr: {}, de: {}, 'pt-BR': {} };
  for (const [en, [es, fr, de, pt]] of Object.entries(ROWS)) { DICT.es[en] = es; DICT.fr[en] = fr; DICT.de[en] = de; DICT['pt-BR'][en] = pt; }

  /** Pick the language: ?lang, the saved choice, the browser, else English. Only languages we have count. */
  function resolve(search, saved, navLang) {
    const want = (v) => { if (!v) return null; v = String(v); if (LANGS[v]) return v; const short = v.slice(0, 2).toLowerCase(); if (short === 'pt') return 'pt-BR'; return LANGS[short] ? short : null; };
    const q = search ? new URLSearchParams(search).get('lang') : null;
    return want(q) || want(saved) || want(navLang) || 'en';
  }
  let current = 'en';
  function t(s, lang) { const d = DICT[lang || current]; return (d && d[s]) || s; }

  /** Translate text nodes, placeholders, titles and aria-labels under a root. Safe to call repeatedly. */
  function translateNode(node, lang) {
    const d = DICT[lang]; if (!d) return;
    const walker = node.ownerDocument.createTreeWalker(node, 4 /* text */);
    const texts = []; let n; while ((n = walker.nextNode())) texts.push(n);
    for (const tn of texts) {
      const raw = tn.nodeValue, core = raw.trim();
      if (!core) continue;
      // Badge labels carry an emoji in front ("🛟 Lifesaver"): translate the words and keep the symbol.
      const sym = /^([^A-Za-zÀ-ɏ]+\s)(.+)$/.exec(core);
      const key = core in d ? core : sym && sym[2] in d ? sym[2] : null;
      if (!key) continue;
      const out = key === core ? d[core] : sym[1] + d[key];
      const lead = raw.slice(0, raw.indexOf(core)), tail = raw.slice(raw.indexOf(core) + core.length);
      tn.nodeValue = lead + out + tail;
    }
    const els = node.nodeType === 1 ? [node, ...node.querySelectorAll('[placeholder],[title],[aria-label]')] : [];
    for (const el of els) for (const a of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute && el.getAttribute(a); if (v && v in d) el.setAttribute(a, d[v]); }
  }
  let observer = null;
  function apply(doc, lang) {
    current = lang || resolve(doc.location && doc.location.search, (() => { try { return localStorage.getItem('arena.lang'); } catch { return null; } })(), typeof navigator !== 'undefined' ? navigator.language : null);
    doc.documentElement.setAttribute('lang', current.toLowerCase());
    if (current === 'en') { if (observer) { observer.disconnect(); observer = null; } return current; }
    translateNode(doc.body, current);
    if (!observer) {
      let pending = false;
      observer = new MutationObserver(() => { if (pending) return; pending = true; setTimeout(() => { pending = false; translateNode(doc.body, current); }, 30); });
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    }
    return current;
  }
  function setLang(lang) { try { localStorage.setItem('arena.lang', lang); } catch {} }
  /** A <select> of the languages, wired to save the choice and reload so every string renders afresh. */
  function selector(doc, cls) {
    const sel = doc.createElement('select'); sel.className = cls || 'lang-sel'; sel.setAttribute('aria-label', 'Language'); sel.title = t('Language');
    for (const [k, v] of Object.entries(LANGS)) { const o = doc.createElement('option'); o.value = k; o.textContent = v; if (k === current) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { setLang(sel.value); const u = new URL(doc.location.href); u.searchParams.delete('lang'); doc.location.replace(u.toString()); });
    return sel;
  }
  return { LANGS, DICT, resolve, t, apply, setLang, selector, get lang() { return current; } };
});
