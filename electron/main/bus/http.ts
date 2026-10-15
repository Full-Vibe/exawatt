/**
 * The outbound door's verbs (ENG-029 C4): what an Agent's `exawatt` command
 * reaches on the loopback channel, answered in plain text the Agent reads.
 *
 *   agents          the Agents in my Project
 *   send            body: recipient on the first line, the message after it
 *   inbox           the messages sent to me, newest last
 *
 * The caller is identified by its Session's bus token, never by anything it
 * says: the sender's identity is Exawatt's guarantee (decision `0052` §4).
 */
import {
  busHandle,
  type BusDirectoryEntry,
  type MessageRecord,
} from '@exawatt/core';
import type { BusChannelAnswer } from '../harness-events/channel';
import type { BusDirectory } from './directory';
import type { BusDispatcher } from './dispatch';
import type { BusStore } from './ledger';

/** How many messages `exawatt inbox` shows. */
const INBOX_LIMIT = 20;

interface BusHttpDeps {
  directory: BusDirectory;
  dispatcher: Pick<BusDispatcher, 'send'>;
  store: Pick<BusStore, 'read'>;
  harnessLabel(harness: BusDirectoryEntry['harness']): string;
}

const USAGE = [
  'Usage:',
  '  exawatt agents                  list the Agents in this Project',
  '  exawatt send @name <message>    send a message (or pipe it on stdin)',
  '  exawatt inbox                   read the messages sent to you',
].join('\n');

function describe(entry: BusDirectoryEntry, label: string): string {
  return `@${entry.handle}  ${label}  ${entry.state}  ${entry.sessionId}`;
}

function inboxLine(record: MessageRecord, label: string): string {
  const at = new Date(record.at).toISOString().slice(11, 19);
  const from =
    record.from.kind === 'operator'
      ? 'the operator'
      : `@${busHandle(record.from.name)} (${label})`;
  return `[${at}] from ${from}:\n${record.text}`;
}

export function createBusHttpHandler(deps: BusHttpDeps) {
  return async (
    ptyId: string,
    verb: string,
    body: string
  ): Promise<BusChannelAnswer> => {
    const me = deps.directory.byProcess(ptyId);
    if (!me || me.entry.state !== 'live') {
      return { status: 403, text: 'This Session is no longer running.' };
    }
    const project = me.entry.projectId;
    if (verb === 'agents') {
      const others = deps.directory
        .addressees()
        .filter(
          item =>
            item.entry.projectId === project &&
            item.entry.sessionId !== me.entry.sessionId
        )
        .map(item =>
          describe(item.entry, deps.harnessLabel(item.entry.harness))
        );
      return {
        status: 200,
        text: [
          `You are @${me.entry.handle} in Project ${me.entry.projectName}.`,
          others.length
            ? `Agents you can message:\n${others.map(line => `  ${line}`).join('\n')}`
            : 'No other Agents are running in this Project.',
        ].join('\n'),
      };
    }
    if (verb === 'send') {
      const newline = body.indexOf('\n');
      const to = (newline < 0 ? body : body.slice(0, newline)).trim();
      const text = newline < 0 ? '' : body.slice(newline + 1);
      if (!to) return { status: 400, text: USAGE };
      const result = await deps.dispatcher.send({
        from: {
          sessionId: me.entry.sessionId,
          name: me.entry.name,
          harness: me.entry.harness,
          kind: 'agent',
        },
        projectId: project,
        to,
        text,
        senderSessionId: me.entry.sessionId,
      });
      const delivery = result.delivery;
      const reason = delivery.reason ? `: ${delivery.reason}` : '';
      if (!result.record) {
        const candidates = result.candidates?.length
          ? `\n${result.candidates
              .map(
                entry =>
                  `  ${describe(entry, deps.harnessLabel(entry.harness))}`
              )
              .join('\n')}`
          : '';
        return { status: 409, text: `Not sent${reason}.${candidates}` };
      }
      const recipient = `@${busHandle(result.record.to.name)}`;
      return {
        status: delivery.state === 'undeliverable' ? 409 : 200,
        text: `${delivery.state === 'undeliverable' ? 'Not delivered to' : 'Sent to'} ${recipient}: ${delivery.state}${reason}.`,
      };
    }
    if (verb === 'inbox') {
      const read = await deps.store.read(project);
      if (!read.ok) return { status: 500, text: read.reason };
      const mine = read.records
        .filter(record => record.to.sessionId === me.entry.sessionId)
        .slice(-INBOX_LIMIT);
      return {
        status: 200,
        text: mine.length
          ? mine
              .map(record =>
                inboxLine(
                  record,
                  deps.harnessLabel(
                    record.from.harness as BusDirectoryEntry['harness']
                  )
                )
              )
              .join('\n\n')
          : 'No messages for you yet.',
      };
    }
    return { status: 404, text: USAGE };
  };
}
