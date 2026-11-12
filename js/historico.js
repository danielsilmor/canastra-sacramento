/*
 * historico.js: grava a partida jogada por jogada, para conferir depois as jogadas dos bots.
 *
 * Fica guardado neste navegador (localStorage): a partida atual e a anterior.
 * Cada jogada guarda a situação antes dela (cartas de todos, monte, lixo, jogos na mesa,
 * placar e o que cada um viu), as ações feitas, as linhas do histórico e o "por quê" do bot.
 * As jogadas podem ser marcadas como duvidosas (⚑ no histórico da tela).
 * "Baixar histórico" salva tudo num arquivo .json, que a página analise.html abre.
 *
 * Nada aqui muda o jogo: a gravação só observa as ações (comprar, baixar, descartar...).
 * As partidas "imaginadas" pelos bots são cópias e não são gravadas.
 */

const Historico = {
  KEY: 'canastra-historico',
  VERSAO: 1,
  MAX_PARTIDAS: 2,     // a atual e a anterior
  ACOES: ['drawFromStock', 'secondDraw', 'applyMelds', 'discard', 'endByEmptyStock'],
  partidas: [],
  atual: null,         // partida em andamento: { inicio, nomes, jogadas, rodadas }
  jogada: null,        // jogada em andamento
  turnoObj: null,      // o game.turn da jogada em andamento (é um objeto novo a cada vez)
  niveis: {},          // inteligência de cada bot (objeto da tela; pode mudar no meio da partida)
  guardar: true,       // false nos testes: grava só na memória
  dentroDeAcao: 0,
  timer: null,

  // ---------- Gravar ----------

  // Começa a gravar uma partida nova (a tela chama logo depois de criar o Game).
  iniciar(game, niveis = {}, guardar = true) {
    this.guardar = guardar;
    this.partidas = guardar ? this.ler() : [];
    this.atual = { inicio: new Date().toISOString(), nomes: game.players.map((p) => p.name), jogadas: [], rodadas: [] };
    this.partidas = [this.atual, ...this.partidas].slice(0, this.MAX_PARTIDAS);
    this.jogada = null;
    this.turnoObj = null;
    this.niveis = niveis;
    this.ligar(game);
    this.salvar();
  },

  // Observa as ações desta partida (só deste objeto; as cópias dos bots não são observadas).
  ligar(game) {
    const H = this;
    for (const nome of this.ACOES) {
      const original = Game.prototype[nome];
      game[nome] = function (...args) {
        if (this.turn !== H.turnoObj) H.novaJogada(this);
        const copia = JSON.parse(JSON.stringify(args));
        H.dentroDeAcao++;
        let r;
        try {
          r = original.apply(this, args);
        } finally {
          H.dentroDeAcao--;
        }
        if (r && r.ok) H.registrarAcao(this, nome, copia);
        return r;
      };
    }
    // Cada linha do histórico ganha o número da jogada (para a tela mostrar e para marcar).
    const addLog = Game.prototype.addLog;
    game.addLog = function (text, seat = null) {
      addLog.call(this, text, seat);
      if (H.dentroDeAcao && H.jogada && !this.quiet) {
        this.log[this.log.length - 1].n = H.jogada.n;
        H.jogada.registro.push(text);
      }
    };
  },

  novaJogada(g) {
    const seat = g.current;
    this.turnoObj = g.turn;
    this.jogada = {
      n: this.atual.jogadas.length ? this.atual.jogadas[this.atual.jogadas.length - 1].n + 1 : 1,
      rodada: g.round,
      lugar: seat,
      nome: g.players[seat].name,
      nivel: g.players[seat].isHuman ? 'humano' : this.niveis[seat] || '',
      antes: this.foto(g),
      acoes: [],
      registro: [],
      porque: [],
      marcada: false,
    };
    this.atual.jogadas.push(this.jogada);
  },

  registrarAcao(g, nome, args) {
    const a = { tipo: nome };
    if (nome === 'applyMelds') a.plano = args[1];
    if (nome === 'discard') a.carta = args[1];
    this.jogada.acoes.push(a);
    if (g.phase === 'roundEnd' && g.lastRound && !this.atual.rodadas.some((r) => r.rodada === g.round)) {
      this.atual.rodadas.push({
        rodada: g.round,
        batedor: g.lastRound.batedor,
        pontos: g.lastRound.results.map((r) => r.total),
        placar: g.teams.map((t) => t.score),
        depoisDaJogada: this.jogada.n,
      });
    }
    this.salvarDepois();
  },

  // Motivos do bot na jogada que ele acabou de fazer (a tela chama no fim da vez dele).
  anotarPorque(seat, porque) {
    if (this.jogada && this.jogada.lugar === seat) {
      this.jogada.porque = [...porque];
      this.salvarDepois();
    }
  },

  // Número da jogada da vez (a que está acontecendo ou a próxima a começar).
  numeroDa(game) {
    if (this.jogada && game.turn === this.turnoObj) return this.jogada.n;
    const js = this.atual ? this.atual.jogadas : [];
    return js.length ? js[js.length - 1].n + 1 : 1;
  },

  buscar(n) {
    return this.atual ? this.atual.jogadas.find((j) => j.n === n) || null : null;
  },

  // Marca/desmarca uma jogada como duvidosa.
  marcar(n) {
    const j = this.buscar(n);
    if (!j) return false;
    j.marcada = !j.marcada;
    this.salvar();
    return j.marcada;
  },

  // A situação da mesa, só com os números das cartas (cada número é sempre a mesma carta: ver createDeck).
  foto(g) {
    const ids = (cs) => cs.map((c) => c.id);
    return {
      rodada: g.round,
      carteador: g.dealer,
      vez: g.current,
      fase: g.phase,
      primeiraVez: g.isFirstTurn,
      turno: { podeSegunda: !!(g.turn && g.turn.canSecondDraw), primeiraCarta: g.turn ? g.turn.firstCardId : null },
      maos: g.players.map((p) => ids(p.hand)),
      monte: ids(g.stock),
      lixo: ids(g.discardPile),
      duplas: g.teams.map((t) => ({
        placar: t.score, abriu: t.opened, vu: !!t.vu, minimo: t.minOpen,
        jogos: t.melds.map((m) => ids(m.cards)), tres: ids(t.redThrees),
      })),
      publico: g.publicIn.map((s) => [...s]),
      visto: g.observed.map((list) => list.map((o) => ({ k: o.kind, c: o.card.id, a: o.opened }))),
    };
  },

  // ---------- Guardar e baixar ----------

  ler() {
    try {
      const s = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      return s && s.versao === this.VERSAO && Array.isArray(s.partidas) ? s.partidas : [];
    } catch (e) {
      return [];
    }
  },

  salvarDepois() {
    if (!this.guardar) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.salvar(), 200);
  },

  salvar() {
    if (!this.guardar) return;
    clearTimeout(this.timer);
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      try {
        localStorage.setItem(this.KEY, JSON.stringify({ versao: this.VERSAO, partidas: this.partidas }));
        return;
      } catch (e) {
        // Sem espaço: primeiro esquece a partida anterior, depois as jogadas mais antigas.
        if (this.partidas.length > 1) this.partidas = [this.atual];
        else if (this.atual && this.atual.jogadas.length > 40) {
          this.atual.jogadas.splice(0, 30);
          this.atual.cortada = true;
        } else return;
      }
    }
  },

  baixar() {
    this.salvar();
    const d = new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    const nome = `canastra-historico-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}h${p2(d.getMinutes())}.json`;
    const blob = new Blob([JSON.stringify({ versao: this.VERSAO, gerado: d.toISOString(), partidas: this.partidas })],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return nome;
  },

  // ---------- Reconstruir (usado na análise e nos testes) ----------

  cartas: null,
  carta(id) {
    if (!this.cartas) this.cartas = new Map(createDeck().map((c) => [c.id, c]));
    return this.cartas.get(id);
  },

  // Monta uma partida exatamente na situação da foto.
  restaurar(f, nomes) {
    const cs = (list) => list.map((id) => this.carta(id));
    const g = new Game({ allBots: true, names: nomes });
    g.round = f.rodada;
    g.dealer = f.carteador;
    g.current = f.vez;
    g.phase = f.fase;
    g.isFirstTurn = f.primeiraVez;
    g.players.forEach((p, i) => (p.hand = cs(f.maos[i])));
    g.stock = cs(f.monte);
    g.discardPile = cs(f.lixo);
    f.duplas.forEach((d, t) => Object.assign(g.teams[t], {
      score: d.placar, opened: d.abriu, vu: d.vu, minOpen: d.minimo,
      melds: d.jogos.map((list) => ({ cards: cs(list) })), redThrees: cs(d.tres),
    }));
    g.publicIn = f.publico.map((list) => new Set(list));
    g.observed = f.visto.map((list) => list.map((o) => (o.k === 'decline'
      ? { kind: 'decline', card: this.carta(o.c), opened: o.a }
      : { kind: o.k, card: this.carta(o.c) })));
    g.turn = { seat: f.vez, canSecondDraw: f.turno.podeSegunda, firstCardId: f.turno.primeiraCarta, newIds: new Set() };
    g.lastRound = null;
    return g;
  },

  // Refaz uma ação gravada.
  aplicarAcao(g, seat, a) {
    if (a.tipo === 'drawFromStock') return g.drawFromStock(seat);
    if (a.tipo === 'secondDraw') return g.secondDraw(seat);
    if (a.tipo === 'applyMelds') return g.applyMelds(seat, a.plano);
    if (a.tipo === 'discard') return g.discard(seat, a.carta);
    if (a.tipo === 'endByEmptyStock') return g.endByEmptyStock(seat);
    return { ok: false, error: `ação desconhecida: ${a.tipo}` };
  },
};
