(() => {
'use strict';

const $ = s => document.querySelector(s);

// ---------- Conexão ----------
if (!window.supabase) {
  document.body.insertAdjacentText('afterbegin', 'Não foi possível carregar o sistema. Verifique sua internet e atualize a página.');
  return;
}
const db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ---------- Dados fixos ----------
const POS = {
  QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', OL: 'Linha ofensiva',
  DL: 'Linha defensiva', LB: 'Linebackers', CB: 'Cornerbacks', S: 'Safeties', K: 'Kicker', P: 'Punter'
};
const GROUPS = [
  ['Ataque', ['QB', 'RB', 'WR', 'TE', 'OL']],
  ['Defesa', ['DL', 'LB', 'CB', 'S']],
  ['Times especiais', ['K', 'P']]
];

// ---------- Utilidades ----------
// Cria elementos sem usar innerHTML (evita que nomes digitados por usuários injetem código).
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : String(c));
  return e;
}

function msg(text, kind) {
  const m = $('#msg');
  if (!text) { m.hidden = true; return; }
  m.textContent = text;
  m.className = kind || '';
  m.hidden = false;
}

function view(name) {
  for (const id of ['loading', 'auth', 'create', 'team']) $('#' + id).hidden = id !== name;
  $('#user').hidden = name === 'auth' || name === 'loading';
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
}

function traduz(e) {
  const m = (e && e.message) || String(e);
  const mapa = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/already registered|already been registered/i, 'Este e-mail já está cadastrado. Use a aba "Entrar".'],
    [/at least 6|weak password|password should/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/email not confirmed/i, 'Seu e-mail ainda não foi confirmado.'],
    [/rate limit|too many/i, 'Muitas tentativas. Espere um pouco e tente de novo.'],
    [/invalid.*email|unable to validate email/i, 'E-mail inválido.'],
    [/teams_name_unique/i, 'Já existe um time com esse nome.'],
    [/teams_owner_unique/i, 'Você já tem um time.'],
    [/failed to fetch|network/i, 'Sem conexão com o servidor. Verifique sua internet.']
  ];
  for (const [re, t] of mapa) if (re.test(m)) return t;
  return m;
}

// ---------- Login e cadastro ----------
let modo = 'in';
function setModo(m) {
  modo = m;
  $('#tabIn').classList.toggle('on', m === 'in');
  $('#tabUp').classList.toggle('on', m === 'up');
  $('#authBtn').textContent = m === 'in' ? 'Entrar' : 'Criar conta';
  $('#pass').setAttribute('autocomplete', m === 'in' ? 'current-password' : 'new-password');
  msg('');
}
$('#tabIn').addEventListener('click', () => setModo('in'));
$('#tabUp').addEventListener('click', () => setModo('up'));

$('#authForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#authBtn');
  const email = $('#email').value.trim(), password = $('#pass').value;
  busy(btn, true, 'Aguarde…');
  msg('');
  try {
    if (modo === 'in') {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        setModo('in');
        msg('Conta criada! Confirme seu e-mail (veja sua caixa de entrada) e depois entre.', 'ok');
      }
    }
  } catch (e) {
    msg(traduz(e), 'err');
  } finally {
    busy(btn, false);
    btn.textContent = modo === 'in' ? 'Entrar' : 'Criar conta';
  }
});

$('#logout').addEventListener('click', async () => {
  msg('');
  await db.auth.signOut();
});

// ---------- Rotas ----------
let usuarioAtual = null;

async function route(session) {
  if (!session) {
    usuarioAtual = null;
    view('auth');
    return;
  }
  if (session.user.id === usuarioAtual) return;   // mesma pessoa: não redesenha à toa
  usuarioAtual = session.user.id;
  $('#who').textContent = session.user.email;
  view('loading');
  await carregarTime();
}

