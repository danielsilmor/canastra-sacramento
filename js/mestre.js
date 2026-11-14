/*
 * mestre.js: Mestre, o bot mais forte.
 *
 * Interface (a lógica do jogo fica no game.js; aqui só se decide):
 *   GM.chooseDraw(game, seat)    → { kind: 'stock' } ou { kind: 'pickup', plan }
 *   GM.chooseMelds(game, seat)   → { name, label, apply(game, seat) }
 *   GM.chooseDiscard(game, seat) → a carta a descartar
 *   GM.turnSteps(game, seat)     → joga a vez inteira (usado pelo ai.js, como os outros níveis)
 *
 * Como pensa (explicação completa em IA.md):
 *  1. Inferência: sorteia "mundos possíveis" para as cartas que não vê e dá peso a cada um
 *     conforme o que os adversários fizeram à vista de todos. Quem recusou um topo do lixo
 *     provavelmente não tinha par para ele; quem descartou uma carta provavelmente não tinha
 *     as vizinhas dela. Mundos que contradizem isso quase não são usados.
 *  2. Monte Carlo adaptativo: cada alternativa é jogada nos mesmos mundos (todos jogando como
 *     Moderado por algumas voltas) e recebe a vantagem média da dupla. As claramente piores
 *     são eliminadas cedo (corrida com eliminação) e as simulações vão para as empatadas.
 *     Decisões mais importantes (lixo grande, adversário aberto) recebem mais simulações.
 *  3. Busca nas baixadas: compara jeitos de baixar (padrão, guardar, baixar tudo, outra abertura).
 *  4. Utilidade: pontos da rodada (padrão) ou chance de vencer a partida.
 *  5. Lixo pela regra nova (AI.pickupOptions): compara todos os jeitos de pegar o lixo (juntar num
 *     jogo da mesa, fechar canastra, jogo novo), poupa curinga em jogo fraco ou que disputa cartas
 *     com outro do mesmo naipe e deixa passar lixo pequeno (até 3 cartas) quando o jeito é ruim.
 *     Vale também para os jogadores que ele imagina nas simulações.
 * Não trapaceia: usa só o que está à vista e o que ele decorou (lixo inteiro e cartas que cada um pegou dele).
 */

