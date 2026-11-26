/*
 * rede.js: a conexão do modo online.
 *
 * Os jogadores se encontram num banco de dados em tempo real (Firebase, do Google, plano gratuito).
 * Este arquivo só guarda e lê dados (nomes em uso, salas, lugares); o que aparece na tela é com o online.js.
 *
 * O banco é usado por um "adaptador" com poucas operações (ler, gravar, ouvir, transação...). Há dois:
 *   Rede.firebase(config)   o de verdade (o Firebase só é baixado da internet quando o modo online é aberto)
 *   Rede.memoria(banco)     um banco de mentira, na memória, para os testes (várias "pessoas" na mesma página)
 *
 * Dados no banco:
 *   nomes/<chave>   { uid, nome }   nome em uso: fica reservado enquanto a pessoa está conectada
 *   salas/<id>      { nome, criador: { uid, nome }, criadaEm, estado ('esperando' | 'jogando'),
 *                     lugares: { 0..3: { uid, nome } }   quem sentou em cada cadeira (vazia = bot)
 *                     niveis: { 0..3: nível do bot }      escolhido por quem criou a sala
 *                     presentes: { <uid>: nome } }        quem está com a sala aberta
 * Cadeiras: 0 embaixo, 1 à esquerda, 2 em cima, 3 à direita (sentido horário, como na partida).
 * Duplas: cadeiras 0 e 2 contra 1 e 3 (quem senta à frente é parceiro; dos lados, adversário).
 * As regras de segurança do banco (quem pode gravar o quê) estão em firebase-regras.json.
 */