async function carregarTime() {
  const { data: time, error } = await db.from('teams').select('*').eq('owner_id', usuarioAtual).maybeSingle();
  if (error) {
    $('#loadingText').textContent = 'Não foi possível carregar seus dados. Atualize a página.';
    msg(traduz(error), 'err');
    view('loading');
    usuarioAtual = null;
    return;
  }
  if (!time) { view('create'); return; }

  const { data: jogadores, error: e2 } = await db.from('players').select('*').eq('team_id', time.id);
  if (e2) {
    $('#loadingText').textContent = 'Não foi possível carregar o elenco. Atualize a página.';
    msg(traduz(e2), 'err');
    view('loading');
    usuarioAtual = null;
    return;
  }
  const liga = await carregarLiga();
  desenharTime(time, jogadores || [], liga);
  view('team');
}

// ---------- Criar time ----------
$('#createForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#createBtn');
  busy(btn, true, 'Criando…');
  msg('');
  const { error } = await db.rpc('create_my_team', {
    p_name: $('#teamName').value,
    p_coach: $('#coachName').value,
    p_color: $('#teamColor').value
  });
  busy(btn, false, 'Criar time');
  if (error) { msg(traduz(error), 'err'); return; }
  await carregarTime();
  msg('Time criado! Este é o seu elenco inicial.', 'ok');
});

// ---------- Tela do time ----------
const classe = v => (v >= 15 ? 'hi' : v >= 12 ? 'md' : v <= 7 ? 'lo' : '');
const num = v => el('span', { class: 'n ' + classe(v) }, v);
const media = lista => (lista.length ? lista.reduce((s, x) => s + x, 0) / lista.length : 0);

// Dados da liga (se a Fase 3 ainda não foi instalada no banco, devolve null e o site mostra só o time)
async function carregarLiga() {
  const [s, t, m, st] = await Promise.all([
    db.from('seasons').select('*').eq('status', 'active').maybeSingle(),
    db.from('teams').select('id,name,color,conference,is_bot').not('conference', 'is', null),
    db.from('matches').select('*').order('matchday').order('scheduled_at'),
    db.from('standings').select('*')
  ]);
  if (s.error || t.error || m.error || st.error || !s.data) return null;
  const porId = {};
  for (const x of t.data) porId[x.id] = x;
  return { season: s.data, teams: t.data, porId, matches: m.data, standings: st.data };
}

const corOk = c => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#888888');

function fmtData(iso) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${p.weekday.replace('.', '')} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

function nomeTime(t, extra) {
  if (!t) return el('span', {}, '?');
  return el('span', { class: 'tm' },
    el('i', { class: 'dot', style: 'background:' + corOk(t.color) }),
    el('span', {}, t.name),
    t.is_bot ? el('span', { class: 'cpu', title: 'Time controlado pelo computador' }, 'CPU') : null,
    extra || null
  );
}

function desenharTime(time, jogadores, liga) {
  const raiz = $('#team');
  raiz.replaceChildren();

  const meus = liga ? liga.matches.filter(m => m.home_id === time.id || m.away_id === time.id).sort((a, b) => a.matchday - b.matchday) : [];
  const proximo = meus.find(m => m.status === 'scheduled');
  const folha = jogadores.reduce((s, p) => s + p.salario, 0);

  // Cabeçalho (sempre visível)
  const cab = el('div', { class: 'card' },
    el('div', { class: 'head' },
      el('div', { class: 'swatch', style: 'background:' + corOk(time.color) }),
      el('div', {},
        el('h2', {}, time.name),
        el('p', { class: 'muted' },
          'Treinador: ' + (time.coach_name || '—') +
          (liga && time.conference ? ' · Conferência ' + time.conference + ' · Temporada ' + liga.season.number : ''))
      )
    ),
    el('div', { class: 'stats' },
      stat(jogadores.length, 'jogadores'),
      stat(media(jogadores.map(p => p.overall)).toFixed(1), 'força média'),
      stat(media(jogadores.map(p => p.age)).toFixed(1), 'idade média'),
      stat('$ ' + (folha / 1000).toFixed(1) + ' mi', 'folha salarial / temporada')
    )
  );
  if (proximo) {
    const casa = proximo.home_id === time.id;
    cab.append(el('div', { class: 'next' },
      el('span', { class: 'muted' }, 'Próximo jogo · Rodada ' + proximo.matchday),
      el('b', {}, fmtData(proximo.scheduled_at) + ' (Brasília) · ' + (casa ? 'em casa' : 'fora') + ' contra'),
      nomeTime(liga.porId[casa ? proximo.away_id : proximo.home_id])
    ));
  }
  raiz.append(cab);

  // Abas
  const panes = { time: paneTime(jogadores) };
  const nomes = { time: 'Meu time' };
  if (liga) {
    panes.class = paneClassificacao(time, liga);
    panes.cal = paneCalendario(time, liga, meus, proximo);
    nomes.class = 'Classificação';
    nomes.cal = 'Calendário';
    const nav = el('div', { class: 'nav' });
    const abrir = id => {
      for (const k of Object.keys(panes)) panes[k].hidden = k !== id;
      for (const b of nav.children) b.classList.toggle('on', b.dataset.id === id);
    };
    for (const k of Object.keys(panes)) {
      const b = el('button', { type: 'button', 'data-id': k }, nomes[k]);
      b.addEventListener('click', () => abrir(k));
      nav.append(b);
    }
    raiz.append(nav);
    for (const k of Object.keys(panes)) raiz.append(panes[k]);
    abrir('time');
  } else {
    raiz.append(panes.time);
  }
}

