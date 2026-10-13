// who wrote a comment: the stored `bd` author string read as the board's human, a named
// agent, or unknown. the stored string stays canonical; this only derives a display label.

/** the person the board writes as; `id` is what bd stores, `name` is what people read */
export interface HumanIdentity {
  id: string
  name: string
}

export type AuthorKind = 'human' | 'agent' | 'unknown'

export interface Author {
  kind: AuthorKind
  /** display name: Mike, Claude, Codex, Gemini, Agent, or the raw stored string when unknown */
  name: string
  /** true only for the board's own configured human */
  self: boolean
}

/** provider slugs agents store after `agent:`, and the bare names older comments used */
const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  agy: 'Gemini',
  antigravity: 'Gemini',
}

const capitalise = (word: string): string => (word ? word[0]!.toUpperCase() + word.slice(1) : word)

/**
 * reads a stored comment author. `agent:<provider>` and `human:<name>` are the canonical
 * forms; a bare provider name (`Codex`) also counts as that agent. anything else, including
 * the shared git username older comments carry, is unknown: the string cannot say who wrote it.
 */
export function classifyAuthor(raw: string, human: HumanIdentity): Author {
  const author = raw.trim()
  if (author === human.id) return { kind: 'human', name: human.name, self: true }

  const lower = author.toLowerCase()
  const agent = /^agent(?::(.+))?$/.exec(lower)
  if (agent) {
    const provider = agent[1]?.trim() ?? ''
    const name = provider ? (AGENT_NAMES[provider] ?? capitalise(provider)) : 'Agent'
    return { kind: 'agent', name, self: false }
  }
  const bare = AGENT_NAMES[lower]
  if (bare) return { kind: 'agent', name: bare, self: false }

  const person = /^human:(.+)$/i.exec(author)
  if (person) return { kind: 'human', name: capitalise(person[1]!.trim()), self: false }

  return { kind: 'unknown', name: author || 'unknown', self: false }
}

/** the default human when the config names none: `human:<name>` from git user.name or $USER */
export function defaultHuman(name: string): HumanIdentity {
  const clean = name.trim() || 'unknown'
  return { id: `human:${clean}`, name: clean }
}

/** an agent comment newer than the human's latest note: a reply the human has not answered */
export interface AgentReply {
  /** created_at of the newest such comment */
  at: string
  /** display name of the agent that wrote it */
  name: string
}

/**
 * the newest agent comment written after the human's own latest comment, or null. a bead the
 * human never commented on has nothing to reply to; legacy unknown authors count as neither.
 */
export function agentReply(
  comments: readonly { author: string; created_at: string }[],
  human: HumanIdentity,
): AgentReply | null {
  let mine = ''
  let reply: AgentReply | null = null
  for (const comment of comments) {
    const by = classifyAuthor(comment.author, human)
    if (by.self && comment.created_at > mine) mine = comment.created_at
    if (by.kind === 'agent' && (!reply || comment.created_at > reply.at)) reply = { at: comment.created_at, name: by.name }
  }
  return mine && reply && reply.at > mine ? reply : null
}