const Rede = {
  FIREBASE_VERSAO: '10.14.1',
  MIN_JOGADORES: 2,   // pessoas sentadas para começar uma partida online
  db: null,           // adaptador do banco
  uid: null,          // identidade desta pessoa no banco (entrada anônima, sem senha)
  nome: null,         // nome escolhido
  chave: null,        // chave do nome no banco
  pararNome: null,
  saidas: null,       // o que o banco desfaz sozinho se esta pessoa cair: caminho → cancelar

  // ---------- Conexão ----------

  // Nos testes, cada "pessoa" é um Object.create(Rede) com o seu próprio adaptador.
  async conectar(adaptador) {
    this.db = adaptador;
    this.saidas = new Map();
    this.uid = await adaptador.entrar();
    return this.uid;
  },

  // Se esta pessoa cair (fechar o jogo, perder a internet), o banco grava "valor" em "caminho" (null = apaga).
  armarSaida(caminho, valor) {
    this.desarmarSaida(caminho);
    this.saidas.set(caminho, this.db.aoSair(caminho, valor));
  },
  desarmarSaida(caminho) {
    const cancelar = this.saidas.get(caminho);
    if (cancelar) cancelar();
    this.saidas.delete(caminho);
  },

  // ---------- Nomes ----------

  // Nome sem acentos, minúsculo e sem espaços repetidos: "Ana  Lúcia" e "ana lucia" são o mesmo nome.
  chaveDoNome(nome) {
    return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
  },
  limparNome(nome) {
    return String(nome || '').trim().replace(/\s+/g, ' ');
  },
  erroNome(nome) {
    if (nome.length < 2) return 'O nome precisa ter pelo menos 2 letras.';
    if (nome.length > 16) return 'O nome pode ter no máximo 16 letras.';
    if (!/^[\p{L}\p{N} _-]+$/u.test(nome)) return 'Use só letras, números, espaço, hífen ou sublinhado.';
    return null;
  },

  // Reserva o nome para esta pessoa (ninguém mais pode usar enquanto ela estiver conectada).
  async reservarNome(nomeDigitado) {
    const nome = this.limparNome(nomeDigitado);
    const erro = this.erroNome(nome);
    if (erro) return { ok: false, erro };
    const chave = this.chaveDoNome(nome);
    if (this.chave && this.chave !== chave) await this.liberarNome();
    const uid = this.uid;
    const r = await this.db.transacao(`nomes/${chave}`, (atual) => {
      if (atual && atual.uid !== uid) return undefined; // de outra pessoa: desiste
      return { uid, nome };
    });
    if (!r.ok) return { ok: false, erro: `O nome "${nome}" já está em uso. Escolha outro.` };
    this.nome = nome;
    this.chave = chave;
    this.armarSaida(`nomes/${chave}`, null);
    // Se a reserva sumir com a pessoa ainda aqui (ex.: a internet caiu e voltou), reserva de novo.
    if (this.pararNome) this.pararNome();
    this.pararNome = this.db.ouvir(`nomes/${chave}`, (v) => {
      if (!v && this.chave === chave) this.db.transacao(`nomes/${chave}`, (a) => (a && a.uid !== uid ? undefined : { uid, nome }));
    });
    return { ok: true, nome };
  },

  async liberarNome() {
    if (!this.chave) return;
    const chave = this.chave;
    this.chave = null;
    this.nome = null;
    if (this.pararNome) this.pararNome();
    this.pararNome = null;
    this.desarmarSaida(`nomes/${chave}`);
    await this.db.transacao(`nomes/${chave}`, (a) => (a && a.uid === this.uid ? null : undefined));
  },

  // ---------- Salas ----------

  erroNomeSala(nome) {
    if (nome.length < 2) return 'O nome da sala precisa ter pelo menos 2 letras.';
    if (nome.length > 24) return 'O nome da sala pode ter no máximo 24 letras.';
    if (/[<>]/.test(nome)) return 'O nome da sala não pode ter < ou >.';
    return null;
  },

  // Lista das salas (atualizada sozinha). Devolve a função que para de ouvir.
  ouvirSalas(cb) {
    return this.db.ouvir('salas', (v) => {
      const lista = Object.entries(v || {}).filter(([, s]) => s && s.nome && s.criador)
        .map(([id, s]) => ({ id, ...s }));
      lista.sort((a, b) => (a.estado === 'jogando') - (b.estado === 'jogando') || (b.criadaEm || 0) - (a.criadaEm || 0));
      cb(lista);
    });
  },
  ouvirSala(id, cb) {
    return this.db.ouvir(`salas/${id}`, (v) => cb(v && v.criador ? { id, ...v } : null));
  },

  async criarSala(nomeDigitado, salasAbertas = []) {
    const nome = this.limparNome(nomeDigitado);
    const erro = this.erroNomeSala(nome);
    if (erro) return { ok: false, erro };
    if (salasAbertas.some((s) => this.chaveDoNome(s.nome) === this.chaveDoNome(nome))) {
      return { ok: false, erro: `Já existe uma sala chamada "${nome}".` };
    }
    const id = this.db.novaChave('salas');
    const niveis = { 0: AI.DEFAULT_LEVEL, 1: AI.DEFAULT_LEVEL, 2: AI.DEFAULT_LEVEL, 3: AI.DEFAULT_LEVEL };
    await this.db.gravar(`salas/${id}`, {
      nome, criador: { uid: this.uid, nome: this.nome }, criadaEm: this.db.agora(), estado: 'esperando',
      niveis, presentes: { [this.uid]: this.nome },
    });
    // Quem criou a sala é quem "comanda" a mesa: se cair, a sala fecha.
    this.armarSaida(`salas/${id}`, null);
    return { ok: true, id };
  },

  async entrarSala(id) {
    const sala = await this.db.ler(`salas/${id}`);
    if (!sala || !sala.criador) return { ok: false, erro: 'Essa sala não existe mais.' };
    if (sala.estado === 'jogando') return { ok: false, erro: 'A partida dessa sala já começou.' };
    await this.db.gravar(`salas/${id}/presentes/${this.uid}`, this.nome);
    this.armarSaida(`salas/${id}/presentes/${this.uid}`, null);
    return { ok: true };
  },

  async sairSala(sala) {
    if (!sala) return;
    if (sala.criador.uid === this.uid) {
      this.desarmarSaida(`salas/${sala.id}`);
      this.desarmarSaida(`jogos/${sala.id}`);
      await this.db.apagar(`jogos/${sala.id}`);
      await this.db.apagar(`salas/${sala.id}`);
      return;
    }
    const meu = this.meuLugar(sala);
    if (meu !== null) {
      this.desarmarSaida(`salas/${sala.id}/lugares/${meu}`);
      await this.db.apagar(`salas/${sala.id}/lugares/${meu}`);
    }
    this.desarmarSaida(`salas/${sala.id}/presentes/${this.uid}`);
    await this.db.apagar(`salas/${sala.id}/presentes/${this.uid}`);
  },

  // Sai do modo online: deixa a sala (se estiver numa) e libera o nome.
  async sair(sala = null) {
    if (!this.db) return;
    await this.sairSala(sala);
    await this.liberarNome();
  },

  // Em que cadeira esta pessoa está sentada (ou null).
  meuLugar(sala, uid = this.uid) {
    for (let s = 0; s < 4; s++) if (sala.lugares && sala.lugares[s] && sala.lugares[s].uid === uid) return s;
    return null;
  },
  pessoasSentadas(sala) {
    let n = 0;
    for (let s = 0; s < 4; s++) if (sala.lugares && sala.lugares[s]) n++;
    return n;
  },

  // Senta na cadeira "lugar" (se estiver livre) e libera a cadeira anterior.
  async sentar(sala, lugar) {
    if (sala.estado !== 'esperando') return { ok: false, erro: 'A partida já começou.' };
    const antes = this.meuLugar(sala);
    if (antes === lugar) return { ok: true };
    const eu = { uid: this.uid, nome: this.nome };
    const r = await this.db.transacao(`salas/${sala.id}/lugares/${lugar}`, (atual) => (atual ? undefined : eu));
    if (!r.ok) return { ok: false, erro: 'Alguém sentou nessa cadeira antes de você.' };
    this.armarSaida(`salas/${sala.id}/lugares/${lugar}`, null);
    if (antes !== null) {
      this.desarmarSaida(`salas/${sala.id}/lugares/${antes}`);
      await this.db.apagar(`salas/${sala.id}/lugares/${antes}`);
    }
    return { ok: true };
  },

  async levantar(sala) {
    const meu = this.meuLugar(sala);
    if (meu === null) return;
    this.desarmarSaida(`salas/${sala.id}/lugares/${meu}`);
    await this.db.apagar(`salas/${sala.id}/lugares/${meu}`);
  },

  // Só quem criou a sala escolhe o nível dos bots e começa a partida.
  async definirNivel(sala, lugar, nivel) {
    if (sala.criador.uid !== this.uid) return { ok: false, erro: 'Só quem criou a sala escolhe os bots.' };
    if (!AI.LEVELS[nivel]) return { ok: false, erro: 'Nível desconhecido.' };
    await this.db.gravar(`salas/${sala.id}/niveis/${lugar}`, nivel);
    return { ok: true };
  },

  async comecar(sala) {
    if (sala.criador.uid !== this.uid) return { ok: false, erro: 'Só quem criou a sala pode começar a partida.' };
    if (this.meuLugar(sala) === null) return { ok: false, erro: 'Sente-se numa cadeira para poder começar a partida.' };
    const n = this.pessoasSentadas(sala);
    if (n < this.MIN_JOGADORES) {
      return { ok: false, erro: `Para jogar online, pelo menos ${this.MIN_JOGADORES} pessoas precisam estar sentadas.` };
    }
    await this.db.gravar(`salas/${sala.id}/estado`, 'jogando');
    return { ok: true };
  },
};