function paneTime(jogadores) {
  const pane = el('div', { class: 'pane' });
  const top = (pos, n) => jogadores.filter(p => p.pos === pos).sort((a, b) => b.overall - a.overall).slice(0, n).map(p => p.overall);
  const unidades = [
    ['Quarterback', media(top('QB', 1))],
    ['Corrida', media(top('RB', 1))],
    ['Recepção', media([...top('WR', 3), ...top('TE', 1)])],
    ['Linha ofensiva', media(top('OL', 5))],
    ['Linha defensiva', media(top('DL', 4))],
    ['Linebackers', media(top('LB', 3))],
    ['Secundária', media([...top('CB', 2), ...top('S', 2)])],
    ['Times especiais', media([...top('K', 1), ...top('P', 1)])]
  ];
  pane.append(
    el('h3', {}, 'Força por unidade'),
    el('div', { class: 'card units' },
      unidades.map(([nome, v]) => el('div', { class: 'unit' },
        el('span', {}, nome), el('b', {}, v.toFixed(1)),
        el('i', {}, el('u', { style: 'width:' + Math.min(100, v / 20 * 100) + '%' }))
      ))
    ),
    el('h3', {}, 'Elenco')
  );
  const cab = el('tr', {}, ['Nº', 'Nome', 'Pos', 'Idade', 'Téc', 'Fís', 'Men', 'Geral', 'Pot', 'Salário'].map(t => el('th', {}, t)));
  const corpo = el('tbody');
  for (const [grupo, posicoes] of GROUPS) {
    corpo.append(el('tr', { class: 'sub' }, el('td', { colspan: 10 }, grupo)));
    for (const pos of posicoes) {
      const lista = jogadores.filter(p => p.pos === pos).sort((a, b) => b.overall - a.overall || a.jersey - b.jersey);
      for (const p of lista) {
        corpo.append(el('tr', {},
          el('td', {}, p.jersey), el('td', {}, p.name), el('td', { title: POS[p.pos] }, p.pos), el('td', {}, p.age),
          el('td', {}, num(p.tecnica)), el('td', {}, num(p.fisico)), el('td', {}, num(p.mental)),
          el('td', {}, num(p.overall)), el('td', {}, num(p.potencial)),
          el('td', {}, '$ ' + p.salario + ' mil')
        ));
      }
    }
  }
  pane.append(
    el('div', { class: 'tw' }, el('table', {}, el('thead', {}, cab), corpo)),
    el('p', { class: 'muted' }, 'Téc = técnica · Fís = físico · Men = mental · Pot = potencial. Todos os atributos vão de 1 a 20.')
  );
  return pane;
}

