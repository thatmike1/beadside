// ui copy in the two supported locales. labels, lane names and section titles from the config
// stay as written; everything the board writes itself goes through here

import { createContext, useContext } from 'react'
import type { Locale, SearchField, SearchScope, Status } from './api'
import { formatDate, formatDateTime, formatShortDate, formatShortDateTime, relativeTime } from './format'
import { EN_SECTIONS, type SectionStrings } from './model'
import { EN_INBOX } from './inbox'
import type { Ask } from './asks'
import type { TryKit, TryLast } from './tries'

/** czech plural: 1 komentář, 2 komentáře, 5 komentářů */
export function csPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n)
  if (abs === 1) return one
  if (abs >= 2 && abs <= 4) return few
  return many
}

/** english plural: 1 bead, 2 beads */
function enPlural(n: number, one: string, many: string = `${one}s`): string {
  return n === 1 ? one : many
}

export type CommentOrder = 'oldest' | 'newest'
export type TryVerdict = 'works' | 'broken' | 'cant'

/** the keys and what they do, in the order the key list shows them */
export interface KeyRow {
  keys: string[]
  what: string
}

const en = {
  locale: 'en' as Locale,
  brand: 'beadside',

  date: (iso: string | null | undefined) => formatDate(iso, 'en'),
  shortDate: (iso: string | null | undefined) => formatShortDate(iso, 'en'),
  dateTime: (iso: string | null | undefined) => formatDateTime(iso, 'en'),
  shortDateTime: (iso: string | null | undefined) => formatShortDateTime(iso, 'en'),
  relative: (iso: string | null | undefined, now?: Date) => relativeTime(iso, now, 'en'),

  app: {
    noServer: 'no answer from the beadside server on /api.',
    loading: 'reading the ledger…',
  },

  head: {
    read: (time: string) => `read ${time}`,
    light: 'light',
    dark: 'dark',
    switchTheme: (to: string) => `switch to ${to} mode`,
    switchFont: (to: string) => `switch body font to ${to}`,
  },

  counts: {
    open: 'open',
    inProgress: 'in progress',
    deferred: 'deferred',
    waiting: 'waiting on you',
    unread: 'carrying your note',
  },

  views: {
    label: 'view',
    inbox: 'inbox',
    board: 'board',
    stale: 'stale',
  },

  search: {
    label: 'search beads',
    placeholder: 'search',
    title: (key: string) => `titles, ids, labels, descriptions, notes and comments, closed beads too (${key})`,
    clear: 'clear search',
    scopeLabel: 'search scope',
    scopes: { all: 'all', open: 'open', closed: 'closed' } satisfies Record<SearchScope, string>,
    fields: {
      id: 'id',
      title: 'title',
      label: 'label',
      description: 'description',
      notes: 'notes',
      comment: 'comment',
    } satisfies Record<SearchField, string>,
    you: 'you',
    authorUnknown: 'author unknown',
    failed: (error: string) => `search failed: ${error}`,
    searching: 'searching…',
    none: (scope: SearchScope, query: string) => `no ${scope === 'all' ? '' : `${scope} `}bead matches “${query}”`,
    found: (total: number, scope: SearchScope, shown: number, updating: boolean) =>
      `${total} ${scope === 'all' ? '' : `${scope} `}${enPlural(total, 'bead')}` +
      `${shown < total ? `, top ${shown} shown` : ''}${updating ? ' · updating…' : ''}`,
  },

  capture: (labels: string[]) =>
    labels.length > 0
      ? `capture a thought, enter files it as ${labels.join(' + ')}`
      : 'capture a thought, enter files it',

  emptySection: (signal: boolean): string => (signal ? 'nothing waiting' : 'nothing here'),

  /** the sections the board model titles itself */
  sections: EN_SECTIONS as SectionStrings,

  /** the inbox's own section copy; the asks title and note come from the config */
  inbox: {
    ...EN_INBOX,

    clearedTitle: 'Inbox clear.',
    clearedBody:
      "No replies to read, no calls to make, nothing due this week and today's stale beads have their verdicts.",
    lanes: 'the lanes',
    read: 'read',
    answered: 'answered',
    overdue: (when: string) => `overdue, was due ${when}`,
    dueToday: 'due today',
    dueOn: (when: string) => `due ${when}`,
    replied: (name: string, when: string) => `${name} replied ${when}`,
    closedOn: (when: string) => `closed ${when}`,
    untouched: (days: number, since: string) => `untouched ${days} days, since ${since}`,
    youAnswered: (when: string, text: string) => `you answered ${when}${text ? `: ${text}` : ''}, waiting for a session`,

    keep: 'keep',
    keepTitle: 'still wanted: stamp it kept, it leaves the stale list',
    snooze: 'snooze 4w',
    snoozeTitle: (until: string) => `defer until ${until}`,
    close: 'close',
    closeTitle: 'close it as stale',
    weekTitle: 'due a week from now',
    twoWeeksTitle: 'due two weeks from now',
    newDue: (title: string) => `new due date for ${title}`,
    pickDate: 'pick a date',

    staleNoteList: 'open, untouched 30+ days, oldest first',
    nothingStale: 'nothing stale. every open bead moved this month.',
    tryTitle: 'ready to try',
    tryNote: 'shipped, waiting for you to see it on the real thing',
    noKit: 'no check kit stored on this bead yet',
    noApp: 'no app named',
    nothingToTry: 'nothing to try right now.',
  },

  status: {
    open: 'open',
    in_progress: 'in progress',
    blocked: 'blocked',
    deferred: 'deferred',
    pinned: 'pinned',
    closed: 'closed',
  } satisfies Record<Status, string>,

  keys: {
    title: 'keyboard keys',
    move: 'move',
    note: 'write a note',
    send: 'send the note',
    leave: 'leave a field, clear the search',
    views: 'inbox, board, stale',
    tries: 'ready to try, when on',
    search: 'search',
    capture: 'capture a thought',
    copy: 'copy the id',
    defer: 'defer',
    closeBead: 'close',
    fold: 'fold, unfold',
    theme: 'theme',
    font: 'body font',
    help: 'this list',
    hintHelp: 'keys',
  },

  detail: {
    none: 'no bead open.',
    back: 'back to the list',
    list: 'list',
    copyId: 'copy id',
    comments: (n: number) => `${n} ${enPlural(n, 'comment')}`,
    touched: 'touched ',
    opened: 'opened ',
    updated: 'updated ',
    closed: 'closed ',
    due: 'due ',
    unreadMine: 'your note is still unread',
    unreadLegacy: 'an unread note, written before authors were recorded',
    description: 'description',
    folded: 'folded',
    noDescription: 'no description on this bead.',
    notes: 'notes',
    links: 'links',
    notInLedger: 'not in this ledger',
    commentsHeading: 'comments',
    orderNow: (order: CommentOrder) => `${order} first`,
    orderSwitch: (order: CommentOrder) => `switch to ${order === 'oldest' ? 'newest' : 'oldest'} first`,
    noComments: 'no comments yet.',
    readingComments: 'reading comments…',
    sessions: 'sessions that touched it',
    noSessions: 'no session mentions this id.',
    inNotes: 'in notes',
    // comment heads and tags
    you: 'You',
    youLower: 'you',
    agent: 'agent',
    authorUnknown: 'author unknown',
    unknownTitle: (author: string) => `stored author "${author}" does not say whether a person or an agent wrote it`,
    unread: 'unread',
    unreadTitle: 'no agent has read this note yet',
    reply: 'reply',
    replyTitle: 'written after your latest note',
    more: 'more',
    less: 'less',
    readBy: (who: string, when: string) => `read by ${who}, ${when}`,
    answeredBy: (who: string, when: string) => `answered by ${who}, ${when}`,
    readLabelTitle: (actor: string, flag: string, ago: string) =>
      `${actor || 'someone'} took the ${flag} flag off ${ago}, from bd's audit events`,
    readGuessTitle: (ago: string) =>
      `the first agent comment after this note, ${ago}; this clone has no record of the flag coming off`,
    noteWord: 'note',
  },

  /** link group headings, keyed like model.linksOf; a kind the board does not know keeps its name */
  links: {
    'parent:out': 'parent',
    'parent:in': 'children',
    'blocks:out': 'depends on',
    'blocks:in': 'blocks',
    related: 'related',
    'discovered:out': 'discovered from',
    'discovered:in': 'discovered',
    'supersedes:out': 'superseded by',
    'supersedes:in': 'supersedes',
  } as Record<string, string>,

  route: {
    label: 'how far the bead has come',
    created: 'opened',
    working: 'in progress',
    deferred: 'deferred',
    pinned: 'pinned',
    closed: 'closed',
  },

  write: {
    priority: 'priority',
    setPriority: (p: number) => `set priority ${p}`,
    status: 'status',
    labels: 'labels',
    addLabel: 'add label',
    add: 'add',
    remove: (label: string) => `remove ${label}`,
  },

  note: {
    placeholder: (short: string) => `write a note to the next session that opens ${short}…`,
    runs: 'sending runs',
    labels: 'and labels the bead',
    readsFirst: ', so the next session reads it first.',
    clear: (labels: string[]) => `and clear ${labels.join(', ')}`,
    sending: 'sending…',
    send: 'send note',
  },

  ask: {
    answeredLabel: 'answered question',
    toAnswer: 'question to answer',
    answered: 'answered',
    via: { hub: 'from the hub', beadside: 'here' } as Record<string, string>,
    waiting: 'waiting for a session to act on it',
    question: 'question',
    first: (when: string) => `first ${when}`,
    due: (when: string) => `due ${when}`,
    lean: 'lean',
    theLean: 'the lean',
    answerFor: (short: string) => `answer for ${short}`,
    pickOrWrite: 'pick an option or write your answer…',
    write: 'write your answer…',
    hintStart: (short: string) => `answering writes it as your note on ${short}`,
    hintLabel: ', labels it ',
    hintEnd: ' and marks the question answered.',
    answering: 'answering…',
    answer: 'answer',
    raised: (days: number) => (days === 1 ? 'raised once' : `raised ${days} days`),
  },

  tryIt: {
    label: 'ready to try',
    shipped: (when: string) => `shipped ${when}`,
    lastTime: (when: string, what: string) => `last time, ${when}: ${what}`,
    expect: 'expect',
    checked: 'checked',
    qr: (label: string) => `qr code: ${label}`,
    open: 'open',
    copy: 'copy',
    path: 'path',
    broken: 'Still broken',
    brokenPlaceholder: 'what you saw, one line is enough…',
    cant: "Couldn't check",
    cantPlaceholder: 'what stopped you: a dead link, no release, no device…',
    noteFor: (label: string, short: string) => `${label} note for ${short}`,
    goesOn: (short: string, verdict: Exclude<TryVerdict, 'works'>) =>
      `goes on ${short} as your note${verdict === 'cant' ? '; it stays ready to try' : '; agents pick it up from there'}.`,
    worksCloses: (short: string) => `Works closes ${short}; the other two ask for a short note first.`,
    works: 'Works',
    closing: 'closing…',
    sending: 'sending…',
    minutes: (n: number) => `${n} min`,
    lastCant: (note: string | null) => `you couldn't check it${note ? `: ${note}` : ''}`,
    lastBroken: (note: string | null) => `you found it still broken${note ? `: ${note}` : ''}`,
    lastWorks: 'you said it works',
  },

  toast: {
    undo: 'undo',
    ok: 'ok',
    undone: 'undone',
    undoFailed: 'undo failed',
    seenFailed: (id: string, error: string) => `could not store ${id} as read: ${error}`,
    picksFailed: (error: string) => `could not store the stale picks: ${error}`,
    writeFailed: 'write failed',
    commentFailed: 'comment failed',
    answerFailed: 'answer failed',
    verdictFailed: 'verdict failed',
    captureFailed: 'capture failed',
    searchFailed: 'search failed',
    priority: (short: string, p: number) => `${short} set to p${p}`,
    status: (short: string, status: Status, before: Status) =>
      `${short} ${
        status === 'closed' || status === 'deferred' || status === 'pinned'
          ? status
          : status === 'in_progress'
            ? 'started'
            : status === 'blocked'
              ? 'blocked'
              : before === 'pinned'
                ? 'unpinned'
                : 'reopened'
      }`,
    due: (short: string, due: string) => `${short} due ${due}`,
    kept: (short: string) => `${short} kept, off the stale list for 30 days`,
    snoozed: (short: string) => `${short} snoozed 4 weeks`,
    staleReason: 'stale, closed from beadside',
    labels: (short: string, add: string[], remove: string[]) =>
      `${short} ${add.length ? `+${add.join(' +')}` : `-${remove.join(' -')}`}`,
    noteOn: (short: string) => `note on ${short}`,
    answered: (short: string) => `answered ${short}`,
    labelSet: (label: string) => `, ${label} set`,
    cleared: (labels: string[]) => `, ${labels.join(', ')} cleared`,
    works: (short: string) => `${short} works, closed`,
    broken: (short: string) => `${short} still broken, back with the agents`,
    cant: (short: string) => `${short}: noted what stopped you, still ready to try`,
    filed: (short: string, labels: string[]) => `filed ${short}${labels.length ? ` as ${labels.join(' + ')}` : ''}`,
    copied: (what: string) => `copied ${what}`,
    copyFailed: (what: string) => `could not copy ${what}`,
  },
}

