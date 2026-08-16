import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OPERATOR_LANE,
  SUGGESTIONS_LANE,
  isOperatorEmail,
  laneForEmail,
  parseOperatorEmails,
  partitionFeedbackLanes,
} from './lib/feedback-lanes.mjs';

const OPERATOR_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';

const operatorEmails = parseOperatorEmails(
  'maintainer@example.com, operator@example.test'
);

test('the operator allowlist is parsed from deployment configuration', () => {
  assert.deepEqual(
    [...operatorEmails],
    ['maintainer@example.com', 'operator@example.test']
  );
  for (const email of operatorEmails) {
    assert.equal(email, email.toLowerCase());
    assert.equal(isOperatorEmail(email, operatorEmails), true);
  }
  assert.deepEqual([...parseOperatorEmails(' , ')], []);
});

test('operator membership is case- and whitespace-insensitive', () => {
  assert.equal(
    isOperatorEmail(' MAINTAINER@EXAMPLE.COM ', operatorEmails),
    true
  );
  assert.equal(isOperatorEmail('someone@example.com', operatorEmails), false);
  assert.equal(isOperatorEmail(null, operatorEmails), false);
  assert.equal(isOperatorEmail(undefined, operatorEmails), false);
  assert.equal(
    laneForEmail('maintainer@example.com', operatorEmails),
    OPERATOR_LANE
  );
  assert.equal(
    laneForEmail('someone@example.com', operatorEmails),
    SUGGESTIONS_LANE
  );
});

test('an operator row goes to the operator lane and a user row to suggestions', () => {
  const rows = [
    { id: 'row-op', user_id: OPERATOR_ID, message: 'roadmap kernel' },
    { id: 'row-user', user_id: USER_ID, message: 'nice to have' },
  ];
  const emails = new Map([
    [OPERATOR_ID, 'maintainer@example.com'],
    [USER_ID, 'someone@example.com'],
  ]);

  const { operator, suggestions } = partitionFeedbackLanes(
    rows,
    emails,
    operatorEmails
  );

  assert.deepEqual(
    operator.map(row => row.id),
    ['row-op']
  );
  assert.deepEqual(
    suggestions.map(row => row.id),
    ['row-user']
  );
  assert.equal(operator[0].lane, OPERATOR_LANE);
  assert.equal(operator[0].user_email, 'maintainer@example.com');
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
      user_email: 'maintainer@example.com',
      message: 'promote me',
    },
  ];
  const emails = new Map([[USER_ID, 'someone@example.com']]);

  const { operator, suggestions } = partitionFeedbackLanes(
    rows,
    emails,
    operatorEmails
  );

  assert.deepEqual(operator, []);
  assert.equal(suggestions[0].lane, SUGGESTIONS_LANE);
  assert.equal(suggestions[0].user_email, 'someone@example.com');
});

test('an unresolvable account never earns canon authority', () => {
  const rows = [{ id: 'row-orphan', user_id: 'deleted-user' }];
  const { operator, suggestions } = partitionFeedbackLanes(
    rows,
    new Map(),
    operatorEmails
  );
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
  assert.match(cli, /EXAWATT_ADMIN_EMAILS/);
  assert.match(cli, /parseOperatorEmails\(configuredOperatorEmails\)/);
  assert.match(cli, /list \[--suggestions\]/);
  assert.match(cli, /suggestions = false/);
  assert.match(cli, /suggestions \? lanes\.suggestions : lanes\.operator/);
  assert.match(cli, /suggestions: process\.argv\.includes\('--suggestions'\)/);
});

test('partitioning tolerates an empty drain', () => {
  assert.deepEqual(partitionFeedbackLanes([], new Map(), operatorEmails), {
    operator: [],
    suggestions: [],
  });
});
