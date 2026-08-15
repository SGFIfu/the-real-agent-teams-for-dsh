/**
 * Privacy-safe projection of the Harness ConversationSnapshot.
 *
 * The Harness client runtime exposes typed ConversationNode/AssistantBlock
 * kinds. We intentionally project only public text/tool/result arms and never
 * pass the snapshot to the native trajectory viewer, whose product surface
 * includes reasoning details. The structural types here keep this plugin's
 * client bundle compatible with the host's injected runtime package.
 */

export type SafeSessionItemKind = 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'report';

export interface SafeSessionItem {
  id: string;
  kind: SafeSessionItemKind;
  time?: number;
  text: string;
  name?: string;
  args?: string;
  error?: boolean;
}

export interface SafeSessionSnapshot {
  sessionId: string;
  running: boolean;
  openState?: string;
  items: SafeSessionItem[];
}

export interface SafeSubagentAddress {
  parentSessionId: string;
  childSessionId: string;
  mode: 'one-shot' | 'continuable';
}

/** Resolve the official direct-parent address from a loaded Harness catalog. */
export function subagentAddressFromCatalog(
  parentSessionId: string | undefined,
  childSessionId: string,
  entries: readonly unknown[] | undefined,
): SafeSubagentAddress | undefined {
  if (parentSessionId === undefined || entries === undefined) return undefined;
  const entry = entries.find((candidate) => candidate !== null && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === childSessionId);
  if (entry === undefined || typeof entry !== 'object') return undefined;
  const value = entry as Record<string, unknown>;
  if (value.kind !== 'child') return undefined;
  if (value.mode !== 'continuable' && value.mode !== 'one-shot') return undefined;
  return { parentSessionId, childSessionId, mode: value.mode };
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block): block is Record<string, unknown> => block !== null && typeof block === 'object')
    .filter((block) => block.kind === 'text' || block.type === 'text' || block.type === 'json')
    .map((block) => {
      if (typeof block.text === 'string') return block.text;
      if (typeof block.json === 'string') return block.json;
      if (block.json !== undefined) {
        try { return JSON.stringify(block.json); } catch { return ''; }
      }
      return '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

function nodeSourceForm(node: Record<string, unknown>): string | undefined {
  const provenance = node.provenance;
  if (provenance !== null && typeof provenance === 'object' && typeof (provenance as Record<string, unknown>).form === 'string') {
    return (provenance as Record<string, string>).form;
  }
  if (typeof node.form === 'string') return node.form;
  const source = node.source;
  if (source !== null && typeof source === 'object' && typeof (source as Record<string, unknown>).form === 'string') {
    return (source as Record<string, string>).form;
  }
  return undefined;
}

/** Convert one official Harness ConversationSnapshot shape into public rows. */
export function projectVisibleSession(input: unknown): SafeSessionSnapshot {
  const snapshot = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawNodes = Array.isArray(snapshot.nodes)
    ? snapshot.nodes
    : (snapshot.chat !== null && typeof snapshot.chat === 'object' && (snapshot.chat as Record<string, unknown>).legacy !== undefined
      ? ((snapshot.chat as Record<string, unknown>).legacy as Record<string, unknown>).nodes
      : []);
  const items: SafeSessionItem[] = [];
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    if (raw === null || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    const seq = typeof node.seq === 'number' ? node.seq : items.length;
    const time = typeof node.time === 'number' ? node.time : undefined;
    const id = `${String(node.kind ?? 'event')}-${seq}`;
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = textFromBlocks(node.content);
      if (text !== '') items.push({ id, kind: 'user', time, text });
      continue;
    }
    if (node.kind === 'assistant') {
      const blocks = Array.isArray(node.blocks) ? node.blocks : [];
      for (const block of blocks) {
        if (block === null || typeof block !== 'object') continue;
        const value = block as Record<string, unknown>;
        if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '') {
          items.push({ id: `${id}-text-${items.length}`, kind: 'assistant', time, text: value.text });
        } else if (value.kind === 'tool-call' && typeof value.name === 'string') {
          items.push({ id: `${id}-call-${items.length}`, kind: 'tool-call', time, text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
        }
        // `kind === reasoning` and all unknown/private blocks are deliberately dropped.
      }
      continue;
    }
    if (node.kind === 'tool-result') {
      const text = textFromBlocks(node.content);
      const call = node.call;
      const name = call !== null && typeof call === 'object' && typeof (call as Record<string, unknown>).name === 'string'
        ? (call as Record<string, string>).name
        : undefined;
      if (text !== '' || name !== undefined) items.push({ id, kind: 'tool-result', time, text: text || '✓ completed', name, error: node.isError === true });
      continue;
    }
    // Reports/team events are context nodes with an explicit public form. Do
    // not surface arbitrary context injections: absence of a public form is a
    // conservative privacy boundary.
    if (node.kind === 'context') {
      const form = nodeSourceForm(node);
      if (form === 'report' || form === 'team-message' || form === 'task-event' || form === 'subagent-report') {
        const text = textFromBlocks(node.content);
        if (text !== '') items.push({ id, kind: 'report', time, text });
      }
    }
  }
  const partial = snapshot.partial;
  if (partial !== null && partial !== undefined && typeof partial === 'object') {
    const partialRecord = partial as Record<string, unknown>;
    const blocks = Array.isArray(partialRecord.blocks) ? partialRecord.blocks : [];
    for (const block of blocks) {
      if (block === null || typeof block !== 'object') continue;
      const value = block as Record<string, unknown>;
      if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '') items.push({ id: `partial-text-${items.length}`, kind: 'assistant', text: value.text });
      if (value.kind === 'tool-call' && typeof value.name === 'string') items.push({ id: `partial-call-${items.length}`, kind: 'tool-call', text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
    }
  }
  return {
    sessionId: typeof snapshot.sessionId === 'string' ? snapshot.sessionId : '',
    running: snapshot.running === true,
    openState: typeof snapshot.openState === 'string' ? snapshot.openState : undefined,
    items,
  };
}