const GM = {
  // Parâmetros ajustáveis (os torneios de teste ligam e desligam partes para medir cada uma).
  PARAMS_DEFAULT: {
    worldsDraw: 160,       // máximo de mundos por decisão de compra
    worldsMelds: 120,      // ... de baixadas
    worldsDiscard: 200,    // ... de descarte
    minWorlds: 16,         // mundos mínimos antes de eliminar alternativas
    batch: 8,              // mundos sorteados por rodada da corrida
    z: 2.0,                // rigor para eliminar (2 = 95% de confiança)
    budgetMs: 700,         // tempo máximo por decisão
    oversample: 3,         // mundos sorteados para cada mundo usado (inferência)
    declineOpened: 0.2,    // peso de um mundo em que quem recusou o topo tinha par para ele (dupla aberta)
    declineUnopened: 0.6,  // ... (dupla ainda sem abrir: talvez só faltassem pontos)
    discardNeighbor: 0.75, // peso de um mundo em que quem descartou tinha vizinha da carta
    strandPenalty: 250,    // desconto por jogador "preso" (1 carta sem canastra limpa) no fim da simulação
    preferZ: 1.0,          // só troca a escolha das regras do Moderado se a outra for melhor por esta margem
                           // (em erros-padrão; 0 = sempre fica com a maior média)
    beliefs: true,         // usar a inferência pelo comportamento
    meldSearch: false,     // comparar jeitos de baixar (desligado: nos torneios não trouxe ganho e custa ~25% de tempo)
    wideDiscard: true,     // comparar todos os descartes (senão, só os 4 melhores da regra)
    maxPickupPlans: 3,     // jeitos diferentes de pegar o lixo a comparar
    lixoNovo: true,        // pegar o lixo pela regra nova (desligado: o jeito antigo, para comparar nos torneios)
    utility: 'pontos',     // 'pontos' ou 'vitoria' (chance de vencer a partida)
    winScale: 1500,        // largura da curva de chance de vitória
  },
  PARAMS: null,

  // ---------- A vez inteira ----------

  // A regra nova de pegar o lixo (AI.lixoNovo) fica ligada enquanto o Mestre pensa e joga,
  // inclusive nas simulações dele. Nas pausas da tela (e na vez dos outros níveis) fica desligada.
  *turnSteps(game, seat) {
    const steps = GM.steps(game, seat);
    for (;;) {
      const before = AI.lixoNovo;
      AI.lixoNovo = GM.PARAMS.lixoNovo;
      let r;
      try {
        r = steps.next();
      } finally {
        AI.lixoNovo = before;
      }
      if (r.done) return;
      yield;
    }
  },

  *steps(game, seat) {
    if (game.phase === 'draw') {
      const d = GM.chooseDraw(game, seat);
      let took = false;
      if (d.kind === 'pickup') {
        const text = AI.describePickup(game, seat, d.plan);
        took = game.applyMelds(seat, d.plan).ok;
        if (took) AI.note(text);
      }
      if (!took) {
        if (!game.stock.length) {
          game.endByEmptyStock(seat);
          return;
        }
        game.drawFromStock(seat);
        if (game.turn.canSecondDraw && AI.wantsSecondDraw(game, seat)) {
          const first = game.players[seat].hand.find((c) => c.id === game.turn.firstCardId);
          AI.note(`Trocou ${cardName(first)} (primeiro a jogar): a carta comprada não combinava com nada da mão.`);
          yield;
          game.secondDraw(seat);
        }
      }
      yield;
      if (game.phase !== 'play') return; // pode ter batido ao pegar o lixo
    }
    const before = game.players[seat].hand.length;
    GM.chooseMelds(game, seat).apply(game, seat);
    if (game.players[seat].hand.length !== before) yield;
    if (game.phase !== 'play' || game.current !== seat) return; // bateu baixando
    const card = GM.chooseDiscard(game, seat);
    if (!card) { // mão vazia (não deveria acontecer): encerra a rodada para o jogo não travar
      game.endRound(null);
      return;
    }
    game.discard(seat, card.id);
    yield;
  },

  // ---------- 1. Inferência ----------

  /*
   * Sorteia "n" mundos possíveis para as cartas escondidas, já pesados pelo comportamento:
   * sorteia mais mundos do que precisa (oversample), dá um peso a cada um e escolhe
   * os "n" de forma proporcional ao peso (reamostragem sistemática).
   */
  sampleWorlds(game, seat, n) {
    const P = GM.PARAMS;
    if (!P.beliefs) return Array.from({ length: n }, () => AI.guessHidden(game, seat, true));
    const m = n * P.oversample;
    const pool = [];
    let total = 0;
    let sumSq = 0;
    for (let i = 0; i < m; i++) {
      const hidden = AI.guessHidden(game, seat, true);
      const w = GM.likelihood(game, seat, hidden);
      pool.push({ hidden, w });
      total += w;
      sumSq += w * w;
    }
    GM.stats.ess = (total * total) / (sumSq * m); // aproveitamento (1 = todos os mundos igualmente plausíveis)
    const out = [];
    const step = total / n;
    let target = Math.random() * step;
    let acc = 0;
    for (const item of pool) {
      acc += item.w;
      while (target < acc && out.length < n) {
        out.push(item.hidden);
        target += step;
      }
    }
    while (out.length < n) out.push(pool[pool.length - 1].hidden);
    return out;
  },

  // Quão plausível é um mundo, dado o que cada jogador fez à vista de todos nesta rodada.
  likelihood(game, seat, hidden) {
    const P = GM.PARAMS;
    let w = 1;
    for (const p of game.players) {
      if (p.seat === seat) continue;
      const obs = game.observed[p.seat];
      const hand = hidden.hands[p.seat];
      if (!obs || !obs.length || !hand) continue;
      // Só as cartas sorteadas contam (as que ele pegou do lixo depois são certezas, não indícios).
      const have = new Set();
      let wilds = 0;
      let aces = 0;
      for (const c of hand) {
        if (game.publicIn[p.seat].has(c.id)) continue;
        if (isWild(c)) wilds++;
        else {
          have.add(`${c.rank}${c.suit}`);
          if (c.rank === 14) aces++;
        }
      }
      for (const o of obs) {
        const c = o.card;
        if (o.kind === 'decline') {
          if (GM.hasPairFor(have, wilds, aces, c)) w *= o.opened ? P.declineOpened : P.declineUnopened;
        } else if (o.kind === 'discard' && !isWild(c) && !isThree(c)) {
          if (have.has(`${c.rank - 1}${c.suit}`) || have.has(`${c.rank + 1}${c.suit}`)) w *= P.discardNeighbor;
        }
      }
    }
    return w;
  },

  // A mão ("have" = cartas naturais, "wilds" = curingas) tem 2 cartas que formam sequência com "top"?
  hasPairFor(have, wilds, aces, top) {
    if (isWild(top) || isThree(top)) return false;
    const r = top.rank;
    const s = top.suit;
    const h = (rank) => rank >= 4 && rank <= 14 && have.has(`${rank}${s}`);
    if ((h(r - 2) && h(r - 1)) || (h(r - 1) && h(r + 1)) || (h(r + 1) && h(r + 2))) return true;
    if (wilds && (h(r - 2) || h(r - 1) || h(r + 1) || h(r + 2))) return true;
    if (r === 14 && (aces >= 2 || (aces >= 1 && wilds))) return true;
    return false;
  },

  // ---------- 2. Monte Carlo adaptativo (corrida com eliminação) ----------

  /*
   * Compara as alternativas "cands" jogando cada uma nos mesmos mundos.
   * "apply(g, seat, cand)" aplica a alternativa numa cópia da partida e termina a vez.
   * Para quando sobra uma, quando acabam os mundos ou o tempo. Devolve a melhor.
   */
  race(game, seat, cands, apply, maxWorlds, preferred = -1) {
    const P = GM.PARAMS;
    const team = game.players[seat].team;
    const vals = cands.map(() => []);
    let alive = cands.map((c, i) => i);
    let worlds = 0;
    const start = Date.now();
    const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    AI.quiet++; // as jogadas imaginadas não entram nas explicações
    try {
      while (worlds < maxWorlds && alive.length > 1) {
        for (const hidden of GM.sampleWorlds(game, seat, P.batch)) {
          for (const i of alive) {
            const g = AI.imagine(game, hidden);
            apply(g, seat, cands[i]);
            vals[i].push(GM.value(game, g, team));
          }
          worlds++;
        }
        if (worlds >= P.minWorlds) {
          // Elimina as alternativas claramente piores que a líder, comparando mundo a mundo.
          const best = alive.reduce((b, i) => (mean(vals[i]) > mean(vals[b]) ? i : b), alive[0]);
          alive = alive.filter((i) => {
            if (i === best) return true;
            const d = vals[best].map((v, k) => v - vals[i][k]);
            const m = mean(d);
            const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, d.length - 1));
            return !(m - P.z * (sd / Math.sqrt(d.length)) > 0);
          });
        }
        if (Date.now() - start > P.budgetMs) break;
      }
    } finally {
      AI.quiet--;
    }
    cands.forEach((c, i) => {
      c.avg = mean(vals[i]);
      c.worlds = vals[i].length;
    });
    let winner = alive.reduce((b, i) => (cands[i].avg > cands[b].avg ? i : b), alive[0]);
    GM.stats.worlds = worlds;
    GM.stats.eliminated = cands.length - alive.length;
    GM.stats.keptDefault = false;
    // Só abandona a escolha das regras (preferred) se a vencedora for claramente melhor.
    if (preferred >= 0 && winner !== preferred && alive.includes(preferred) && P.preferZ > 0) {
      const d = vals[winner].map((v, k) => v - vals[preferred][k]);
      const m = mean(d);
      const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, d.length - 1));
      if (m < P.preferZ * (sd / Math.sqrt(d.length))) {
        winner = preferred;
        GM.stats.keptDefault = true;
      }
    }
    return cands[winner];
  },

  // Valor de uma situação imaginada para a dupla: joga algumas voltas à frente (todos como
  // Moderado) e mede a vantagem no placar; ou a chance de vencer a partida.
  value(real, g, team) {
    let diff = AI.rollout(g, team);
    // Jogador "preso" (1 carta, sem canastra limpa na dupla) não consegue mais baixar, pegar o lixo
    // nem bater: as poucas voltas simuladas não mostram esse prejuízo, então ele é descontado aqui.
    if (g.phase !== 'roundEnd') {
      for (const p of g.players) {
        if (p.hand.length === 1 && !Rules.hasCleanCanastra(g.teamOf(p.seat).melds)) {
          diff += (p.team === team ? -1 : 1) * GM.PARAMS.strandPenalty;
        }
      }
    }
    if (GM.PARAMS.utility !== 'vitoria') return diff;
    const lead = real.teams[team].score - real.teams[1 - team].score;
    return 1000 / (1 + Math.exp(-(lead + diff) / GM.PARAMS.winScale));
  },

  // Decisões importantes recebem mais simulações.
  importance(game, seat, kind) {
    const nextTeam = game.teamOf((seat + 1) % 4);
    const pile = game.discardPile.length;
    if (kind === 'draw') return pile >= 6 ? 1.5 : 1;
    if (kind === 'discard') return nextTeam.opened && pile >= 4 ? 1.5 : 1;
    return 1;
  },

  stats: { ess: 1, worlds: 0, eliminated: 0 },

  // Texto das médias para o modo depuração.
  summary(cands, kindText) {
    const fmt = (v) => (v >= 0 ? '+' : '') + Math.round(v);
    const shown = [...cands].sort((a, b) => b.avg - a.avg).slice(0, 6);
    const elim = GM.stats.eliminated ? `, eliminou ${GM.stats.eliminated} cedo por serem claramente piores` : '';
    const inf = GM.PARAMS.beliefs ? ` Inferência: aproveitou ${Math.round(GM.stats.ess * 100)}% dos mundos sorteados ` +
      '(mundos que contradizem as recusas e os descartes dos adversários pesam menos).' : '';
    return `Comparou ${cands.length} ${kindText} em ${GM.stats.worlds} mundos possíveis${elim} ` +
      `(vantagem média da dupla, quanto maior melhor: ${shown.map((c) => `${c.label} ${fmt(c.avg)}`).join(', ')}).${inf}`;
  },

  // ---------- 3. Decisões ----------

  // Comprar: monte ou um dos jeitos de pegar o lixo.
  chooseDraw(game, seat) {
    const ways = GM.pickupWays(game, seat);
    if (!ways.length) {
      AI.note(AI.whyNoPickup(game, seat));
      return { kind: 'stock' };
    }
    if (!game.stock.length) return { kind: 'pickup', plan: ways[0].plan }; // sem monte, só resta o lixo
    const cands = [{ kind: 'stock', label: 'comprar do monte' },
      ...ways.map((w, i) => ({ kind: 'pickup', plan: w.plan, label: ways.length > 1 ? `pegar o lixo (jeito ${i + 1})` : 'pegar o lixo' }))];
    // Escolha das regras: pega o lixo, a não ser que dê para fechar canastra com curinga
    // ou (regra nova) que o lixo seja pequeno e o melhor jeito de pegar seja ruim.
    const skip = GM.PARAMS.lixoNovo && AI.badSmallPickup(game, seat, ways[0].score);
    const preferred = AI.wildClosesCanastra(game, seat) || skip ? 0 : 1;
    const best = GM.race(game, seat, cands, AI.applyCandidate,
      Math.round(GM.PARAMS.worldsDraw * GM.importance(game, seat, 'draw')), preferred);
    AI.note(`${GM.summary(cands, 'jeitos de comprar')} Escolheu ${best.label}.${GM.keptText()}`);
    return best;
  },

  // Os jeitos de pegar o lixo a comparar, do melhor para o pior (só os planos; a análise de jogadas também usa).
  pickupPlans(game, seat) {
    return GM.pickupWays(game, seat).map((w) => w.plan);
  },

  // Os jeitos de pegar o lixo com a nota de cada um ({ plan, score }): pela regra nova, os melhores
  // pela nota de AI.pickupOptions; com "lixoNovo" desligado, o jeito antigo (sem nota).
  pickupWays(game, seat) {
    if (GM.PARAMS.lixoNovo) return AI.bestPickups(game, seat, GM.PARAMS.maxPickupPlans);
    return GM.oldPickupPlans(game, seat).map((plan) => ({ plan, score: 0 }));
  },

  // Jeito antigo (só para comparar nos torneios): os primeiros grupos achados (topo + 2 ou mais
  // cartas da mão), limpos antes de sujos; o grupo vai para o primeiro jogo da mesa em que encaixa.
  oldPickupPlans(game, seat) {
    const top = game.topDiscard;
    if (!top || game.isDiscardBlocked() || isThree(top)) return [];
    const p = game.players[seat];
    const team = game.teamOf(seat);
    const hand = p.hand.filter((c) => !isThree(c));
    const options = [];
    const seenGroups = new Set();
    for (let i = 0; i < hand.length; i++) {
      for (let j = i + 1; j < hand.length; j++) {
        if (!Rules.analyzeMeld([top, hand[i], hand[j]]).ok) continue;
        const used = [hand[i], hand[j]];
        for (const c of hand) {
          if (used.includes(c) || isWild(c)) continue;
          if (Rules.analyzeMeld([top, ...used, c]).ok) used.push(c);
        }
        const key = used.map((c) => (isWild(c) ? (isJoker(c) ? 'JK' : 'W2') : `${c.rank}${c.suit}`)).sort().join(',');
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        options.push({ used, dirty: Rules.isDirty([top, ...used]), wilds: used.filter(isWild).length, size: used.length });
      }
    }
    options.sort((x, y) => x.dirty - y.dirty || x.wilds - y.wilds || y.size - x.size);
    const plans = [];
    for (const opt of options) {
      const ids = ['TOP', ...opt.used.map((c) => c.id)];
      const group = [top, ...opt.used];
      if (team.opened) {
        const fits = team.melds.map((m, i) => i).filter((i) => Rules.analyzeMeld(team.melds[i].cards.concat(group)).ok);
        if (fits.length) plans.push({ pickup: true, additions: [{ meldIndex: fits[0], ids }] });
        plans.push({ pickup: true, newMelds: [ids] });
      } else {
        const rest = p.hand.filter((c) => !opt.used.includes(c));
        const others = AI.findMelds(rest, true);
        if (Rules.opensGame([group, ...others], team.minOpen)) {
          plans.push({ pickup: true, newMelds: [ids, ...others.map((m) => m.map((c) => c.id))] });
        }
      }
      if (plans.length >= GM.PARAMS.maxPickupPlans) break;
    }
    return plans.slice(0, GM.PARAMS.maxPickupPlans);
  },

  // Baixar: compara jeitos diferentes e fica com o melhor.
  chooseMelds(game, seat) {
    const variants = GM.meldVariants(game, seat);
    if (!GM.PARAMS.meldSearch) return variants[0];
    // Jeitos que levam exatamente ao mesmo resultado contam uma vez só.
    const distinct = [];
    const seen = new Set();
    for (const v of variants) {
      const g = game.clone();
      AI.quiet++;
      try {
        v.apply(g, seat);
      } finally {
        AI.quiet--;
      }
      const key = g.players[seat].hand.map((c) => c.id).sort().join(',') + '|' +
        g.teamOf(seat).melds.map((m) => m.cards.map((c) => c.id).join('.')).join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(v);
    }
    if (distinct.length <= 1) return distinct[0] || variants[0];
    const finish = (g, s, v) => {
      v.apply(g, s);
      if (g.phase === 'play' && g.current === s) {
        const card = AI.decideDiscard(g, s, 'moderado');
        if (card) g.discard(s, card.id);
      }
    };
    const best = GM.race(game, seat, distinct, finish, GM.PARAMS.worldsMelds, 0); // 0 = regras do Moderado
    AI.note(`${GM.summary(distinct, 'jeitos de baixar')} Escolheu ${best.label}.${GM.keptText()}`);
    return best;
  },

  // Os jeitos de baixar comparados.
  meldVariants(game, seat) {
    const variants = [
      { name: 'padrao', label: 'baixar pelas regras do Moderado', apply: (g, s) => AI.meldAll(g, s, 'moderado') },
      { name: 'guardar', label: 'só aumentar os jogos da mesa', apply: (g, s) => GM.meldConservative(g, s) },
      { name: 'tudo', label: 'baixar tudo o que der', apply: (g, s) => GM.meldEverything(g, s) },
    ];
    // Ainda sem abrir: também compara a 2ª e a 3ª melhores aberturas.
    if (!game.teamOf(seat).opened) {
      const opens = AI.bestOpening(game, seat);
      opens.slice(1, 3).forEach((cand, k) => {
        const plan = { newMelds: cand.melds.map((m) => m.map((c) => c.id)) };
        variants.push({
          name: `abertura${k + 2}`,
          label: `abrir com ${cand.melds.map(AI.names).join(' + ')}`,
          apply: (g, s) => {
            if (!AI.wouldStrand(g, s, plan) && g.applyMelds(s, plan).ok) {
              for (let guard = 0; guard < 60 && g.phase === 'play'; guard++) {
                if (!AI.nextMeldAction(g, s, 'moderado')) break;
              }
            }
          },
        });
      });
    }
    return variants;
  },

  // "Só aumentar os jogos da mesa": acrescenta cartas e fecha canastras com curinga, sem jogo novo.
  meldConservative(g, seat) {
    const team = g.teamOf(seat);
    if (!team.opened) return; // sem abrir: espera
    const p = g.players[seat];
    for (let guard = 0; guard < 40 && g.phase === 'play'; guard++) {
      let done = false;
      for (const c of p.hand) {
        if (isWild(c) || isThree(c)) continue;
        const i = team.melds.findIndex((m) => Rules.analyzeMeld(m.cards.concat([c])).ok);
        const plan = { additions: [{ meldIndex: i, ids: [c.id] }] };
        if (i >= 0 && !AI.wouldStrand(g, seat, plan) && g.applyMelds(seat, plan).ok) {
          done = true;
          break;
        }
      }
      if (!done) {
        const wild = p.hand.find(isJoker) || (Rules.hasCleanCanastra(team.melds) ? p.hand.find(isDirtyWild) : null);
        const i = wild ? team.melds.findIndex((m) => m.cards.length === 6 && !m.cards.some(isWild)) : -1;
        const plan = i >= 0 ? { additions: [{ meldIndex: i, ids: [wild.id] }] } : null;
        done = !!plan && !AI.wouldStrand(g, seat, plan) && g.applyMelds(seat, plan).ok;
      }
      if (!done) break;
    }
  },

  // "Baixar tudo o que der": abre, acrescenta e baixa toda sequência possível, com curinga também.
  // Mas nunca fica "preso" (menos de 3 cartas sem canastra limpa na dupla).
  meldEverything(g, seat) {
    const team = g.teamOf(seat);
    if (!team.opened && !AI.tryOpen(g, seat, 'moderado')) return;
    const p = g.players[seat];
    const try_ = (plan) => !AI.wouldStrand(g, seat, plan) && g.applyMelds(seat, plan).ok;
    for (let guard = 0; guard < 60 && g.phase === 'play'; guard++) {
      let done = false;
      for (const c of p.hand) {
        if (isWild(c) || isThree(c)) continue;
        const i = team.melds.findIndex((m) => Rules.analyzeMeld(m.cards.concat([c])).ok);
        if (i >= 0 && try_({ additions: [{ meldIndex: i, ids: [c.id] }] })) {
          done = true;
          break;
        }
      }
      if (!done) {
        for (const m of AI.findMelds(p.hand, true)) {
          if (try_({ newMelds: [m.map((c) => c.id)] })) {
            done = true;
            break;
          }
        }
      }
      if (!done) {
        const wild = p.hand.find(isWild);
        const i = wild ? team.melds.findIndex((m) => !m.cards.some(isWild) && Rules.analyzeMeld(m.cards.concat([wild])).ok) : -1;
        done = i >= 0 && try_({ additions: [{ meldIndex: i, ids: [wild.id] }] });
      }
      if (!done) break;
    }
  },

  // Descartar: compara todas as cartas diferentes da mão (curinga só se não houver outra).
  chooseDiscard(game, seat) {
    const hand = game.players[seat].hand;
    if (!hand.length) return null;
    if (hand.length === 1) {
      AI.note(`Descartou ${cardName(hand[0])}, a última carta da mão.`);
      return hand[0];
    }
    const typeOf = (c) => (isWild(c) ? (isJoker(c) ? 'JK' : 'W2') : `${c.rank}${c.suit}`);
    const seen = new Set();
    let cards = [];
    for (const c of hand) {
      if (seen.has(typeOf(c))) continue; // as duas cópias da mesma carta dão o mesmo resultado
      seen.add(typeOf(c));
      cards.push(c);
    }
    const naturals = cards.filter((c) => !isWild(c));
    if (naturals.length) cards = naturals;
    if (!GM.PARAMS.wideDiscard) {
      const ranked = AI.rankDiscards(game, seat, 'moderado').map((r) => r.card);
      cards = cards.filter((c) => ranked.slice(0, 6).includes(c)).slice(0, AI.SIM.candidates);
    }
    if (cards.length === 1) {
      AI.note(`Descartou ${cardName(cards[0])}: era a única opção sem curinga.`);
      return cards[0];
    }
    const cands = cards.map((c) => ({ kind: 'discard', card: c, label: cardName(c) }));
    // Escolha das regras do Moderado: o 3 preto, ou a carta de menor nota.
    const typeKey = (c) => (isWild(c) ? (isJoker(c) ? 'JK' : 'W2') : `${c.rank}${c.suit}`);
    const ruleCard = hand.find(isBlackThree) || AI.rankDiscards(game, seat, 'moderado')[0].card;
    const preferred = cands.findIndex((c) => typeKey(c.card) === typeKey(ruleCard));
    const best = GM.race(game, seat, cands, AI.applyCandidate,
      Math.round(GM.PARAMS.worldsDiscard * GM.importance(game, seat, 'discard')), preferred);
    AI.note(`${GM.summary(cands, 'descartes')} Descartou ${best.label}.${GM.keptText()}`);
    return best.card;
  },

  // Explicação quando ficou com a escolha das regras por falta de vantagem clara.
  keptText() {
    return GM.stats.keptDefault
      ? ' (Outra opção teve média um pouco maior, mas a diferença não era clara: ficou com a escolha das regras.)' : '';
  },

  // Volta os parâmetros ao padrão.
  resetParams() {
    GM.PARAMS = { ...GM.PARAMS_DEFAULT };
  },
};
GM.resetParams();
