/**
 * Privacy-safe projection of the Harness ConversationSnapshot.
 *
 * The Harness client runtime exposes typed ConversationNode/AssistantBlock
 * kinds. We intentionally project only public text/tool/result arms and never
 * pass the snapshot to the native trajectory viewer, whose product surface
 * includes reasoning details. The structural types here keep this plugin's
 * client bundle compatible with the host's injected runtime package.
 */
/** Resolve the official direct-parent address from a loaded Harness catalog. */
export function subagentAddressFromCatalog(parentSessionId, childSessionId, entries) {
    if (parentSessionId === undefined || entries === undefined)
        return undefined;
    const entry = entries.find((candidate) => candidate !== null && typeof candidate === 'object' && candidate.id === childSessionId);
    if (entry === undefined || typeof entry !== 'object')
        return undefined;
    const value = entry;
    if (value.kind !== 'child')
        return undefined;
    if (value.mode !== 'continuable' && value.mode !== 'one-shot')
        return undefined;
    return { parentSessionId, childSessionId, mode: value.mode };
}
function textFromBlocks(blocks) {
    if (!Array.isArray(blocks))
        return '';
    return blocks
        .filter((block) => block !== null && typeof block === 'object')
        .filter((block) => block.kind === 'text' || block.type === 'text' || block.type === 'json')
        .map((block) => {
        if (typeof block.text === 'string')
            return block.text;
        if (typeof block.json === 'string')
            return block.json;
        if (block.json !== undefined) {
            try {
                return JSON.stringify(block.json);
            }
            catch {
                return '';
            }
        }
        return '';
    })
        .filter((text) => text.length > 0)
        .join('\n');
}
function nodeSourceForm(node) {
    const provenance = node.provenance;
    if (provenance !== null && typeof provenance === 'object' && typeof provenance.form === 'string') {
        return provenance.form;
    }
    if (typeof node.form === 'string')
        return node.form;
    const source = node.source;
    if (source !== null && typeof source === 'object' && typeof source.form === 'string') {
        return source.form;
    }
    return undefined;
}
/** Convert one official Harness ConversationSnapshot shape into public rows. */
export function projectVisibleSession(input) {
    const snapshot = input !== null && typeof input === 'object' ? input : {};
    const rawNodes = Array.isArray(snapshot.nodes)
        ? snapshot.nodes
        : (snapshot.chat !== null && typeof snapshot.chat === 'object' && snapshot.chat.legacy !== undefined
            ? snapshot.chat.legacy.nodes
            : []);
    const items = [];
    for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
        if (raw === null || typeof raw !== 'object')
            continue;
        const node = raw;
        const seq = typeof node.seq === 'number' ? node.seq : items.length;
        const time = typeof node.time === 'number' ? node.time : undefined;
        const id = `${String(node.kind ?? 'event')}-${seq}`;
        if (node.kind === 'user' || node.kind === 'steering') {
            const text = textFromBlocks(node.content);
            if (text !== '')
                items.push({ id, kind: 'user', time, text });
            continue;
        }
        if (node.kind === 'assistant') {
            const blocks = Array.isArray(node.blocks) ? node.blocks : [];
            for (const block of blocks) {
                if (block === null || typeof block !== 'object')
                    continue;
                const value = block;
                if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '') {
                    items.push({ id: `${id}-text-${items.length}`, kind: 'assistant', time, text: value.text });
                }
                else if (value.kind === 'tool-call' && typeof value.name === 'string') {
                    items.push({ id: `${id}-call-${items.length}`, kind: 'tool-call', time, text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
                }
                // `kind === reasoning` and all unknown/private blocks are deliberately dropped.
            }
            continue;
        }
        if (node.kind === 'tool-result') {
            const text = textFromBlocks(node.content);
            const call = node.call;
            const name = call !== null && typeof call === 'object' && typeof call.name === 'string'
                ? call.name
                : undefined;
            if (text !== '' || name !== undefined)
                items.push({ id, kind: 'tool-result', time, text: text || '✓ completed', name, error: node.isError === true });
            continue;
        }
        // Reports/team events are context nodes with an explicit public form. Do
        // not surface arbitrary context injections: absence of a public form is a
        // conservative privacy boundary.
        if (node.kind === 'context') {
            const form = nodeSourceForm(node);
            if (form === 'report' || form === 'team-message' || form === 'task-event' || form === 'subagent-report') {
                const text = textFromBlocks(node.content);
                if (text !== '')
                    items.push({ id, kind: 'report', time, text });
            }
        }
    }
    const partial = snapshot.partial;
    if (partial !== null && partial !== undefined && typeof partial === 'object') {
        const partialRecord = partial;
        const blocks = Array.isArray(partialRecord.blocks) ? partialRecord.blocks : [];
        for (const block of blocks) {
            if (block === null || typeof block !== 'object')
                continue;
            const value = block;
            if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '')
                items.push({ id: `partial-text-${items.length}`, kind: 'assistant', text: value.text });
            if (value.kind === 'tool-call' && typeof value.name === 'string')
                items.push({ id: `partial-call-${items.length}`, kind: 'tool-call', text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
        }
    }
    return {
        sessionId: typeof snapshot.sessionId === 'string' ? snapshot.sessionId : '',
        running: snapshot.running === true,
        openState: typeof snapshot.openState === 'string' ? snapshot.openState : undefined,
        items,
    };
}
