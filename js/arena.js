/*
 * arena.js: torneios entre bots, para medir qual inteligência joga melhor.
 *
 * Partidas duplicadas: cada distribuição de cartas (sorteada por uma "semente") é jogada
 * duas vezes, com as duplas trocando de lugar. Os dois bots recebem exatamente as mesmas
 * cartas, então a sorte da distribuição se anula na comparação.
 *
 * Mede, para cada bot: diferença média de pontos por rodada (com margem de erro de 95%),
 * rodadas vencidas, bates, cartas que sobraram na mão, canastras limpas, erros estratégicos
 * ("entregou o lixo": o próximo pegou um lixo de 5+ cartas com a carta que ele descartou;
 * "ficou preso": terminou a vez com 1 carta sem canastra limpa) e tempo por jogada.
 */

const Arena = {
  // Os bots que podem entrar no torneio. "gm" muda parâmetros do Mestre (para medir cada parte).
  BOTS: {
    aleatorio: { label: 'Aleatório', random: true },
    iniciante: { label: 'Iniciante', level: 'iniciante' },
    moderado: { label: 'Moderado (regras)', level: 'moderado' },
    esperto: { label: 'Esperto (Monte Carlo)', level: 'esperto' },
    mestre: { label: 'Mestre (completo)', level: 'mestre' },
    'gm-sem-inferencia': { label: 'Mestre sem inferência', level: 'mestre', gm: { beliefs: false } },
    'gm-com-baixadas': { label: 'Mestre com busca de baixadas', level: 'mestre', gm: { meldSearch: true } },
    'gm-descarte-curto': { label: 'Mestre com descarte só entre 4', level: 'mestre', gm: { wideDiscard: false } },
    'gm-vitoria': { label: 'Mestre jogando pela vitória', level: 'mestre', gm: { utility: 'vitoria' } },
    'gm-sem-preferencia': { label: 'Mestre sem preferir as regras', level: 'mestre', gm: { preferZ: 0 } },
  },

  // Gerador de números aleatórios com semente (mulberry32): a mesma semente dá o mesmo baralho.
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // Baralho embaralhado a partir de uma semente.
  deck(seed) {
    const r = Arena.rng(seed);
    const cards = createDeck();
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  },

  // Orçamento das simulações (1 = normal). Vale igual para todos os bots que simulam.
  setScale(scale) {
    const base = { esperto: 120 };
    for (const k of Object.keys(base)) AI.LEVELS[k].rounds = Math.max(4, Math.round(base[k] * scale));
    Arena.gmScale = scale;
  },
  gmScale: 1,

  // Ajusta o Mestre para o bot da vez (parâmetros próprios + orçamento do torneio).
  configureGM(spec) {
    GM.resetParams();
    const s = Arena.gmScale;
    GM.PARAMS.worldsDraw = Math.max(8, Math.round(GM.PARAMS.worldsDraw * s));
    GM.PARAMS.worldsMelds = Math.max(8, Math.round(GM.PARAMS.worldsMelds * s));
    GM.PARAMS.worldsDiscard = Math.max(8, Math.round(GM.PARAMS.worldsDiscard * s));
    GM.PARAMS.budgetMs = 1e9; // nos torneios o limite é o número de mundos, não o relógio
    Object.assign(GM.PARAMS, spec.gm || {});
  },

  // Bot aleatório: decide tudo no sorteio (só respeita as regras).
  randomTurn(g, seat) {
    if (g.phase === 'draw') {
      const plan = AI.findPickup(g, seat);
      const took = plan && Math.random() < 0.5 && g.applyMelds(seat, plan).ok;
      if (!took) {
        if (!g.stock.length) {
          g.endByEmptyStock(seat);
          return;
        }
        g.drawFromStock(seat);
      }
      if (g.phase !== 'play') return;
    }
    if (Math.random() < 0.5) AI.meldAll(g, seat, 'iniciante');
    if (g.phase !== 'play' || g.current !== seat) return;
    const hand = g.players[seat].hand;
    const naturals = hand.filter((c) => !isWild(c));
    for (const c of shuffle([...(naturals.length ? naturals : hand)])) {
      if (g.discard(seat, c.id).ok) return;
    }
  },

  // Joga uma vez do bot "spec" no lugar "seat".
  playTurn(g, seat, spec) {
    if (spec.random) return Arena.randomTurn(g, seat);
    if (spec.level === 'mestre') Arena.configureGM(spec);
    AI.playTurnSync(g, seat, spec.level);
  },

  /*
   * Joga uma rodada com a distribuição "seed" e o carteador "dealer".
   * specs[seat] = bot de cada lugar. Devolve as medidas de cada dupla.
   */
  playRound(seed, dealer, specs) {
    const g = new Game({ allBots: true, deckSource: () => Arena.deck(seed), dealer });
    g.newMatch();
    const m = {
      total: [0, 0], won: [0, 0], bate: [0, 0], cardsLeft: [0, 0], clean: [0, 0],
      lixoEntregue: [0, 0], preso: [0, 0], ms: [0, 0], turns: [0, 0], stuck: 0,
    };
    let guard = 0;
    while ((g.phase === 'draw' || g.phase === 'play') && guard++ < 600) {
      const seat = g.current;
      const team = seat % 2;
      const before = g.publicIn[seat].size;
      const t0 = Date.now();
      Arena.playTurn(g, seat, specs[seat]);
      m.ms[team] += Date.now() - t0;
      m.turns[team]++;
      // Pegou um lixo de 5+ cartas: quem descartou por último (o adversário anterior) entregou.
      if (g.publicIn[seat].size - before >= 4) m.lixoEntregue[(seat + 3) % 2]++;
      if (g.phase !== 'roundEnd') {
        const p = g.players[seat];
        if (p.hand.length === 1 && !Rules.hasCleanCanastra(g.teamOf(seat).melds) && g.stock.length > 4) m.preso[team]++;
        if (g.current === seat) { // ninguém conseguiu jogar: encerra para não travar o torneio
          m.stuck++;
          g.endRound(null);
        }
      }
    }
    if (g.phase !== 'roundEnd') g.endRound(null);
    const lr = g.lastRound;
    for (const t of [0, 1]) {
      m.total[t] = lr.results[t].total;
      m.clean[t] = lr.results[t].clean;
      m.cardsLeft[t] = g.players.filter((p) => p.team === t).reduce((s, p) => s + p.hand.length, 0);
    }
    m.won[0] = m.total[0] > m.total[1] ? 1 : 0;
    m.won[1] = m.total[1] > m.total[0] ? 1 : 0;
    if (lr.batedor !== null) m.bate[lr.batedor % 2] = 1;
    return m;
  },

  // Medidas somadas de um bot ao longo do torneio.
  emptyTotals() {
    return { rounds: 0, points: 0, won: 0, bate: 0, cardsLeft: 0, clean: 0, lixoEntregue: 0, preso: 0, ms: 0, turns: 0 };
  },
  addTotals(tot, m, team) {
    tot.rounds++;
    tot.points += m.total[team];
    tot.won += m.won[team];
    tot.bate += m.bate[team];
    tot.cardsLeft += m.cardsLeft[team];
    tot.clean += m.clean[team];
    tot.lixoEntregue += m.lixoEntregue[team];
    tot.preso += m.preso[team];
    tot.ms += m.ms[team];
    tot.turns += m.turns[team];
  },

  /*
   * Torneio duplicado entre os bots "a" e "b" (chaves de Arena.BOTS).
   * Para cada distribuição i: "a" joga com a dupla 0 e depois com a dupla 1, com as mesmas cartas.
   * "pairs" guarda a diferença média de pontos (a − b) de cada distribuição.
   */
  duplicate(a, b, deals, seed0 = 1, scale = 1) {
    Arena.setScale(scale);
    const A = Arena.BOTS[a];
    const B = Arena.BOTS[b];
    const res = { botA: a, botB: b, deals, seed0, scale, pairs: [], totA: Arena.emptyTotals(), totB: Arena.emptyTotals(), stuck: 0 };
    for (let i = 0; i < deals; i++) {
      const seed = seed0 + i;
      const dealer = i % 4;
      let diff = 0;
      for (const teamA of [0, 1]) {
        const specs = [0, 1, 2, 3].map((s) => (s % 2 === teamA ? A : B));
        const m = Arena.playRound(seed, dealer, specs);
        diff += m.total[teamA] - m.total[1 - teamA];
        Arena.addTotals(res.totA, m, teamA);
        Arena.addTotals(res.totB, m, 1 - teamA);
        res.stuck += m.stuck;
      }
      res.pairs.push(diff / 2);
    }
    return res;
  },

  // Junta resultados de vários pedaços do mesmo torneio (rodados em paralelo).
  merge(parts) {
    const out = { ...parts[0], pairs: [], totA: Arena.emptyTotals(), totB: Arena.emptyTotals(), stuck: 0, deals: 0 };
    for (const p of parts) {
      out.pairs.push(...p.pairs);
      out.deals += p.deals;
      out.stuck += p.stuck;
      for (const k of Object.keys(out.totA)) {
        out.totA[k] += p.totA[k];
        out.totB[k] += p.totB[k];
      }
    }
    return out;
  },

  // Estatística: média da diferença por rodada, margem de erro de 95% e veredito.
  summarize(res) {
    const n = res.pairs.length;
    const mean = res.pairs.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(res.pairs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1));
    const margin = 1.96 * sd / Math.sqrt(n);
    const per = (t) => ({
      pontosPorRodada: Math.round(t.points / t.rounds),
      rodadasVencidas: `${Math.round((100 * t.won) / t.rounds)}%`,
      bates: `${Math.round((100 * t.bate) / t.rounds)}%`,
      cartasNaMaoNoFim: +(t.cardsLeft / t.rounds).toFixed(1),
      canastrasLimpas: +(t.clean / t.rounds).toFixed(2),
      lixoEntreguePor100Rodadas: Math.round((100 * t.lixoEntregue) / t.rounds),
      presoPor100Rodadas: Math.round((100 * t.preso) / t.rounds),
      msPorJogada: Math.round(t.ms / Math.max(1, t.turns)),
    });
    let verdict;
    if (mean - margin > 0) verdict = `${Arena.BOTS[res.botA].label} é melhor (95% de confiança)`;
    else if (mean + margin < 0) verdict = `${Arena.BOTS[res.botB].label} é melhor (95% de confiança)`;
    else verdict = 'Empate estatístico (a diferença cabe na margem de erro)';
    return {
      a: Arena.BOTS[res.botA].label, b: Arena.BOTS[res.botB].label, distribuicoes: n, rodadas: n * 2,
      diferencaPorRodada: Math.round(mean), margemDeErro95: Math.round(margin), veredito: verdict,
      [Arena.BOTS[res.botA].label]: per(res.totA), [Arena.BOTS[res.botB].label]: per(res.totB), travamentos: res.stuck,
    };
  },
};
