/*
 * mesa.js: a mesa do modo online, no navegador de quem criou a sala (o "anfitrião").
 *
 * O anfitrião guarda a partida de verdade (game.js): embaralha, distribui, confere cada jogada
 * com as mesmas regras do jogo sozinho e joga pelos bots. Depois de cada passo, publica no banco:
 *   jogos/<sala>/estado        o que todos podem ver (mesa, lixo, quantas cartas cada um tem, placar...)
 *   jogos/<sala>/maos/<lugar>  a mão de cada pessoa (só ela consegue ler)
 * e recebe as jogadas das pessoas em jogos/<sala>/acoes/<lugar> ({ n, acao }).
 * A mão dos bots e a ordem do monte nunca saem deste navegador.
 *
 * Os lugares aqui são os de verdade (cadeiras 0 a 3 da sala). Cada navegador gira a mesa
 * para ver a si mesmo embaixo (espelho.js).
 */

const Mesa = {
  PASSO_BOT_MS: 900,      // pausa entre os passos de um bot (para todos acompanharem)
  EVENTOS: 40,            // eventos recentes em cada publicação (quem atrasou não perde nenhum)
  LINHAS: 80,             // linhas recentes do histórico em cada publicação

  // Nos testes, cada mesa é um Object.create(Mesa).
  iniciar(sala, rede, opcoes = {}) {
    this.sala = sala;
    this.rede = rede;
    this.caminho = `jogos/${sala.id}`;
    this.passo = opcoes.passo !== undefined ? opcoes.passo : this.PASSO_BOT_MS;
    this.aoPublicar = opcoes.aoPublicar || null; // a tela do próprio anfitrião (sem passar pelo banco)
    this.humanos = [];
    this.uids = {};
    const nomes = [];
    // Personagens dos bots (os mesmos do jogo sozinho; nos testes, sem a tela, só nomes).
    const lista = typeof CHARACTERS !== 'undefined' ? CHARACTERS
      : ['Aline', 'Danilo', 'Kátia', 'Lucas', 'Raíssa', 'Vitor'].map((name) => ({ name, img: null, female: false }));
    const personagens = shuffle([...lista]);
    this.personagens = {};
    for (let s = 0; s < 4; s++) {
      const pessoa = sala.lugares && sala.lugares[s];
      if (pessoa) {
        this.humanos.push(s);
        this.uids[s] = pessoa.uid;
        nomes.push(pessoa.nome);
      } else {
        // Bot: um personagem com nome diferente de todas as pessoas da mesa.
        const usados = new Set(nomes.map((n) => Rede.chaveDoNome(n)));
        const ocupados = Object.values(sala.lugares || {}).filter(Boolean).map((p) => Rede.chaveDoNome(p.nome));
        const c = personagens.find((x) => !usados.has(Rede.chaveDoNome(x.name)) && !ocupados.includes(Rede.chaveDoNome(x.name)));
        personagens.splice(personagens.indexOf(c), 1);
        this.personagens[s] = c;
        nomes.push(c.name);
      }
    }
    this.niveis = {};
    for (let s = 0; s < 4; s++) {
      if (!this.humanos.includes(s)) {
        const n = sala.niveis && sala.niveis[s];
        this.niveis[s] = AI.LEVELS[n] ? n : AI.DEFAULT_LEVEL;
      }
    }
    this.nomes = nomes;
    // Ninguém é "Você" na partida de verdade: as linhas do histórico usam os nomes de todos.
    const g = new Game({ names: nomes, allBots: true });
    g.teams[0].name = `${nomes[0]} e ${nomes[2]}`;
    g.teams[1].name = `${nomes[1]} e ${nomes[3]}`;
    this.g = g;
    this.seq = 0;
    this.eventoN = 0;
    this.cursorEventos = 0;
    this.eventos = [];
    this.linhaN = 0;
    this.linhas = [];
    this.compras = {};       // lugar → cartas que essa pessoa comprou do monte (só ela vê): [{ n, carta }]
    this.distribuidas = {};  // lugar → as 15 cartas que essa pessoa recebeu na distribuição
    this.respostas = {};     // lugar → { n, erro } da última jogada recebida dessa pessoa
    this.ultimaAcao = {};
    this.pendentes = {};
    this.esperando = null;
    this.prontos = new Set();
    this.ativa = true;
    // Grava a partida neste navegador (para conferir as jogadas dos bots depois, como no jogo sozinho).
    Historico.iniciar(g, { ...this.niveis }, opcoes.guardarHistorico !== false);
    const addLog = g.addLog;
    g.addLog = (text, seat = null) => {
      addLog.call(g, text, seat);
      if (!g.quiet) this.novaLinha(text, seat);
    };
    // Distribui e publica antes de ouvir as jogadas (o banco só deixa ouvir depois que a partida existe).
    g.newMatch();
    this.publicar();
    rede.armarSaida(this.caminho, null); // se o anfitrião cair, a partida some junto com a sala
    this.pararAcoes = rede.db.ouvir(`${this.caminho}/acoes`, (v) => {
      for (const s of [...this.humanos]) {
        const a = v && v[s];
        if (a && a.acao) this.receberAcao(s, a.n, a.acao);
      }
    });
    // Quem fechar o jogo (ou perder a conexão) sai da lista de presentes da sala: um bot assume o lugar.
    this.pararPresentes = rede.db.ouvir(`salas/${sala.id}/presentes`, (v) => {
      for (const s of [...this.humanos]) {
        if (this.uids[s] !== rede.uid && !(v && v[this.uids[s]])) this.virarBot(s, 'saiu da partida');
      }
    });
    this.rodar();
    return this;
  },

  parar() {
    this.ativa = false;
    if (this.pararAcoes) this.pararAcoes();
    if (this.pararPresentes) this.pararPresentes();
    this.pararAcoes = null;
    this.pararPresentes = null;
    if (this.esperando) this.esperando.ok(null);
    this.esperando = null;
  },

  // ---------- O andamento da partida ----------

  async rodar() {
    const g = this.g;
    try {
      while (this.ativa) {
        if (g.phase === 'roundEnd') {
          if (g.matchOver) return;
          // Próxima rodada quando todas as pessoas clicarem em "Próxima rodada".
          await this.esperarProntos();
          if (!this.ativa) return;
          this.prontos.clear();
          this.pendentes = {}; // jogadas que chegaram atrasadas da rodada que terminou
          g.nextRound();
          this.publicar();
          continue;
        }
        const s = g.current;
        if (this.humanos.includes(s)) {
          const recebida = await this.esperarAcao(s);
          if (!this.ativa) return;
          if (!recebida) continue; // a pessoa saiu: agora um bot joga no lugar dela
          const r = Historico.aplicarAcao(g, s, recebida.acao);
          this.respostas[s] = { n: recebida.n, erro: r.ok ? null : r.error };
          this.publicar();
        } else {
          await this.pausa();
          if (!this.ativa) return;
          await AI.takeTurn(g, s, async () => {
            this.publicar();
            await this.pausa();
            if (!this.ativa) throw CANCELADA;
          }, this.niveis[s], true);
          Historico.anotarPorque(s, AI.lastTrace);
          this.publicar();
        }
      }
    } catch (e) {
      if (e === CANCELADA) return;
      console.error(e);
      this.erro = e.message;
      this.publicar();
    }
  },

  pausa() {
    return new Promise((ok) => setTimeout(ok, this.passo));
  },

  // ---------- Jogadas das pessoas ----------

  // Chega uma jogada da pessoa sentada em "s" (pelo banco ou, a do anfitrião, direto da tela dele).
  receberAcao(s, n, acao) {
    if (!this.ativa || !this.humanos.includes(s) || !(n > (this.ultimaAcao[s] || 0))) return;
    if (acao.tipo === 'sair') {
      this.ultimaAcao[s] = n;
      this.virarBot(s, 'saiu da partida');
      return;
    }
    if (acao.tipo === 'pronto') { // clicou em "Próxima rodada"
      this.ultimaAcao[s] = n;
      this.respostas[s] = { n, erro: null };
      this.prontos.add(s);
      this.publicar();
      this.conferirProntos();
      return;
    }
    this.pendentes[s] = { n, acao };
    this.entregar(s);
  },

  // A pessoa do lugar "s" saiu: um bot (no nível escolhido na sala para essa cadeira) joga no lugar dela.
  virarBot(s, motivo) {
    if (!this.ativa || !this.humanos.includes(s)) return;
    this.humanos = this.humanos.filter((x) => x !== s);
    const n = this.sala.niveis && this.sala.niveis[s];
    this.niveis[s] = AI.LEVELS[n] ? n : AI.DEFAULT_LEVEL;
    Historico.niveis[s] = this.niveis[s];
    delete this.pendentes[s];
    this.g.addLog(`${this.nomes[s]} ${motivo}. Um bot (${AI.LEVELS[this.niveis[s]].label}) joga no lugar.`);
    if (this.esperando && this.esperando.lugar === s) {
      const { ok } = this.esperando;
      this.esperando = null;
      ok(null);
    }
    this.publicar();
    this.conferirProntos();
  },

  esperarAcao(s) {
    return new Promise((ok) => {
      this.esperando = { lugar: s, ok };
      this.entregar(s);
    });
  },

  entregar(s) {
    const p = this.pendentes[s];
    if (!p || !this.esperando || this.esperando.lugar !== s) {
      // Jogada fora da vez: avisa a pessoa (a tela dela já não deixaria, mas o banco pode atrasar).
      if (p && (!this.esperando || this.esperando.lugar !== s) && this.g.current !== s) {
        delete this.pendentes[s];
        this.ultimaAcao[s] = p.n;
        this.respostas[s] = { n: p.n, erro: 'Não é a sua vez.' };
        this.publicar();
      }
      return;
    }
    delete this.pendentes[s];
    this.ultimaAcao[s] = p.n;
    const { ok } = this.esperando;
    this.esperando = null;
    ok(p);
  },

  esperarProntos() {
    return new Promise((ok) => {
      this.aoFicaremProntos = ok;
      this.conferirProntos();
    });
  },
  conferirProntos() {
    if (this.aoFicaremProntos && this.humanos.every((s) => this.prontos.has(s))) {
      const ok = this.aoFicaremProntos;
      this.aoFicaremProntos = null;
      ok();
    }
  },

  // ---------- Publicar ----------

  novaLinha(text, seat) {
    this.linhas.push({ n: ++this.linhaN, text, seat: seat === null || seat === undefined ? -1 : seat });
    if (this.linhas.length > this.LINHAS) this.linhas.shift();
  },

  // Passa os eventos novos do jogo para a lista pública; as cartas escondidas
  // (compradas do monte, distribuídas) vão só para a mão de quem as recebeu.
  coletarEventos() {
    const g = this.g;
    const id = (c) => c.id;
    for (const ev of g.events.slice(this.cursorEventos)) {
      const n = ++this.eventoN;
      const pub = { n, type: ev.type, seat: ev.seat === undefined ? -1 : ev.seat };
      if (ev.type === 'deal') {
        pub.dealer = ev.dealer;
        this.compras = {};
        for (const s of this.humanos) this.distribuidas[s] = ev.hands[s].map(id);
      } else if (ev.type === 'draw') {
        if (this.humanos.includes(ev.seat)) {
          const lista = this.compras[ev.seat] || (this.compras[ev.seat] = []);
          lista.push({ n, carta: ev.card.id });
          if (lista.length > this.EVENTOS) lista.shift();
        }
      } else if (ev.type === 'pickup') {
        pub.top = ev.top.id;
        pub.pile = ev.pile.map(id);
      } else if (ev.cards) {
        pub.cards = ev.cards.map(id);
      } else if (ev.card) {
        pub.card = ev.card.id;
      }
      this.eventos.push(pub);
      if (this.eventos.length > this.EVENTOS) this.eventos.shift();
    }
    this.cursorEventos = g.events.length;
  },

  // O que todos podem ver, em lugares de verdade.
  estadoPublico() {
    const g = this.g;
    const ids = (cs) => cs.map((c) => c.id);
    const lr = g.lastRound;
    return {
      seq: this.seq,
      nomes: this.nomes,
      humanos: this.humanos,
      niveis: this.niveis,
      personagens: Object.fromEntries(Object.entries(this.personagens).map(([s, c]) => [s, { img: c.img || '', f: !!c.female }])),
      rodada: g.round,
      fase: g.phase,
      vez: g.current,
      carteador: g.dealer,
      primeiraVez: g.isFirstTurn,
      monte: g.stock.length,
      lixo: ids(g.discardPile),
      maos: g.players.map((p) => p.hand.length),
      duplas: g.teams.map((t) => ({
        placar: t.score, abriu: t.opened, vu: t.vu, minimo: t.minOpen,
        jogos: t.melds.map((m) => ids(m.cards)), tres: ids(t.redThrees),
      })),
      fimPartida: g.matchOver,
      vencedor: g.winner === null || g.winner === undefined ? -1 : g.winner,
      ultimaRodada: lr ? { rodada: lr.round, batedor: lr.batedor === null ? -1 : lr.batedor, resultados: lr.results } : null,
      // No fim da rodada, todas as mãos ficam à vista (para a contagem de pontos).
      maosFinais: g.phase === 'roundEnd' ? g.players.map((p) => ids(p.hand)) : null,
      eventos: this.eventos,
      linhas: this.linhas,
      respostas: this.respostas,
      prontos: [...this.prontos],
      erro: this.erro || null,
    };
  },

  // A mão de cada pessoa (só ela lê).
  maoDe(s) {
    const g = this.g;
    const vez = g.current === s && (g.phase === 'draw' || g.phase === 'play');
    return {
      seq: this.seq,
      cartas: g.players[s].hand.map((c) => c.id),
      novas: vez ? [...g.turn.newIds] : [],
      trocar: vez && !!g.turn.canSecondDraw,
      primeira: vez && g.turn.firstCardId ? g.turn.firstCardId : null,
      compras: this.compras[s] || [],
      distribuidas: this.distribuidas[s] || [],
    };
  },

  publicar() {
    this.coletarEventos();
    this.seq++;
    const estado = this.estadoPublico();
    // "anfitriao": as regras do banco deixam só quem criou a sala gravar (e apagar) a partida.
    const tudo = { anfitriao: this.rede.uid, estado };
    const maos = {};
    for (const s of this.humanos) {
      maos[s] = this.maoDe(s);
      tudo[`maos/${s}`] = maos[s];
    }
    this.rede.db.atualizar(this.caminho, tudo);
    if (this.aoPublicar) this.aoPublicar(estado, maos);
  },
};

const CANCELADA = new Error('mesa encerrada');
