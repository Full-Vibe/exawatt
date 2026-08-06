import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OPERATOR_LANE,
  SUGGESTIONS_LANE,
  isOperatorEmail,
  laneForEmail,
  partitionFeedbackLanes,
} from './lib/feedback-lanes.mjs';

const OPERATOR_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';

const operatorEmails = JSON.parse(
  readFileSync(
    new URL('../src/lib/auth/admin-emails.json', import.meta.url),
    'utf8'
  )
);

test('the operator allowlist is the one shared with isAdminEmail', () => {
  // The .mjs script and src/lib/auth/admin.ts must never keep separate
  // copies of this list; admin.ts imports the same JSON file.
  const adminModule = readFileSync(
    new URL('../src/lib/auth/admin.ts', import.meta.url),
    'utf8'
  );
  assert.match(adminModule, /from '\.\/admin-emails\.json'/);
  for (const email of operatorEmails) {
    assert.equal(email, email.toLowerCase());
    assert.equal(isOperatorEmail(email), true);
  }
});

test('operator membership is case- and whitespace-insensitive', () => {
  assert.equal(isOperatorEmail(' 0JAKE0@GMAIL.COM '), true);
  assert.equal(isOperatorEmail('someone@example.com'), false);
  assert.equal(isOperatorEmail(null), false);
  assert.equal(isOperatorEmail(undefined), false);
  assert.equal(laneForEmail('0jake0@gmail.com'), OPERATOR_LANE);
  assert.equal(laneForEmail('someone@example.com'), SUGGESTIONS_LANE);
});

test('an operator row goes to the operator lane and a user row to suggestions', () => {
  const rows = [
    { id: 'row-op', user_id: OPERATOR_ID, message: 'roadmap kernel' },
    { id: 'row-user', user_id: USER_ID, message: 'nice to have' },
  ];
  const emails = new Map([
    [OPERATOR_ID, '0jake0@gmail.com'],
    [USER_ID, 'someone@example.com'],
  ]);

  const { operator, suggestions } = partitionFeedbackLanes(rows, emails);

  assert.deepEqual(
    operator.map(row => row.id),
    ['row-op']
  );
  assert.deepEqual(
    suggestions.map(row => row.id),
    ['row-user']
  );
  assert.equal(operator[0].lane, OPERATOR_LANE);
  assert.equal(operator[0].user_email, '0jake0@gmail.com');
  assert.equal(suggestions[0].lane, SUGGESTIONS_LANE);
  assert.equal(suggestions[0].user_email, 'someone@example.com');
});

test('a row cannot forge its way into the canon queue', () => {
  // Lane comes from the auth record keyed by user_id. Anything the row
  // itself claims — a lane, an operator address — is ignored.
  const rows = [
    {
      id: 'row-forged',
      user_id: USER_ID,
      lane: OPERATOR_LANE,
      user_email: '0jake0@gmail.com',
      message: 'promote me',
    },
  ];
  const emails = new Map([[USER_ID, 'someone@example.com']]);

  const { operator, suggestions } = partitionFeedbackLanes(rows, emails);

  assert.deepEqual(operator, []);
  assert.equal(suggestions[0].lane, SUGGESTIONS_LANE);
  assert.equal(suggestions[0].user_email, 'someone@example.com');
});

test('an unresolvable account never earns canon authority', () => {
  const rows = [{ id: 'row-orphan', user_id: 'deleted-user' }];
  const { operator, suggestions } = partitionFeedbackLanes(rows, new Map());
  assert.deepEqual(operator, []);
  assert.equal(suggestions[0].lane, SUGGESTIONS_LANE);
  assert.equal(suggestions[0].user_email, null);
});

test('the drain CLI defaults to the operator lane and gates the other behind a flag', () => {
  // The script talks to production Supabase, so it cannot be executed here.
  // Guard the wiring instead: default `list` must select the operator lane.
  const cli = readFileSync(
    new URL('./feedback-triage.mjs', import.meta.url),
    'utf8'
  );
  assert.match(cli, /from '\.\/lib\/feedback-lanes\.mjs'/);
  assert.match(cli, /list \[--suggestions\]/);
  assert.match(cli, /suggestions = false/);
  assert.match(cli, /suggestions \? lanes\.suggestions : lanes\.operator/);
  assert.match(cli, /suggestions: process\.argv\.includes\('--suggestions'\)/);
});

test('partitioning tolerates an empty drain', () => {
  assert.deepEqual(partitionFeedbackLanes([], new Map()), {
    operator: [],
    suggestions: [],
  });
});