function paneClassificacao(time, liga) {
  const pane = el('div', { class: 'pane' });
  for (const conf of ['Norte', 'Sul']) {
    const lista = liga.standings.filter(s => s.conference === conf)
      .sort((a, b) => b.pct - a.pct || (b.pts_for - b.pts_against) - (a.pts_for - a.pts_against) || b.pts_for - a.pts_for || a.name.localeCompare(b.name));
    const corpo = el('tbody');
    lista.forEach((s, i) => {
      const saldo = s.pts_for - s.pts_against;
      corpo.append(el('tr', { class: (s.team_id === time.id ? 'me ' : '') + (i === 3 ? 'cut' : '') },
        el('td', {}, i + 1),
        el('td', {}, nomeTime(s)),
        el('td', {}, s.played), el('td', {}, s.wins), el('td', {}, s.losses), el('td', {}, s.ties),
        el('td', {}, s.pts_for), el('td', {}, s.pts_against), el('td', {}, (saldo > 0 ? '+' : '') + saldo),
        el('td', {}, Number(s.pct).toFixed(3).replace(/^0/, ''))
      ));
    });
    pane.append(
      el('h3', {}, 'Conferência ' + conf),
      el('div', { class: 'tw tbl2' }, el('table', {},
        el('thead', {}, el('tr', {}, ['#', 'Time', 'J', 'V', 'D', 'E', 'PF', 'PS', 'Saldo', '%'].map(t => el('th', {}, t)))),
        corpo))
    );
  }
  pane.append(el('p', { class: 'muted' }, 'J = jogos · V = vitórias · D = derrotas · E = empates · PF = pontos feitos · PS = pontos sofridos. Critérios: aproveitamento, saldo de pontos, pontos feitos. A linha verde marca os 4 que avançam aos playoffs (em breve).'));
  return pane;
}

function paneCalendario(time, liga, meus, proximo) {
  const pane = el('div', { class: 'pane' });

  // Meus jogos
  const corpo = el('tbody');
  for (const m of meus) {
    const casa = m.home_id === time.id;
    let res = '—', cls = '';
    if (m.status === 'played') {
      const a = casa ? m.home_score : m.away_score, b = casa ? m.away_score : m.home_score;
      res = a + ' x ' + b;
      cls = a > b ? 'hi' : a < b ? 'lo' : 'md';
    }
    corpo.append(el('tr', {},
      el('td', {}, m.matchday), el('td', {}, fmtData(m.scheduled_at)), el('td', {}, casa ? 'Casa' : 'Fora'),
      el('td', {}, nomeTime(liga.porId[casa ? m.away_id : m.home_id])),
      el('td', {}, el('span', { class: 'n ' + cls }, res))
    ));
  }
  pane.append(
    el('h3', {}, 'Meus jogos'),
    el('div', { class: 'tw cal' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Rodada', 'Data (Brasília)', 'Local', 'Adversário', 'Resultado'].map(t => el('th', {}, t)))),
      corpo))
  );

  // Jogos de cada rodada
  const sel = el('select', { id: 'rodada', 'aria-label': 'Rodada' });
  const rodadas = [...new Set(liga.matches.map(m => m.matchday))].sort((a, b) => a - b);
  for (const r of rodadas) sel.append(el('option', { value: r }, 'Rodada ' + r));
  sel.value = String(proximo ? proximo.matchday : rodadas[rodadas.length - 1]);
  const lista = el('div', { class: 'games' });
  const mostrar = () => {
    lista.replaceChildren();
    for (const m of liga.matches.filter(x => x.matchday === Number(sel.value))) {
      const meu = m.home_id === time.id || m.away_id === time.id;
      const jogado = m.status === 'played';
      lista.append(el('div', { class: 'game' + (meu ? ' mine' : '') },
        nomeTime(liga.porId[m.home_id]),
        el('span', { class: 'sc' }, jogado ? m.home_score + ' x ' + m.away_score : 'x', el('small', { class: 'muted' }, fmtData(m.scheduled_at))),
        nomeTime(liga.porId[m.away_id])
      ));
    }
  };
  sel.addEventListener('change', mostrar);
  mostrar();
  pane.append(el('h3', {}, 'Jogos da liga'), el('div', { class: 'row' }, sel), lista);
  return pane;
}

function stat(valor, rotulo) {
  return el('div', { class: 'stat' }, el('b', {}, valor), el('span', {}, rotulo));
}

// ---------- Início ----------
// O Supabase avisa aqui quando alguém entra, sai, ou quando a página abre já logada.
db.auth.onAuthStateChange((evento, session) => {
  if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;
  setTimeout(() => route(session), 0);
});

})();
