/**
 * What `ssh` says when a login fails, and what the operator reads about it.
 *
 * Both SSH legs log in to the same server with the same client and fail the
 * same way: the tunnel (`ssh-tunnel.ts`) and the one-command reads the
 * credential bootstrap runs (`gateway-bootstrap.ts`). Each used to carry its
 * own copy of these phrases and sentences, so a fix to one left the other
 * telling the operator something different about the same failure. They live
 * here once; each leg adds only what is its own (the tunnel's forward
 * failures, the bootstrap's closed connection) and maps the two faults below
 * onto its own failure vocabulary.
 *
 * Every string an operator ever reads is a literal here, which is what keeps
 * the redaction invariant checkable: no code path interpolates a host, user,
 * port, or key path into one.
 */

/** Sentences for the two login faults and for each field `ssh` can name. */
export const SSH_FAILURE_SENTENCES = {
  unreachable:
    'Could not reach that server over SSH. Check that it is online and reachable from this machine.',
  'auth-rejected':
    'The server refused the SSH login. Check that your key is loaded and authorized for that login.',
  address_unresolved:
    'That server address could not be found. Check the server’s hostname or IP address.',
  ssh_port_silent:
    'Nothing answered on the server’s SSH port. Check that the server is online and that its SSH port is right.',
  identity_file_refused:
    'That key file was refused. Check that it is the private key for this login and that only you can read it.',
  identity_file_unreadable:
    'That key file could not be read. Check the path to the private key file and that this account can open it.',
  host_key_changed:
    'The server offered a different SSH host key than the one this machine already trusts. Verify the server first.',
} as const;

/** The two ways an SSH login fails, before either leg names them its own way. */
export type SshLoginFault = 'auth-rejected' | 'unreachable';

/**
 * Ordered because the phrases overlap, and the first match wins.
 *
 * The key-file phrases come BEFORE the generic refusal phrases, and the order
 * is the whole point. A live run against a real server proved that an
 * unreadable or wrongly permissioned `-i` never arrives ALONE: `ssh` warns
 * about the key, offers nothing, and the server then ends the session with
 * `Permission denied (publickey).` With these entries below that phrase they
 * could never win a match. Only a manually entered server can produce them:
 * an alias takes its key from the operator's own SSH configuration.
 *
 * A CHANGED host key is the case that means interception, so it gets its own
 * sentence rather than the one about checking your key.
 *
 * A name that does not resolve and a port nothing answers are one fault and
 * two different mistakes, the address field and the port field (or a server
 * that is genuinely down). Resolution failures come first because `ssh`
 * reports them before it ever tries to connect.
 */
export const SSH_LOGIN_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  fault: SshLoginFault;
  /** Names the field the operator got wrong, when `ssh` said which it was. */
  message?: string;
}> = [
  {
    pattern: /identity file .* not accessible/i,
    fault: 'auth-rejected',
    message: SSH_FAILURE_SENTENCES.identity_file_refused,
  },
  {
    pattern: /no such identity/i,
    fault: 'auth-rejected',
    message: SSH_FAILURE_SENTENCES.identity_file_refused,
  },
  {
    pattern: /bad permissions|unprotected private key file/i,
    fault: 'auth-rejected',
    message: SSH_FAILURE_SENTENCES.identity_file_refused,
  },
  {
    pattern: /invalid format|error in libcrypto/i,
    fault: 'auth-rejected',
    message: SSH_FAILURE_SENTENCES.identity_file_refused,
  },
  {
    pattern:
      /host key verification failed|remote host identification has changed/i,
    fault: 'auth-rejected',
    message: SSH_FAILURE_SENTENCES.host_key_changed,
  },

  { pattern: /permission denied/i, fault: 'auth-rejected' },
  { pattern: /publickey/i, fault: 'auth-rejected' },
  { pattern: /too many authentication failures/i, fault: 'auth-rejected' },

  {
    pattern: /could not resolve hostname/i,
    fault: 'unreachable',
    message: SSH_FAILURE_SENTENCES.address_unresolved,
  },
  {
    pattern: /name or service not known|nodename nor servname/i,
    fault: 'unreachable',
    message: SSH_FAILURE_SENTENCES.address_unresolved,
  },
  {
    pattern:
      /no route to host|network is unreachable|operation timed out|connection timed out|connection refused/i,
    fault: 'unreachable',
    message: SSH_FAILURE_SENTENCES.ssh_port_silent,
  },
];
