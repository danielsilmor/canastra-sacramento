/*
 * analise.js: confere as jogadas gravadas pelo historico.js (usado pela página analise.html).
 *
 * Para cada decisão de uma jogada (compra, baixadas e descarte), monta a mesa exatamente como
 * estava e compara a opção escolhida com as alternativas. Cada opção é jogada nos mesmos
 * "mundos possíveis": as cartas que o jogador da vez não via são sorteadas (pesadas pelo que
 * os adversários fizeram, como faz o Mestre) e a rodada continua por algumas jogadas.
 * Usa só o que o jogador da vez sabia. É o mesmo tipo de conta do Mestre, com muito mais mundos.
 */

const Analise = {
  EQUIPES: ['Nós', 'Eles'],

  // ---------- Texto ----------

  mao(ids, publicos = new Set()) {
    if (!ids.length) return '—';
    return sortHand(ids.map((id) => Historico.carta(id)))
      .map((c) => cardName(c) + (publicos.has(c.id) ? '*' : '')).join(' ');
  },
  jogo(ids) {
    return ids.map((id) => cardName(Historico.carta(id))).join(' ');
  },
  nivel(n) {
    if (n === 'humano') return 'você';
    return AI.LEVELS[n] ? AI.LEVELS[n].label : n || '?';
  },

  // Uma linha por jogada.
  resumo(j) {
    return `#${j.n}  rodada ${j.rodada}  ${j.nome} (${this.nivel(j.nivel)})${j.marcada ? '  ⚑' : ''}: ${j.registro.join(' ')}`;
  },

  // A situação antes da jogada, o que foi feito e os motivos do bot.
  situacao(partida, j) {
    const f = j.antes;
    const L = [];
    L.push(`Jogada ${j.n}, rodada ${j.rodada}: vez de ${j.nome} (${this.nivel(j.nivel)}), dupla ${this.EQUIPES[j.lugar % 2]}` +
      (j.marcada ? '  ⚑ marcada como duvidosa' : ''));
    L.push(`Placar (antes desta rodada): Nós ${f.duplas[0].placar} × Eles ${f.duplas[1].placar}`);
    const top = f.lixo.length ? Historico.carta(f.lixo[f.lixo.length - 1]) : null;
    L.push(`Monte: ${f.monte.length} cartas.  Lixo (${f.lixo.length}): ${f.lixo.length ? this.jogo(f.lixo) : 'vazio'}` +
      (top ? `  → topo ${cardName(top)}${isLockingCard(top) ? ' (travado)' : ''}` : ''));
    if (f.primeiraVez) L.push('Primeira vez da rodada (pode comprar a 2ª carta).');
    L.push('Mãos (* = carta que todos viram ele pegar do lixo):');
    for (let s = 0; s < 4; s++) {
      const pub = new Set(f.publico[s]);
      L.push(`  ${partida.nomes[s]} (${this.EQUIPES[s % 2]}${s === j.lugar ? ', da vez' : ''}) [${f.maos[s].length}]: ${this.mao(f.maos[s], pub)}`);
    }
    L.push('Mesa:');
    f.duplas.forEach((d, t) => {
      L.push(`  ${this.EQUIPES[t]}: ${d.abriu ? 'abriu' : `ainda não abriu (precisa de ${d.minimo} pontos)`}${d.vu ? ', VU' : ''}` +
        (d.tres.length ? `; 3 vermelhos: ${this.jogo(d.tres)}` : ''));
      for (const m of d.jogos) {
        const cards = m.map((id) => Historico.carta(id));
        const tag = cards.length >= 7 ? (Rules.isCleanCanastra(cards) ? '  [canastra limpa]' : '  [canastra suja]') : '';
        L.push(`    ${this.jogo(m)}${tag}`);
      }
    });
    L.push('O que aconteceu:');
    for (const r of j.registro) L.push(`  ${r}`);
    if (j.porque && j.porque.length) {
      L.push('Motivos anotados pelo bot:');
      for (const p of j.porque) L.push(`  - ${p}`);
    }
    return L.join('\n');
  },

  // ---------- As decisões da jogada ----------

  copia(g, nomes) {
    return Historico.restaurar(Historico.foto(g), nomes);
  },

  chavePlano(p) {
    const ids = (list) => list.map(String).sort();
    return JSON.stringify({
      n: (p.newMelds || []).map(ids).sort(),
      a: (p.additions || []).map((x) => [x.meldIndex, ids(x.ids)]).sort(),
    });
  },

  textoPlano(g, seat, p) {
    const nome = (id) => (id === 'TOP' ? `${cardName(g.topDiscard)} do lixo` : cardName(Historico.carta(id)));
    const melds = g.teamOf(seat).melds;
    const partes = [
      ...(p.newMelds || []).map((m) => `baixar ${m.map(nome).join(' ')}`),
      ...(p.additions || []).map((a) => `pôr ${a.ids.map(nome).join(' ')} no jogo ${melds[a.meldIndex]
        ? melds[a.meldIndex].cards.map(cardName).join(' ') : '?'}`),
    ];
    return partes.join('; ') || 'nada';
  },

  // Monta cada decisão da jogada com as opções e a que foi escolhida.
  decisoes(partida, j) {
    const seat = j.lugar;
    const nomes = partida.nomes;
    const g = Historico.restaurar(j.antes, nomes);
    const acoes = j.acoes;
    const out = [];
    let k = 0;
    const refaz = (a) => {
      const r = Historico.aplicarAcao(g, seat, a);
      if (!r.ok) throw new Error(`não consegui refazer a ação ${a.tipo}: ${r.error}`);
    };

    // 1. Compra: monte ou um dos jeitos de pegar o lixo.
    if (g.phase === 'draw' && acoes.length) {
      if (acoes[0].tipo === 'endByEmptyStock') return out;
      if (!g.stock.length) {
        out.push({ tipo: 'Compra', nota: 'O monte tinha acabado: só restava pegar o lixo ou encerrar a rodada.' });
      } else {
        const plans = GM.pickupPlans(g, seat);
        const a = acoes[0];
        const cands = [{ kind: 'stock', label: 'comprar do monte' },
          ...plans.map((plan) => ({ kind: 'pickup', plan, label: `pegar o lixo: ${this.textoPlano(g, seat, plan)}` }))];
        let escolhida = 0;
        if (a.tipo === 'applyMelds') {
          escolhida = cands.findIndex((c) => c.plan && this.chavePlano(c.plan) === this.chavePlano(a.plano));
          if (escolhida < 0) {
            cands.push({ kind: 'pickup', plan: a.plano, label: `pegar o lixo: ${this.textoPlano(g, seat, a.plano)}` });
            escolhida = cands.length - 1;
          }
        }
        if (cands.length > 1) out.push({ tipo: 'Compra', game: this.copia(g, nomes), seat, cands, escolhida, aplicar: AI.applyCandidate });
        else out.push({ tipo: 'Compra', nota: 'Só dava para comprar do monte (o lixo não servia ou estava travado).' });
      }
      while (k < acoes.length && (g.phase === 'draw' || acoes[k].tipo === 'secondDraw')) refaz(acoes[k++]);
    }

    // 2. Baixadas: o que foi feito contra os outros jeitos de baixar.
    if (g.phase === 'play' && g.current === seat) {
      const feitas = [];
      while (k + feitas.length < acoes.length && acoes[k + feitas.length].tipo === 'applyMelds') feitas.push(acoes[k + feitas.length]);
      const base = this.copia(g, nomes);
      const tmp = this.copia(g, nomes);
      const textos = feitas.map((a) => {
        const t = this.textoPlano(tmp, seat, a.plano);
        tmp.applyMelds(seat, a.plano);
        return t;
      });
      const opcoes = [
        { label: `como foi feito: ${textos.length ? textos.join('; ') : 'não baixou nada'}`, apply: (x, s) => feitas.forEach((a) => x.applyMelds(s, a.plano)) },
        { label: 'não baixar nada', apply: () => {} },
        ...GM.meldVariants(base, seat).map((v) => ({ label: v.label, apply: v.apply })),
      ];
      // Jeitos que dão exatamente no mesmo resultado contam uma vez só.
      const distintas = [];
      const vistos = new Map();
      for (const v of opcoes) {
        const t = base.clone();
        AI.quiet++;
        try {
          v.apply(t, seat);
        } finally {
          AI.quiet--;
        }
        const key = t.players[seat].hand.map((c) => c.id).sort().join(',') + '|' +
          t.teamOf(seat).melds.map((m) => m.cards.map((c) => c.id).join('.')).join('/');
        if (vistos.has(key)) continue;
        vistos.set(key, v);
        distintas.push(v);
      }
      const termina = (x, s, v) => {
        v.apply(x, s);
        if (x.phase === 'play' && x.current === s) {
          const card = AI.decideDiscard(x, s, 'moderado');
          if (card) x.discard(s, card.id);
        }
      };
      if (distintas.length > 1) out.push({ tipo: 'Baixadas', game: base, seat, cands: distintas, escolhida: 0, aplicar: termina });
      else out.push({ tipo: 'Baixadas', nota: 'Os outros jeitos de baixar dariam no mesmo resultado.' });
      for (const a of feitas) refaz(a);
      k += feitas.length;
    }

    // 3. Descarte: cada carta diferente da mão.
    if (g.phase === 'play' && g.current === seat && acoes[k] && acoes[k].tipo === 'discard') {
      const hand = g.players[seat].hand;
      const tipo = (c) => (isWild(c) ? (isJoker(c) ? 'JK' : 'W2') : `${c.rank}${c.suit}`);
      const vistos = new Set();
      let cartas = [];
      for (const c of hand) {
        if (vistos.has(tipo(c))) continue;
        vistos.add(tipo(c));
        cartas.push(c);
      }
      const feita = hand.find((c) => c.id === acoes[k].carta);
      const naturais = cartas.filter((c) => !isWild(c));
      if (naturais.length && feita && !isWild(feita)) cartas = naturais; // curinga só entra se foi ele o descartado
      const cands = cartas.map((c) => ({ kind: 'discard', card: c, label: `descartar ${cardName(c)}` }));
      const escolhida = feita ? cands.findIndex((c) => tipo(c.card) === tipo(feita)) : -1;
      if (cands.length > 1 && escolhida >= 0) {
        out.push({ tipo: 'Descarte', game: this.copia(g, nomes), seat, cands, escolhida, aplicar: AI.applyCandidate });
      } else out.push({ tipo: 'Descarte', nota: 'Só havia uma carta possível para descartar.' });
    }
    return out;
  },

  // ---------- Conferir ----------

  /*
   * Joga cada opção da decisão nos mesmos "mundos" sorteados. Gera o andamento (mundos feitos)
   * a cada lote e, no fim, devolve a tabela de resultados.
   */
  *avaliar(dec, mundos) {
    GM.resetParams();
    const g = dec.game;
    const team = g.players[dec.seat].team;
    const vals = dec.cands.map(() => []);
    let feitos = 0;
    while (feitos < mundos) {
      const lote = Math.min(20, mundos - feitos);
      AI.quiet++;
      try {
        for (const hidden of GM.sampleWorlds(g, dec.seat, lote)) {
          dec.cands.forEach((c, i) => {
            const im = AI.imagine(g, hidden);
            dec.aplicar(im, dec.seat, c);
            vals[i].push(GM.value(g, im, team));
          });
        }
      } finally {
        AI.quiet--;
      }
      feitos += lote;
      yield feitos;
    }
    return this.resultado(dec, vals);
  },

  resultado(dec, vals) {
    const media = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const ref = vals[dec.escolhida];
    const linhas = dec.cands.map((c, i) => {
      const d = vals[i].map((v, w) => v - ref[w]);
      const md = media(d);
      const sd = Math.sqrt(d.reduce((s, v) => s + (v - md) * (v - md), 0) / Math.max(1, d.length - 1));
      return { label: c.label, media: media(vals[i]), dif: md, margem: (1.96 * sd) / Math.sqrt(Math.max(1, d.length)), escolhida: i === dec.escolhida };
    }).sort((a, b) => b.media - a.media);
    const melhor = linhas[0];
    const escolhida = linhas.find((l) => l.escolhida);
    let veredito;
    if (melhor.escolhida) veredito = { tipo: 'boa', texto: 'Boa jogada: foi a melhor opção.' };
    else if (melhor.dif - melhor.margem > 0) {
      veredito = melhor.dif >= 50
        ? { tipo: 'ruim', texto: `Jogada ruim: "${melhor.label}" rende em média ${Math.round(melhor.dif)} pontos a mais (margem ±${Math.round(melhor.margem)}).` }
        : { tipo: 'pior', texto: `Jogada um pouco pior: "${melhor.label}" rende em média ${Math.round(melhor.dif)} pontos a mais (margem ±${Math.round(melhor.margem)}). Diferença pequena.` };
    } else {
      veredito = { tipo: 'empate', texto: `Jogada razoável: a melhor opção ("${melhor.label}") teve só ${Math.round(melhor.dif)} pontos a mais, dentro da margem (±${Math.round(melhor.margem)}). Na prática, empate.` };
    }
    return { tipo: dec.tipo, linhas, escolhida, veredito, mundos: ref.length };
  },

  textoResultado(r) {
    const sinal = (v) => (v >= 0 ? '+' : '') + Math.round(v);
    const L = [`${r.tipo} (${r.mundos} mundos)`];
    L.push('   média   diferença para a feita   opção');
    for (const l of r.linhas) {
      const dif = l.escolhida ? '      (a feita)      ' : `${sinal(l.dif).padStart(6)} ± ${String(Math.round(l.margem)).padEnd(4)}       `;
      L.push(`  ${sinal(l.media).padStart(6)}   ${dif}  ${l.escolhida ? '✓ ' : '  '}${l.label}`);
    }
    L.push(`  → ${r.veredito.texto}`);
    return L.join('\n');
  },

  // Confere a jogada inteira de uma vez (sem pausas). Devolve o texto.
  conferirTexto(partida, j, mundos) {
    const L = [];
    let decs;
    try {
      decs = this.decisoes(partida, j);
    } catch (e) {
      return `Não deu para conferir a jogada ${j.n}: ${e.message}`;
    }
    if (!decs.length) return 'Nada a conferir nesta jogada.';
    for (const dec of decs) {
      if (dec.nota) {
        L.push(`${dec.tipo}: ${dec.nota}`);
        continue;
      }
      const it = this.avaliar(dec, mundos);
      let step = it.next();
      while (!step.done) step = it.next();
      L.push(this.textoResultado(step.value));
    }
    return L.join('\n\n');
  },

  NOTA: 'Como ler: para cada opção, a mesa foi jogada em vários "mundos possíveis" (as cartas escondidas ' +
    'sorteadas entre as que o jogador não via) por mais algumas jogadas. "Média" = vantagem da dupla ' +
    'no placar ao fim dessas jogadas. "Diferença" = quanto a opção rende a mais (+) ou a menos (−) que a ' +
    'jogada feita, nos mesmos mundos, com a margem de erro de 95%. É o mesmo tipo de conta do Mestre, ' +
    'com bem mais mundos: é uma boa referência, não uma verdade absoluta.',
};
