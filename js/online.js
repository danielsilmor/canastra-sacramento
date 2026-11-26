/*
 * online.js: tela inicial e telas do modo online (nome, salas e mesa redonda).
 *
 * Fluxo:
 *   início → "Jogar sozinho" (a partida de sempre, ui.js) ou "Jogar online"
 *   online → escolher um nome (não pode repetir) → salas (buscar ou criar)
 *   sala   → cada pessoa escolhe a cadeira (à frente = dupla; dos lados = adversários);
 *            cadeira sem pessoa fica com um bot, de nível escolhido por quem criou a sala,
 *            que começa a partida quando há pelo menos 2 pessoas sentadas.
 * As telas ficam por cima da mesa (div #telas). Os dados vêm do banco online (rede.js).
 */

// Texto digitado por alguém, seguro para pôr no HTML.
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON_BOT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>' +
  '<path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';
const ICON_SENTAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

const NOME_GUARDADO = 'canastra-online-nome';
const POSICAO = ['de baixo', 'da esquerda', 'de cima', 'da direita']; // cadeiras 0 a 3

const Online = {
  tela: null,        // 'inicio' | 'nome' | 'salas' | 'sala'
  conectado: false,
  salas: [],
  sala: null,        // a sala aberta (como está no banco)
  busca: '',
  pararSalas: null,
  pararSala: null,
  ocupado: false,    // esperando o banco responder (evita clique duplo)

  // ---------- Montagem das telas ----------

  el() {
    return $('telas');
  },
  mostrar(tela, html) {
    this.tela = tela;
    const t = this.el();
    t.innerHTML = html;
    t.classList.remove('hidden');
    t.scrollTop = 0;
    document.body.classList.add('com-tela');
  },
  esconder() {
    this.tela = null;
    this.el().classList.add('hidden');
    this.el().innerHTML = '';
    document.body.classList.remove('com-tela');
  },
  erro(texto) {
    const e = $('tela-erro');
    if (e) e.textContent = texto || '';
  },
  logo(cls = '') {
    const svg = document.querySelector('.brand-logo');
    return svg ? svg.outerHTML.replace('class="brand-logo"', `class="brand-logo ${cls}"`) : '';
  },
  async esperar(promessa) {
    this.ocupado = true;
    try {
      return await promessa;
    } finally {
      this.ocupado = false;
    }
  },

  // ---------- Início ----------

  inicio() {
    this.pararTudo();
    this.mostrar('inicio', `
      <div class="tela-caixa tela-inicio">
        ${this.logo('tela-logo')}
        <div class="menu">
          <button class="menu-op btn-primary" id="op-sozinho">
            <b>Jogar sozinho</b><span>Você e mais três bots: um na sua dupla, dois contra.</span>
          </button>
          <button class="menu-op" id="op-online">
            <b>Jogar online</b><span>Com amigos, em salas. As cadeiras vazias ficam com bots.</span>
          </button>
        </div>
      </div>`);
    $('op-sozinho').onclick = () => this.jogarSozinho();
    $('op-online').onclick = () => this.abrirOnline();
  },

  jogarSozinho() {
    if (Rede.db) Rede.sair(this.sala);
    this.sala = null;
    this.esconder();
    UI.newMatch();
  },

  // Volta para a tela inicial (botão da casinha, no alto da mesa).
  async voltarAoInicio() {
    const g = UI.game;
    if (Espelho.ativo) {
      const aviso = Espelho.anfitriao
        ? 'Sair da partida online? Você criou a sala: a partida termina para todos.'
        : 'Sair da partida online? Um bot fica no seu lugar até o fim.';
      if (g && !g.matchOver && !confirm(aviso)) return;
      await this.sairDaPartida(false);
      await this.sairDoOnline();
      return;
    }
    if (g && !g.matchOver && (g.phase === 'draw' || g.phase === 'play') &&
      !confirm('Voltar ao início? A partida atual será perdida.')) return;
    UI.stopMatch();
    this.inicio();
  },

  pararTudo() {
    if (this.pararSalas) this.pararSalas();
    if (this.pararSala) this.pararSala();
    this.pararSalas = null;
    this.pararSala = null;
  },

  // ---------- Conexão e nome ----------

  async conectar() {
    if (this.conectado) return null;
    const teste = new URLSearchParams(location.search).get('rede') === 'memoria';
    if (!teste && !FIREBASE_CONFIG) {
      return 'O modo online ainda não foi configurado: falta ligar o jogo ao banco online (Firebase).';
    }
    try {
      const adaptador = teste ? Rede.memoria(this.bancoTeste = new BancoMemoria(), 'eu') : Rede.firebase(FIREBASE_CONFIG);
      await Rede.conectar(adaptador);
      this.conectado = true;
      return null;
    } catch (e) {
      console.error(e);
      return `Não deu para conectar ao modo online. Confira a internet e tente de novo. (${e.message})`;
    }
  },

  async abrirOnline() {
    this.pararTudo();
    let guardado = '';
    try { guardado = localStorage.getItem(NOME_GUARDADO) || ''; } catch (e) { /* sem armazenamento */ }
    const nome = Rede.nome || guardado;
    this.mostrar('nome', `
      <div class="tela-caixa">
        <div class="tela-topo"><button class="tela-voltar" id="voltar">← Início</button></div>
        <h2>Jogar online</h2>
        <p>Como você quer ser chamado? O nome aparece para os outros jogadores e não pode ser igual ao de
          quem já está online. Não precisa de senha.</p>
        <form class="linha-form" id="form-nome">
          <input id="nome" maxlength="16" autocomplete="nickname" placeholder="Seu nome" value="${esc(nome)}">
          <button class="btn-primary" type="submit" id="entrar">Entrar</button>
        </form>
        <p class="tela-erro" id="tela-erro"></p>
      </div>`);
    $('voltar').onclick = () => this.sairDoOnline();
    $('form-nome').onsubmit = (e) => {
      e.preventDefault();
      this.confirmarNome();
    };
    $('nome').focus();
    $('entrar').disabled = true;
    this.erro('Conectando…');
    const falha = await this.conectar();
    if (this.tela !== 'nome') return;
    $('entrar').disabled = !!falha;
    this.erro(falha || '');
  },

  async confirmarNome() {
    if (this.ocupado || !this.conectado) return;
    this.erro('');
    const r = await this.esperar(Rede.reservarNome($('nome').value));
    if (!r.ok) return this.erro(r.erro);
    try { localStorage.setItem(NOME_GUARDADO, r.nome); } catch (e) { /* sem armazenamento */ }
    this.mostrarSalas();
  },

  async sairDoOnline() {
    this.pararTudo();
    if (Rede.db) await Rede.sair(this.sala);
    this.sala = null;
    this.inicio();
  },

  // ---------- Lista de salas ----------

  mostrarSalas(aviso = '') {
    this.pararTudo();
    this.sala = null;
    this.mostrar('salas', `
      <div class="tela-caixa larga">
        <div class="tela-topo">
          <button class="tela-voltar" id="voltar">← Início</button>
          <span class="tela-eu">Você: <b>${esc(Rede.nome)}</b> · <a href="#" id="trocar-nome">trocar nome</a></span>
        </div>
        <h2>Salas</h2>
        <input class="campo" id="busca" placeholder="Buscar sala pelo nome" value="${esc(this.busca)}">
        <div class="lista-salas" id="lista-salas"><p class="vazio">Carregando salas…</p></div>
        <h3>Criar uma sala</h3>
        <form class="linha-form" id="form-sala">
          <input id="nome-sala" maxlength="24" placeholder="Nome da sala">
          <button class="btn-primary" type="submit">Criar sala</button>
        </form>
        <p class="tela-erro" id="tela-erro">${esc(aviso)}</p>
      </div>`);
    $('voltar').onclick = () => this.sairDoOnline();
    $('trocar-nome').onclick = async (e) => {
      e.preventDefault();
      this.pararTudo();
      await Rede.liberarNome();
      this.abrirOnline();
    };
    $('busca').oninput = (e) => {
      this.busca = e.target.value;
      this.desenharSalas();
    };
    $('form-sala').onsubmit = (e) => {
      e.preventDefault();
      this.criarSala();
    };
    this.pararSalas = Rede.ouvirSalas((lista) => {
      this.salas = lista;
      if (this.tela === 'salas') this.desenharSalas();
    });
  },

  desenharSalas() {
    const alvo = $('lista-salas');
    if (!alvo) return;
    const busca = Rede.chaveDoNome(this.busca);
    const lista = this.salas.filter((s) => !busca || Rede.chaveDoNome(s.nome).includes(busca));
    if (!lista.length) {
      alvo.innerHTML = `<p class="vazio">${this.salas.length ? 'Nenhuma sala com esse nome.' : 'Nenhuma sala aberta ainda. Crie a primeira!'}</p>`;
      return;
    }
    alvo.innerHTML = lista.map((s) => {
      const n = Rede.pessoasSentadas(s);
      const pontos = [0, 1, 2, 3].map((i) => `<i class="${s.lugares && s.lugares[i] ? 'on' : ''}"></i>`).join('');
      const jogando = s.estado === 'jogando';
      return `
        <div class="sala-item">
          <div class="sala-info">
            <b>${esc(s.nome)}</b>
            <span>criada por ${esc(s.criador.nome)} · ${n === 1 ? '1 pessoa sentada' : `${n} pessoas sentadas`}</span>
          </div>
          <div class="sala-pontos" title="Cadeiras com pessoas">${pontos}</div>
          ${jogando ? '<span class="chip">Em jogo</span>' : `<button data-sala="${esc(s.id)}">Entrar</button>`}
        </div>`;
    }).join('');
    alvo.querySelectorAll('button[data-sala]').forEach((b) => {
      b.onclick = () => this.entrarSala(b.dataset.sala);
    });
  },

  async criarSala() {
    if (this.ocupado) return;
    const abertas = this.salas;
    const r = await this.esperar(Rede.criarSala($('nome-sala').value, abertas));
    if (!r.ok) return this.erro(r.erro);
    this.abrirSala(r.id);
  },

  async entrarSala(id) {
    if (this.ocupado) return;
    const r = await this.esperar(Rede.entrarSala(id));
    if (!r.ok) return this.erro(r.erro);
    this.abrirSala(id);
  },

  // ---------- Sala (mesa redonda) ----------

  abrirSala(id) {
    this.pararTudo();
    this.sala = null;
    this.mostrar('sala', `
      <div class="tela-caixa larga">
        <div class="tela-topo">
          <button class="tela-voltar" id="sair-sala">← Sair da sala</button>
          <span class="tela-eu">Você: <b>${esc(Rede.nome)}</b></span>
        </div>
        <h2 id="sala-nome"></h2>
        <p id="sala-dica"></p>
        <div id="sala-mesa"></div>
        <div class="sala-rodape" id="sala-rodape"></div>
        <p class="tela-erro" id="tela-erro"></p>
      </div>`);
    $('sair-sala').onclick = () => this.sairDaSala();
    this.pararSala = Rede.ouvirSala(id, (sala) => this.salaMudou(sala));
  },

  salaMudou(sala) {
    if (this.emJogo) {
      // Durante a partida: a sala sumiu (quem criou saiu) ou voltou a esperar (fim da partida).
      if (!sala) {
        const quem = this.sala ? this.sala.criador.nome : 'quem criou a sala';
        Espelho.encerrar();
        this.emJogo = false;
        this.mostrarSalas(`A partida terminou: ${quem} (quem criou a sala) saiu.`);
      } else if (sala.estado === 'esperando') {
        Espelho.encerrar();
        this.emJogo = false;
        this.abrirSala(sala.id);
      } else {
        this.sala = sala;
      }
      return;
    }
    if (this.tela !== 'sala') return;
    if (!sala) {
      this.mostrarSalas('A sala foi fechada (quem criou saiu).');
      return;
    }
    this.sala = sala;
    if (sala.estado === 'jogando') return this.partidaComecou();
    // De volta à sala depois de uma partida: se cair agora, a cadeira fica livre de novo.
    const meu = Rede.meuLugar(sala);
    if (meu !== null && !Rede.saidas.has(`salas/${sala.id}/lugares/${meu}`)) {
      Rede.armarSaida(`salas/${sala.id}/lugares/${meu}`, null);
    }
    this.desenharSala();
  },

  async sairDaSala() {
    const sala = this.sala;
    this.pararTudo();
    if (sala) await this.esperar(Rede.sairSala(sala));
    this.mostrarSalas();
  },

  // Papel da cadeira "s" para quem está olhando (sentado em "eu", ou null).
  papel(s, eu) {
    if (eu === null) return { texto: s % 2 === 0 ? 'Dupla 1' : 'Dupla 2', cls: '' };
    if (s === eu) return { texto: 'Você', cls: 'minha' };
    if ((s - eu + 4) % 4 === 2) return { texto: 'Sua dupla', cls: 'dupla' };
    return { texto: 'Adversário', cls: 'adv' };
  },

  desenharSala() {
    const sala = this.sala;
    const eu = Rede.meuLugar(sala);
    const souCriador = sala.criador.uid === Rede.uid;
    const niveis = Object.entries(AI.LEVELS).filter(([, v]) => !v.hidden);
    $('sala-nome').textContent = sala.nome;
    $('sala-dica').innerHTML = eu === null
      ? 'Escolha uma cadeira. Quem senta <b>à sua frente</b> joga na sua dupla; quem senta <b>dos lados</b>, contra.'
      : `Você está na cadeira ${POSICAO[eu]}. Para trocar, clique numa cadeira com bot.`;

    const cadeira = (s) => {
      const pessoa = sala.lugares && sala.lugares[s];
      const nivel = AI.LEVELS[sala.niveis && sala.niveis[s]] ? sala.niveis[s] : AI.DEFAULT_LEVEL;
      const p = this.papel(s, eu);
      if (pessoa) {
        const inicial = esc([...pessoa.nome][0].toUpperCase());
        return `
          <div class="cadeira pos-${s} ${p.cls}">
            <button class="assento" disabled title="${esc(pessoa.nome)}"><span class="letra">${inicial}</span></button>
            <div class="cadeira-nome">${esc(pessoa.nome)}${sala.criador.uid === pessoa.uid ? ' <span class="coroa" title="Criou a sala">★</span>' : ''}</div>
            <div class="cadeira-papel ${p.cls}">${p.texto}</div>
          </div>`;
      }
      const escolha = souCriador
        ? `<select data-nivel="${s}" title="Nível do bot">${niveis.map(([k, v]) =>
          `<option value="${k}"${k === nivel ? ' selected' : ''}>${v.label}</option>`).join('')}</select>`
        : `<div class="cadeira-papel">${AI.LEVELS[nivel].label}</div>`;
      return `
        <div class="cadeira pos-${s} livre ${eu === null ? '' : p.cls}">
          <button class="assento" data-lugar="${s}" title="Sentar nesta cadeira">
            <span class="bot">${ICON_BOT}</span><span class="sentar">${ICON_SENTAR}<small>Sentar</small></span>
          </button>
          <div class="cadeira-nome">Bot</div>
          <div class="cadeira-papel ${eu === null ? '' : p.cls}">${p.texto}</div>
          ${escolha}
        </div>`;
    };
    const parNos = eu === null ? '' : (eu % 2 === 0 ? 'nos' : 'eles');
    const parEles = eu === null ? '' : (eu % 2 === 0 ? 'eles' : 'nos');
    $('sala-mesa').innerHTML = `
      <div class="mesa-redonda">
        <div class="mesa-tampo">
          <div class="mesa-par vertical ${parNos}"></div>
          <div class="mesa-par horizontal ${parEles}"></div>
          <div class="mesa-monte"><div class="card back small"></div><div class="card back small"></div></div>
        </div>
        ${[0, 1, 2, 3].map(cadeira).join('')}
      </div>`;
    $('sala-mesa').querySelectorAll('button[data-lugar]').forEach((b) => {
      b.onclick = () => this.sentar(Number(b.dataset.lugar));
    });
    $('sala-mesa').querySelectorAll('select[data-nivel]').forEach((sel) => {
      sel.onchange = () => Rede.definirNivel(this.sala, Number(sel.dataset.nivel), sel.value);
    });

    // Rodapé: começar (quem criou) ou esperar (os outros).
    const n = Rede.pessoasSentadas(sala);
    const semCadeira = Object.entries(sala.presentes || {})
      .filter(([uid]) => Rede.meuLugar(sala, uid) === null).map(([, nome]) => esc(nome));
    let html = '';
    if (souCriador) {
      const falta = Rede.MIN_JOGADORES - n;
      let nota = 'As cadeiras sem pessoa ficam com os bots, no nível escolhido.';
      if (eu === null) nota = 'Sente-se numa cadeira para poder começar a partida.';
      else if (falta > 0) nota = `Para jogar online, pelo menos ${Rede.MIN_JOGADORES} pessoas precisam estar sentadas (falta ${falta}).`;
      html += `<button class="btn-primary" id="comecar"${eu === null || falta > 0 ? ' disabled' : ''}>Começar partida</button>`;
      html += `<p>${nota}</p>`;
    } else {
      html += `<p>Esperando <b>${esc(sala.criador.nome)}</b> começar a partida. Quem criou a sala escolhe o nível dos bots.</p>`;
    }
    if (eu !== null) html += '<button class="btn-small" id="levantar">Levantar da cadeira</button>';
    if (semCadeira.length) html += `<p class="sem-cadeira">Na sala, sem cadeira: ${semCadeira.join(', ')}</p>`;
    $('sala-rodape').innerHTML = html;
    if ($('comecar')) $('comecar').onclick = () => this.comecar();
    if ($('levantar')) $('levantar').onclick = () => Rede.levantar(this.sala);
  },

  async sentar(lugar) {
    if (this.ocupado || !this.sala) return;
    this.erro('');
    const r = await this.esperar(Rede.sentar(this.sala, lugar));
    if (!r.ok) this.erro(r.erro);
  },

  async comecar() {
    if (this.ocupado || !this.sala) return;
    if (Rede.meuLugar(this.sala) === null) return this.erro('Sente-se numa cadeira para poder começar a partida.');
    const r = await this.esperar(Rede.comecar(this.sala));
    if (!r.ok) this.erro(r.erro);
  },

  // ---------- A partida ----------

  // Quem criou a sala clicou em "Começar": cada um vai para a mesa (só quem está sentado joga).
  partidaComecou() {
    const sala = this.sala;
    const meu = Rede.meuLugar(sala);
    if (meu === null) {
      this.pararTudo();
      Rede.sairSala(sala);
      this.mostrarSalas('A partida começou sem você: só joga quem estava sentado numa cadeira.');
      return;
    }
    // A cadeira continua sua durante a partida, mesmo se a internet cair.
    Rede.desarmarSaida(`salas/${sala.id}/lugares/${meu}`);
    this.emJogo = true;
    this.esconder();
    Espelho.iniciar({ sala, meu, nome: Rede.nome, anfitriao: sala.criador.uid === Rede.uid, rede: Rede });
  },

  // Sai da partida em andamento. Quem criou a sala fecha a sala; os outros deixam um bot no lugar.
  async sairDaPartida(mostrarSalas = true) {
    const sala = this.sala;
    const anfitriao = Espelho.anfitriao;
    Espelho.sair();
    Espelho.encerrar();
    this.emJogo = false;
    this.pararTudo();
    if (sala) {
      if (anfitriao) await Rede.sairSala(sala);
      else {
        Rede.desarmarSaida(`salas/${sala.id}/presentes/${Rede.uid}`);
        await Rede.db.apagar(`salas/${sala.id}/presentes/${Rede.uid}`);
      }
    }
    this.sala = null;
    if (mostrarSalas) this.mostrarSalas();
  },

  // Fim da partida (quem criou a sala): todos voltam para a sala, nas mesmas cadeiras, para jogar de novo.
  async voltarASala() {
    const sala = this.sala;
    if (!sala) return;
    await Rede.db.apagar(`jogos/${sala.id}`);
    await Rede.db.gravar(`salas/${sala.id}/estado`, 'esperando');
  },
};