// ---------- Adaptador: Firebase (o banco de verdade) ----------

Rede.firebase = (config) => {
  let db = null;
  const saidas = new Map(); // caminho → valor a gravar (null = apagar) quando esta pessoa cair
  const carregar = (arquivo) => new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = `https://www.gstatic.com/firebasejs/${Rede.FIREBASE_VERSAO}/${arquivo}`;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o Firebase. Confira a internet.'));
    document.head.appendChild(s);
  });
  const armar = (caminho, valor) => {
    const od = db.ref(caminho).onDisconnect();
    return valor === null ? od.remove() : od.set(valor);
  };
  return {
    async entrar() {
      if (typeof firebase === 'undefined') {
        await carregar('firebase-app-compat.js');
        await carregar('firebase-auth-compat.js');
        await carregar('firebase-database-compat.js');
      }
      if (!firebase.apps.length) firebase.initializeApp(config);
      const cred = await firebase.auth().signInAnonymously();
      db = firebase.database();
      // Depois de cair e voltar, o banco esquece o "se cair"; arma de novo.
      db.ref('.info/connected').on('value', (s) => {
        if (s.val()) saidas.forEach((valor, caminho) => armar(caminho, valor));
      });
      return cred.user.uid;
    },
    ler: (caminho) => db.ref(caminho).get().then((s) => s.val()),
    gravar: (caminho, valor) => db.ref(caminho).set(valor),
    atualizar: (caminho, valores) => db.ref(caminho).update(valores),
    apagar: (caminho) => db.ref(caminho).remove(),
    ouvir(caminho, cb) {
      const ref = db.ref(caminho);
      const h = (s) => cb(s.val());
      ref.on('value', h, (e) => console.error('Firebase:', caminho, e.message));
      return () => ref.off('value', h);
    },
    async transacao(caminho, fn) {
      const r = await db.ref(caminho).transaction((v) => fn(v === undefined ? null : v), undefined, false);
      return { ok: r.committed, valor: r.snapshot.val() };
    },
    aoSair(caminho, valor) {
      saidas.set(caminho, valor);
      armar(caminho, valor);
      return () => {
        saidas.delete(caminho);
        db.ref(caminho).onDisconnect().cancel();
      };
    },
    novaChave: (caminho) => db.ref(caminho).push().key,
    agora: () => firebase.database.ServerValue.TIMESTAMP,
  };
};