export type Strings = typeof en

const cs: Strings = {
  locale: 'cs',
  brand: 'beadside',

  date: (iso) => formatDate(iso, 'cs'),
  shortDate: (iso) => formatShortDate(iso, 'cs'),
  dateTime: (iso) => formatDateTime(iso, 'cs'),
  shortDateTime: (iso) => formatShortDateTime(iso, 'cs'),
  relative: (iso, now) => relativeTime(iso, now, 'cs'),

  app: {
    noServer: 'server beadside na /api neodpovídá.',
    loading: 'načítám backlog…',
  },

  head: {
    read: (time) => `načteno ${time}`,
    light: 'světlý',
    dark: 'tmavý',
    switchTheme: (to) => `přepnout na ${to} režim`,
    switchFont: (to) => `přepnout písmo na ${to}`,
  },

  counts: {
    open: 'otevřeno',
    inProgress: 'v řešení',
    deferred: 'odloženo',
    waiting: 'čeká na tebe',
    unread: 's poznámkou',
  },

  views: {
    label: 'pohled',
    inbox: 'inbox',
    board: 'nástěnka',
    stale: 'zatuchlé',
  },

  search: {
    label: 'hledat v beadech',
    placeholder: 'hledat',
    title: (key) => `názvy, id, labely, popisy, poznámky a komentáře, i uzavřené beady (${key})`,
    clear: 'zrušit hledání',
    scopeLabel: 'rozsah hledání',
    scopes: { all: 'vše', open: 'otevřené', closed: 'uzavřené' },
    fields: {
      id: 'id',
      title: 'název',
      label: 'label',
      description: 'popis',
      notes: 'poznámky',
      comment: 'komentář',
    },
    you: 'ty',
    authorUnknown: 'neznámý autor',
    failed: (error) => `hledání selhalo: ${error}`,
    searching: 'hledám…',
    none: (scope, query) =>
      `${scope === 'open' ? 'žádný otevřený bead' : scope === 'closed' ? 'žádný uzavřený bead' : 'žádný bead'} neodpovídá „${query}“`,
    found: (total, scope, shown, updating) => {
      const kind =
        scope === 'open'
          ? csPlural(total, 'otevřený ', 'otevřené ', 'otevřených ')
          : scope === 'closed'
            ? csPlural(total, 'uzavřený ', 'uzavřené ', 'uzavřených ')
            : ''
      return (
        `${total} ${kind}${csPlural(total, 'bead', 'beady', 'beadů')}` +
        `${shown < total ? `, zobrazeno prvních ${shown}` : ''}${updating ? ' · obnovuji…' : ''}`
      )
    },
  },

  capture: (labels) =>
    labels.length > 0
      ? `zapiš myšlenku, Enter ji založí jako ${labels.join(' + ')}`
      : 'zapiš myšlenku, Enter ji založí',

  emptySection: (signal) => (signal ? 'nic nečeká' : 'nic tu není'),

  sections: {
    pinned: 'připnuté',
    pinnedNote: 'stálé beady, pořád na očích',
    deferred: 'odložené',
    deferredNote: 'čekají, až je vezmeš',
    closed: 'nedávno uzavřené',
    closedNote: 'posledních dvanáct, přeškrtnuté',
  },

  inbox: {
    askNote: 'otázka uložená na beadu, odpověz u něj',
    replies: 'odpovědi',
    repliesNote: 'agent odpověděl na tvou poznámku',
    closed: 'zodpovězené, uzavřené',
    closedNote: 'poznámka dostala odpověď a bead se uzavřel',
    labelNote: 'rozhodnutí, které uděláš jen ty',
    due: 'termíny',
    dueNote: (days) => `po termínu nebo do ${days} ${csPlural(days, 'dne', 'dnů', 'dnů')}`,
    stale: 'zatuchlé',
    staleNote: (days) => `bez změny ${days}+ dní, nechat, odložit nebo uzavřít`,

    clearedTitle: 'Inbox je prázdný.',
    clearedBody:
      'Žádné odpovědi ke čtení, žádná rozhodnutí, nic s termínem tento týden a dnešní zatuchlé beady mají verdikt.',
    lanes: 'nástěnka',
    read: 'přečteno',
    answered: 'zodpovězeno',
    overdue: (when) => `po termínu, měl být hotový ${when}`,
    dueToday: 'termín dnes',
    dueOn: (when) => `termín ${when}`,
    replied: (name, when) => `${name} odpověděl ${when}`,
    closedOn: (when) => `uzavřeno ${when}`,
    untouched: (days, since) => `bez změny ${days} ${csPlural(days, 'den', 'dny', 'dní')}, od ${since}`,
    youAnswered: (when, text) => `odpověděl jsi ${when}${text ? `: ${text}` : ''}, čeká na sezení`,

    keep: 'nechat',
    keepTitle: 'pořád platí: označit jako ponechaný, zmizí ze zatuchlých',
    snooze: 'odložit 4 t.',
    snoozeTitle: (until) => `odložit do ${until}`,
    close: 'uzavřít',
    closeTitle: 'uzavřít jako zatuchlý',
    weekTitle: 'termín za týden',
    twoWeeksTitle: 'termín za dva týdny',
    newDue: (title) => `nový termín pro ${title}`,
    pickDate: 'vybrat datum',

    staleNoteList: 'otevřené, bez změny 30+ dní, nejstarší první',
    nothingStale: 'nic nezatuchlo. každý otevřený bead se tento měsíc pohnul.',
    tryTitle: 'k vyzkoušení',
    tryNote: 'nasazené, čeká, až to uvidíš naživo',
    noKit: 'bead zatím nemá uložený postup ověření',
    noApp: 'bez aplikace',
    nothingToTry: 'teď není co zkoušet.',
  },

  status: {
    open: 'otevřeno',
    in_progress: 'v řešení',
    blocked: 'blokováno',
    deferred: 'odloženo',
    pinned: 'připnuto',
    closed: 'uzavřeno',
  },

  keys: {
    title: 'Klávesy',
    move: 'pohyb',
    note: 'napsat poznámku',
    send: 'odeslat poznámku',
    leave: 'opustit pole, zrušit hledání',
    views: 'inbox, nástěnka, zatuchlé',
    tries: 'k vyzkoušení, když je zapnuté',
    search: 'hledat',
    capture: 'zapsat myšlenku',
    copy: 'kopírovat id',
    defer: 'odložit',
    closeBead: 'uzavřít',
    fold: 'sbalit, rozbalit',
    theme: 'světlý a tmavý režim',
    font: 'písmo',
    help: 'tento seznam',
    hintHelp: 'klávesy',
  },

  detail: {
    none: 'žádný otevřený bead.',
    back: 'zpět na seznam',
    list: 'seznam',
    copyId: 'kopírovat id',
    comments: (n) => `${n} ${csPlural(n, 'komentář', 'komentáře', 'komentářů')}`,
    touched: 'změna ',
    opened: 'založeno ',
    updated: 'upraveno ',
    closed: 'uzavřeno ',
    due: 'termín ',
    unreadMine: 'tvoje poznámka je zatím nepřečtená',
    unreadLegacy: 'nepřečtená poznámka z doby, kdy se autoři nezapisovali',
    description: 'popis',
    folded: 'sbaleno',
    noDescription: 'bead nemá popis.',
    notes: 'poznámky',
    links: 'vazby',
    notInLedger: 'v tomto backlogu není',
    commentsHeading: 'komentáře',
    orderNow: (order) => (order === 'oldest' ? 'nejstarší první' : 'nejnovější první'),
    orderSwitch: (order) => (order === 'oldest' ? 'přepnout na nejnovější první' : 'přepnout na nejstarší první'),
    noComments: 'zatím bez komentářů.',
    readingComments: 'načítám komentáře…',
    sessions: 'sezení, která na něj sáhla',
    noSessions: 'žádné sezení tohle id nezmiňuje.',
    inNotes: 'v poznámkách',
    you: 'Ty',
    youLower: 'ty',
    agent: 'agent',
    authorUnknown: 'neznámý autor',
    unknownTitle: (author) => `uložený autor „${author}“ neříká, jestli psal člověk nebo agent`,
    unread: 'nepřečteno',
    unreadTitle: 'tuhle poznámku zatím žádný agent nečetl',
    reply: 'odpověď',
    replyTitle: 'napsáno po tvé poslední poznámce',
    more: 'víc',
    less: 'méně',
    readBy: (who, when) => `přečetl ${who}, ${when}`,
    answeredBy: (who, when) => `odpověděl ${who}, ${when}`,
    readLabelTitle: (actor, flag, ago) => `${actor || 'někdo'} odebral label ${flag} ${ago}, podle auditu bd`,
    readGuessTitle: (ago) => `první komentář agenta po této poznámce, ${ago}; tento klon nemá záznam o odebrání labelu`,
    noteWord: 'poznámky',
  },

  links: {
    'parent:out': 'nadřazený',
    'parent:in': 'podřazené',
    'blocks:out': 'závisí na',
    'blocks:in': 'blokuje',
    related: 'související',
    'discovered:out': 'objeveno při',
    'discovered:in': 'objevené',
    'supersedes:out': 'nahrazeno',
    'supersedes:in': 'nahrazuje',
  },

  route: {
    label: 'kam bead došel',
    created: 'založeno',
    working: 'v řešení',
    deferred: 'odloženo',
    pinned: 'připnuto',
    closed: 'uzavřeno',
  },

  write: {
    priority: 'priorita',
    setPriority: (p) => `nastavit prioritu ${p}`,
    status: 'stav',
    labels: 'labely',
    addLabel: 'přidat label',
    add: 'přidat',
    remove: (label) => `odebrat ${label}`,
  },

  note: {
    placeholder: (short) => `poznámka pro další sezení, které otevře ${short}…`,
    runs: 'odeslání spustí',
    labels: 'a přidá label',
    readsFirst: ', takže ji další sezení přečte jako první.',
    clear: (labels) => `a odebrat ${labels.join(', ')}`,
    sending: 'odesílám…',
    send: 'odeslat poznámku',
  },

  ask: {
    answeredLabel: 'zodpovězená otázka',
    toAnswer: 'otázka k zodpovězení',
    answered: 'zodpovězeno',
    via: { hub: 'z hubu', beadside: 'tady' },
    waiting: 'čeká, až s tím sezení něco udělá',
    question: 'otázka',
    first: (when) => `poprvé ${when}`,
    due: (when) => `termín ${when}`,
    lean: 'doporučení',
    theLean: 'k tomu se agent přiklání',
    answerFor: (short) => `odpověď pro ${short}`,
    pickOrWrite: 'vyber možnost nebo napiš odpověď…',
    write: 'napiš odpověď…',
    hintStart: (short) => `odpověď se zapíše jako tvoje poznámka u ${short}`,
    hintLabel: ', přidá label ',
    hintEnd: ' a označí otázku jako zodpovězenou.',
    answering: 'odpovídám…',
    answer: 'odpovědět',
    raised: (days) => (days === 1 ? 'vzneseno jednou' : `vzneseno ${days} ${csPlural(days, 'den', 'dny', 'dní')}`),
  },

  tryIt: {
    label: 'k vyzkoušení',
    shipped: (when) => `nasazeno ${when}`,
    lastTime: (when, what) => `minule, ${when}: ${what}`,
    expect: 'čekej',
    checked: 'ověřeno',
    qr: (label) => `qr kód: ${label}`,
    open: 'otevřít',
    copy: 'kopírovat',
    path: 'cesta',
    broken: 'Pořád rozbité',
    brokenPlaceholder: 'co jsi viděl, stačí jeden řádek…',
    cant: 'Nešlo ověřit',
    cantPlaceholder: 'co tě zastavilo: mrtvý odkaz, chybí release, chybí zařízení…',
    noteFor: (label, short) => `${label}, poznámka pro ${short}`,
    goesOn: (short, verdict) =>
      `zapíše se k ${short} jako tvoje poznámka${verdict === 'cant' ? '; zůstane k vyzkoušení' : '; převezmou to agenti'}.`,
    worksCloses: (short) => `Funguje uzavře ${short}; zbylé dva chtějí nejdřív krátkou poznámku.`,
    works: 'Funguje',
    closing: 'uzavírám…',
    sending: 'odesílám…',
    minutes: (n) => `${n} min`,
    lastCant: (note) => `nešlo to ověřit${note ? `: ${note}` : ''}`,
    lastBroken: (note) => `pořád to bylo rozbité${note ? `: ${note}` : ''}`,
    lastWorks: 'podle tebe to funguje',
  },

  toast: {
    undo: 'vrátit',
    ok: 'ok',
    undone: 'vráceno',
    undoFailed: 'vrácení selhalo',
    seenFailed: (id, error) => `${id} se nepodařilo označit jako přečtený: ${error}`,
    picksFailed: (error) => `dnešní výběr zatuchlých se neuložil: ${error}`,
    writeFailed: 'zápis selhal',
    commentFailed: 'komentář se neuložil',
    answerFailed: 'odpověď se neuložila',
    verdictFailed: 'verdikt se neuložil',
    captureFailed: 'bead se nepodařilo založit',
    searchFailed: 'hledání selhalo',
    priority: (short, p) => `${short}: priorita p${p}`,
    status: (short, status, before) =>
      `${short}: ${
        status === 'closed'
          ? 'uzavřeno'
          : status === 'deferred'
            ? 'odloženo'
            : status === 'pinned'
              ? 'připnuto'
              : status === 'in_progress'
                ? 'v řešení'
                : status === 'blocked'
                  ? 'blokováno'
                  : before === 'pinned'
                    ? 'odepnuto'
                    : 'znovu otevřeno'
      }`,
    due: (short, due) => `${short}: termín ${due}`,
    kept: (short) => `${short} ponechán, 30 dní mimo zatuchlé`,
    snoozed: (short) => `${short} odložen na 4 týdny`,
    staleReason: 'zatuchlé, uzavřeno z beadside',
    labels: (short, add, remove) => `${short} ${add.length ? `+${add.join(' +')}` : `-${remove.join(' -')}`}`,
    noteOn: (short) => `poznámka u ${short}`,
    answered: (short) => `odpověď u ${short}`,
    labelSet: (label) => `, přidán ${label}`,
    cleared: (labels) => `, odebráno ${labels.join(', ')}`,
    works: (short) => `${short} funguje, uzavřeno`,
    broken: (short) => `${short} pořád rozbitý, zpátky u agentů`,
    cant: (short) => `${short}: zapsáno, co tě zastavilo, zůstává k vyzkoušení`,
    filed: (short, labels) => `založeno ${short}${labels.length ? ` jako ${labels.join(' + ')}` : ''}`,
    copied: (what) => `zkopírováno ${what}`,
    copyFailed: (what) => `${what} nejde zkopírovat`,
  },
}

