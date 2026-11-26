/*
 * espelho.js: a partida online vista por um jogador.
 *
 * Cada navegador monta a sua própria cópia da mesa (um Game), girada para que a pessoa fique
 * no lugar 0 (embaixo), com a dupla dela como "Nós". Assim a tela (ui.js) funciona igual ao jogo
 * sozinho. A cópia tem só o que essa pessoa pode ver: a própria mão e o que está na mesa; as cartas
 * dos outros e do monte aparecem como cartas viradas, sem valor.
 *
 * A cada publicação da mesa (mesa.js), a cópia é atualizada e os acontecimentos novos são animados.
 * As jogadas desta pessoa não mudam a cópia: são conferidas com as regras do jogo numa cópia
 * descartável e enviadas para a mesa, que responde na publicação seguinte.
 */

const Espelho = {
  ativo: false,

  // ---------- Começar e terminar ----------

  // opções: { sala, meu (cadeira de verdade), nome (desta pessoa), anfitriao (true = roda a mesa aqui),
  //           rede, tela (false nos testes: só monta a cópia, sem animar) }
  iniciar(opcoes) {
    this.ativo = true;
    this.sala = opcoes.sala;
    this.meu = opcoes.meu;
    this.nome = opcoes.nome;
    this.rede = opcoes.rede;
    this.tela = opcoes.tela !== false;
    this.anfitriao = !!opcoes.anfitriao;
    this.g = null;
    this.estado = null;
    this.mao = null;
    this.fila = [];
    this.processando = false;
    this.ultimoEvento = 0;
    this.ultimaLinha = 0;
    this.ultimoSeq = 0;
    this.pendente = null;
    this.acaoN = Date.now();
    this.fimMostrado = null;
    this.ator = null;
    this.linhasDaVez = [];
    this.parar = [];
    const caminho = `jogos/${this.sala.id}`;
    if (this.anfitriao) {
      this.mesa = Object.create(Mesa);
      this.enviar = (n, acao) => this.mesa.receberAcao(this.meu, n, acao);
      this.mesa.iniciar(this.sala, this.rede, {
        aoPublicar: (estado, maos) => this.receber(estado, maos[this.meu]),
        passo: opcoes.passo, guardarHistorico: opcoes.guardarHistorico,
      });
    } else {
      this.mesa = null;
      this.enviar = (n, acao) => this.rede.db.gravar(`${caminho}/acoes/${this.meu}`, { n, acao });
      let estado = null;
      let mao = null;
      const juntar = () => {
        if (estado && mao && mao.seq >= estado.seq) {
          const e = estado;
          estado = null;
          this.receber(e, mao);
        }
      };
      this.parar.push(this.rede.db.ouvir(`${caminho}/estado`, (v) => {
        if (v) {
          estado = v;
          juntar();
        }
      }));
      this.parar.push(this.rede.db.ouvir(`${caminho}/maos/${this.meu}`, (v) => {
        if (v) {
          mao = v;
          juntar();
        }
      }));
    }
    return this;
  },

  encerrar() {
    if (!this.ativo) return;
    this.ativo = false;
    this.parar.forEach((f) => f());
    this.parar = [];
    if (this.mesa) this.mesa.parar();
    this.mesa = null;
    this.fila = [];
    if (this.tela) UI.sairDoOnline();
  },

  // ---------- Lugares ----------

  vista(s) { // cadeira de verdade → lugar na tela (-1 = ninguém)
    return s === undefined || s === null || s < 0 ? null : (s - this.meu + 4) % 4;
  },
  real(v) { // lugar na tela → cadeira de verdade
    return (v + this.meu) % 4;
  },
  dupla(t) { // dupla de verdade → dupla na tela (0 = a minha)
    return (t - (this.meu % 2) + 2) % 2;
  },
  carta(id) {
    return Historico.carta(id);
  },
  // Carta virada (de outro jogador ou do monte): ninguém sabe qual é.
  oculta(chave) {
    return { id: `?${chave}`, rank: 0, suit: 'X', oculta: true };
  },
  // "Ana comprou do monte." → "Você comprou do monte." (para quem é a Ana).
  trocarNome(texto) {
    const nome = this.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return texto.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${nome}(?=$|[^\\p{L}\\p{N}])`, 'gu'), '$1Você');
  },

  // ---------- Montar a cópia ----------

  // A primeira publicação: cria a cópia com os nomes e os personagens de cada lugar.
  criar(estado) {
    const nomes = [0, 1, 2, 3].map((v) => (v === 0 ? 'Você' : estado.nomes[this.real(v)]));
    const g = new Game({ names: nomes });
    g.teams[0].name = 'Nós';
    g.teams[1].name = 'Eles';
    // As jogadas desta pessoa vão para a mesa (mesa.js) em vez de mudar a cópia.
    for (const metodo of Historico.ACOES) g[metodo] = (seat, ...args) => this.jogar(metodo, args);
    this.g = g;
    const humanos = estado.humanos || [];
    this.personagens = {};
    this.niveis = {};
    for (let v = 1; v < 4; v++) {
      const r = this.real(v);
      const p = estado.personagens && estado.personagens[r];
      this.personagens[v] = humanos.includes(r)
        ? { name: nomes[v], img: null, humano: true }
        : { name: nomes[v], img: p && p.img ? p.img : null, female: !!(p && p.f) };
      this.niveis[v] = humanos.includes(r) ? null : estado.niveis[r];
    }
    return g;
  },

  // Coloca na cópia o que a mesa publicou. Devolve os acontecimentos novos (já na cópia, em g.events).
  aplicar(estado, mao) {
    const g = this.g || this.criar(estado);
    // Quem saiu no meio da partida virou bot: o quadro do jogador passa a mostrar o nível.
    for (let v = 1; v < 4; v++) {
      const r = this.real(v);
      if (!(estado.humanos || []).includes(r) && estado.niveis) this.niveis[v] = estado.niveis[r];
    }
    const V = (s) => this.vista(s);
    const carta = (id) => this.carta(id);
    const mais = (n, k) => Array.from({ length: n || 0 }, (_, i) => this.oculta(`${k}${i}`));
    g.round = estado.rodada;
    g.phase = estado.fase;
    g.current = V(estado.vez);
    g.dealer = V(estado.carteador);
    g.isFirstTurn = !!estado.primeiraVez;
    g.stock = mais(estado.monte, 'm');
    g.discardPile = (estado.lixo || []).map(carta);
    const finais = estado.maosFinais;
    for (let v = 0; v < 4; v++) {
      const r = this.real(v);
      if (finais) g.players[v].hand = (finais[r] || []).map(carta);
      else if (v === 0) g.players[0].hand = (mao.cartas || []).map(carta);
      else g.players[v].hand = mais((estado.maos || [])[r], `${v}-`);
    }
    (estado.duplas || []).forEach((d, t) => {
      Object.assign(g.teams[this.dupla(t)], {
        score: d.placar || 0, opened: !!d.abriu, vu: !!d.vu, minOpen: d.minimo,
        melds: (d.jogos || []).map((ids) => ({ cards: (ids || []).map(carta) })),
        redThrees: (d.tres || []).map(carta),
      });
    });
    const minhaVez = g.current === 0 && (g.phase === 'draw' || g.phase === 'play');
    g.turn = {
      seat: g.current,
      canSecondDraw: minhaVez && !!mao.trocar,
      firstCardId: minhaVez ? mao.primeira || null : null,
      newIds: new Set(minhaVez ? mao.novas || [] : []),
    };
    g.matchOver = !!estado.fimPartida;
    g.winner = estado.vencedor >= 0 ? this.dupla(estado.vencedor) : null;
    const lr = estado.ultimaRodada;
    const minha = this.meu % 2;
    g.lastRound = lr ? {
      round: lr.rodada,
      batedor: lr.batedor >= 0 ? V(lr.batedor) : null,
      results: [lr.resultados[minha], lr.resultados[1 - minha]],
    } : null;

    // Acontecimentos novos (para animar), com as cartas que esta pessoa pode ver.
    const novos = [];
    for (const e of estado.eventos || []) {
      if (!e || !(e.n > this.ultimoEvento)) continue;
      const seat = V(e.seat);
      let ev;
      if (e.type === 'deal') {
        ev = {
          type: 'deal', dealer: V(e.dealer),
          hands: [0, 1, 2, 3].map((v) => (v === 0 ? (mao.distribuidas || []).map(carta) : mais(15, `d${v}-`))),
        };
      } else if (e.type === 'draw') {
        const minhaCompra = seat === 0 && (mao.compras || []).find((c) => c.n === e.n);
        ev = { type: 'draw', seat, card: minhaCompra ? carta(minhaCompra.carta) : this.oculta(`c${e.n}`) };
      } else if (e.type === 'pickup') {
        ev = { type: 'pickup', seat, top: carta(e.top), pile: (e.pile || []).map(carta) };
      } else {
        ev = { type: e.type, seat };
        if (e.cards) ev.cards = e.cards.map(carta);
        if (e.card !== undefined) ev.card = carta(e.card);
      }
      g.events.push(ev);
      novos.push(ev);
      this.ultimoEvento = e.n;
    }
    for (const l of estado.linhas || []) {
      if (!l || !(l.n > this.ultimaLinha)) continue;
      g.log.push({ text: this.trocarNome(l.text), seat: V(l.seat) });
      this.ultimaLinha = l.n;
    }
    this.estado = estado;
    this.mao = mao;
    this.ultimoSeq = estado.seq;
    return novos;
  },

  // ---------- Jogadas desta pessoa ----------

  // Confere a jogada com as regras do jogo numa cópia e, se valer, manda para a mesa.
  jogar(metodo, args) {
    if (!this.ativo) return { ok: false, error: 'A partida online terminou.' };
    if (this.pendente) return { ok: false, error: 'Aguarde: a jogada anterior ainda está chegando na mesa.' };
    const r = Game.prototype[metodo].call(this.g.clone(), 0, ...args);
    if (!r.ok) return r;
    const acao = { tipo: metodo };
    if (metodo === 'applyMelds') acao.plano = args[0];
    if (metodo === 'discard') acao.carta = args[0];
    this.mandar(acao);
    return { ok: true, pending: true };
  },

  mandar(acao) {
    this.acaoN = Math.max(this.acaoN + 1, Date.now());
    this.pendente = { n: this.acaoN, texto: null };
    this.enviar(this.acaoN, acao);
  },

  // "Próxima rodada" (a mesa começa quando todas as pessoas clicarem).
  pronto() {
    if (this.pendente) return;
    this.mandar({ tipo: 'pronto' });
  },

  // Esta pessoa saiu no meio da partida: um bot assume o lugar dela.
  sair() {
    if (!this.ativo || this.anfitriao) return;
    this.acaoN = Math.max(this.acaoN + 1, Date.now());
    this.enviar(this.acaoN, { tipo: 'sair' });
  },

  // ---------- Receber e mostrar ----------

  receber(estado, mao) {
    if (!this.ativo || !estado || !mao || estado.seq <= this.ultimoSeq) return;
    this.fila.push({ estado, mao });
    if (!this.tela) {
      // Testes: só atualiza a cópia, na ordem.
      while (this.fila.length) {
        const u = this.fila.shift();
        if (u.estado.seq > this.ultimoSeq) this.aplicar(u.estado, u.mao);
        this.conferirResposta();
      }
      return;
    }
    this.processar();
  },

  async processar() {
    if (this.processando) return;
    this.processando = true;
    try {
      while (this.fila.length && this.ativo) {
        // Se muita coisa acumulou (ex.: durante a distribuição), mostra tudo de uma vez:
        // cada publicação traz os acontecimentos recentes, então nada se perde.
        if (this.fila.length > 2) this.fila.splice(0, this.fila.length - 1);
        const { estado, mao } = this.fila.shift();
        if (estado.seq <= this.ultimoSeq) continue;
        await this.mostrar(estado, mao);
      }
    } catch (e) {
      console.error(e);
    }
    this.processando = false;
  },

  // A resposta da mesa à jogada desta pessoa chegou?
  conferirResposta() {
    const resp = this.estado && this.estado.respostas && this.estado.respostas[this.meu];
    if (!this.pendente || !resp || resp.n < this.pendente.n) return null;
    const p = this.pendente;
    this.pendente = null;
    return { erro: resp.n === p.n ? resp.erro || null : null, texto: p.texto };
  },

  async mostrar(estado, mao) {
    const ui = UI;
    const antes = this.g ? { vez: this.g.current, fase: this.g.phase, rodada: this.g.round } : null;
    const snap = this.g && ui.game === this.g ? ui.snapshot() : null;
    const novos = this.aplicar(estado, mao);
    const g = this.g;
    if (ui.game !== g) ui.entrarNoOnline(g, this.personagens, this.niveis);
    const token = ui.token;
    const resposta = this.conferirResposta();
    if (estado.erro) ui.toast(`Erro na mesa: ${estado.erro}`);

    // Rodada nova: distribuição animada, como no jogo sozinho.
    const deal = novos.find((ev) => ev.type === 'deal');
    if (deal) {
      ui.eventCursor = g.events.indexOf(deal);
      ui.logCursor = g.log.length;
      ui.hideModal();
      ui.selected.clear();
      ui.staging = null;
      this.fimMostrado = null;
      this.ator = null;
      this.linhasDaVez = [];
      if (g.round > 1) ui.say(`Rodada ${g.round} começou. Carteador: ${g.players[g.dealer].name}.`);
      await ui.playRoundStart();
      return;
    }
    // Entrou com a partida já andando (sem a distribuição): só mostra a mesa como está.
    if (!snap) {
      ui.eventCursor = g.events.length;
      ui.logCursor = g.log.length;
      ui.busy = !!this.pendente;
      if (g.phase === 'roundEnd') return ui.render();
      return ui.afterAction();
    }

    ui.busy = true;
    const linhas = await ui.playNewEvents(snap);
    if (token !== ui.token || !this.ativo) return;
    ui.busy = !!this.pendente;
    // Quadro da jogada: o que aconteceu na vez de cada um (somando os passos da mesma vez).
    const ator = antes && antes.fase !== 'roundEnd' ? antes.vez : null;
    if (linhas.length) {
      if (ator !== this.ator) this.linhasDaVez = [];
      this.ator = ator;
      this.linhasDaVez.push(...linhas);
      const texto = [...this.linhasDaVez];
      if (g.phase !== 'roundEnd' && g.current !== ator) {
        texto.push(g.current === 0 ? 'Agora é a sua vez!' : `Agora é a vez de ${g.players[g.current].name}.`);
      }
      ui.narration = { text: texto.join('\n'), waiting: false, actor: ator === 0 ? null : ator };
    }
    if (resposta) {
      if (resposta.erro) ui.error(resposta.erro);
      else {
        const t = typeof resposta.texto === 'function' ? resposta.texto() : resposta.texto;
        if (t) ui.say(t, 'ok');
      }
    }
    if (g.phase === 'roundEnd') {
      ui.render();
      if (this.fimMostrado !== g.round) {
        this.fimMostrado = g.round;
        ui.showRoundEnd();
      } else ui.updateReady();
      return;
    }
    ui.afterAction();
  },

  // Quem já clicou em "Próxima rodada" (para a janela de pontuação).
  prontos() {
    const e = this.estado;
    if (!e) return { faltam: [], eu: false };
    const prontos = e.prontos || [];
    const faltam = (e.humanos || []).filter((s) => !prontos.includes(s)).map((s) => (s === this.meu ? 'você' : e.nomes[s]));
    return { faltam, eu: prontos.includes(this.meu) };
  },
};