// ---------- Adaptador: banco na memória (testes) ----------

// Um banco de mentira. Vários clientes (Rede.memoria(banco, uid)) podem dividir o mesmo banco,
// como se fossem pessoas diferentes; banco.desconectar(uid) simula alguém fechando o jogo.
class BancoMemoria {
  constructor() {
    this.dados = {};
    this.ouvintes = new Set();
    this.saidas = new Map(); // uid → Map(caminho → valor)
    this.contador = 0;
  }
  partes(caminho) {
    return caminho.split('/').filter(Boolean);
  }
  ler(caminho) {
    let no = this.dados;
    for (const p of this.partes(caminho)) {
      if (no === null || typeof no !== 'object' || !(p in no)) return null;
      no = no[p];
    }
    return no === undefined ? null : JSON.parse(JSON.stringify(no));
  }
  gravar(caminho, valor) {
    const partes = this.partes(caminho);
    const v = valor === null || valor === undefined ? null : JSON.parse(JSON.stringify(valor));
    if (!partes.length) {
      this.dados = v && typeof v === 'object' ? v : {};
    } else {
      let no = this.dados;
      for (const p of partes.slice(0, -1)) {
        if (!no[p] || typeof no[p] !== 'object') no[p] = {};
        no = no[p];
      }
      const ultima = partes[partes.length - 1];
      if (v === null) delete no[ultima];
      else no[ultima] = v;
      this.podar(this.dados, partes);
    }
    this.avisar(caminho);
  }
  // Como no Firebase: um nó sem filhos deixa de existir.
  podar(no, partes) {
    if (!partes.length || !no || typeof no !== 'object') return;
    const [p, ...resto] = partes;
    if (no[p] && typeof no[p] === 'object') {
      this.podar(no[p], resto);
      if (!Object.keys(no[p]).length) delete no[p];
    }
  }
  avisar(caminho) {
    const muda = this.partes(caminho).join('/');
    for (const o of [...this.ouvintes]) {
      const ouve = this.partes(o.caminho).join('/');
      const afeta = !muda || !ouve || muda === ouve || muda.startsWith(ouve + '/') || ouve.startsWith(muda + '/');
      if (!afeta) continue;
      const v = this.ler(o.caminho);
      const txt = JSON.stringify(v);
      if (txt === o.ultimo) continue;
      o.ultimo = txt;
      Promise.resolve().then(() => this.ouvintes.has(o) && o.cb(v));
    }
  }
  // Simula a pessoa "uid" fechando o jogo: para de ouvir e o banco faz o que ela deixou armado.
  desconectar(uid) {
    for (const o of [...this.ouvintes]) if (o.uid === uid) this.ouvintes.delete(o);
    const ops = this.saidas.get(uid);
    this.saidas.delete(uid);
    if (ops) ops.forEach((valor, caminho) => this.gravar(caminho, valor));
  }
}

Rede.memoria = (banco, uid) => ({
  async entrar() { return uid; },
  async ler(caminho) { return banco.ler(caminho); },
  async gravar(caminho, valor) { banco.gravar(caminho, valor); },
  async atualizar(caminho, valores) {
    for (const [k, v] of Object.entries(valores)) banco.gravar(`${caminho}/${k}`, v);
  },
  async apagar(caminho) { banco.gravar(caminho, null); },
  ouvir(caminho, cb) {
    const o = { caminho, cb, uid, ultimo: undefined };
    banco.ouvintes.add(o);
    o.ultimo = JSON.stringify(banco.ler(caminho));
    const v = banco.ler(caminho);
    Promise.resolve().then(() => banco.ouvintes.has(o) && cb(v));
    return () => banco.ouvintes.delete(o);
  },
  async transacao(caminho, fn) {
    const novo = fn(banco.ler(caminho));
    if (novo === undefined) return { ok: false, valor: banco.ler(caminho) };
    banco.gravar(caminho, novo);
    return { ok: true, valor: banco.ler(caminho) };
  },
  aoSair(caminho, valor) {
    if (!banco.saidas.has(uid)) banco.saidas.set(uid, new Map());
    banco.saidas.get(uid).set(caminho, valor);
    return () => banco.saidas.has(uid) && banco.saidas.get(uid).delete(caminho);
  },
  novaChave() { return `s${Date.now().toString(36)}${(banco.contador++).toString(36)}`; },
  agora() { return Date.now(); },
});