const TABLE: Record<Locale, Strings> = { en, cs }

/** the copy for a locale, english for anything unknown */
export function stringsFor(locale: Locale | null | undefined): Strings {
  return (locale && TABLE[locale]) || en
}

/** english, for code that runs outside the provider: tests, pure helpers */
export const EN: Strings = en

export const StringsContext = createContext<Strings>(en)

/** the copy for the board's configured locale */
export function useStrings(): Strings {
  return useContext(StringsContext)
}

/** "raised 3 days", empty when the question carries no count */
export function raisedLine(s: Strings, ask: Ask): string {
  const days = ask.days_raised
  return !days || days < 1 ? '' : s.ask.raised(days)
}

/** what the last verdict on a check says */
export function lastLine(s: Strings, last: TryLast): string {
  if (last.result === 'cant') return s.tryIt.lastCant(last.note)
  if (last.result === 'broken') return s.tryIt.lastBroken(last.note)
  return s.tryIt.lastWorks
}

/** the short facts beside a check: where it happens, how many minutes */
export function tryFacts(s: Strings, kit: TryKit): string[] {
  const out: string[] = []
  if (kit.where) out.push(kit.where)
  if (kit.minutes) out.push(s.tryIt.minutes(kit.minutes))
  return out
}

/** a link group's heading in the current copy; a kind the board does not know keeps bd's name */
export function linkTitle(s: Strings, group: { key: string; title: string }): string {
  return s.links[group.key] ?? group.title
}
