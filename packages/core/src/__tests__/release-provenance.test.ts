import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_PROVENANCE_PROFILES,
  canonicalizeReleaseProvenanceCompositionV1,
  createReleaseProvenanceV1,
  hashReleaseProvenanceCompositionV1,
  parseReleaseProvenanceCompositionV1,
  parseReleaseProvenanceV1,
  verifyReleaseProvenanceV1,
  type ReleaseProvenanceCompositionV1,
} from '../release-provenance';

const PUBLIC_SHA = '0123456789abcdef0123456789abcdef01234567';
const OVERLAY_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const DISTRIBUTION_SHA256 = 'a'.repeat(64);

const community: ReleaseProvenanceCompositionV1 = {
  schemaVersion: 1,
  profile: 'community',
  version: '0.2.0-beta.1+build.7',
  publicSha: PUBLIC_SHA,
  overlaySha: null,
  distributionSha256: DISTRIBUTION_SHA256,
};

const official: ReleaseProvenanceCompositionV1 = {
  ...community,
  profile: 'official-desktop',
  overlaySha: OVERLAY_SHA,
};

describe('ReleaseProvenanceV1 contract', () => {
  it('keeps the public JSON Schema aligned with the runtime shape', () => {
    const schema = JSON.parse(
      readFileSync(
        new URL(
          '../../../../contracts/release-provenance-v1.schema.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<
        string,
        { pattern?: string; description?: string; enum?: string[] }
      >;
      allOf: Array<{
        if: { properties: { profile: { const: string } } };
        then: { properties: { overlaySha: { type: string } } };
        else: { properties: { overlaySha: { type: string } } };
      }>;
      $comment: string;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(
      new Set([
        'schemaVersion',
        'profile',
        'version',
        'publicSha',
        'overlaySha',
        'distributionSha256',
        'compositionSha256',
      ])
    );
    expect(Object.keys(schema.properties)).toEqual(schema.required);
    expect(schema.allOf).toHaveLength(1);
    expect(schema.allOf[0]?.if.properties.profile.const).toBe('community');
    expect(schema.allOf[0]?.then.properties.overlaySha.type).toBe('null');
    expect(schema.allOf[0]?.else.properties.overlaySha.type).toBe('string');
    expect(schema.properties.profile?.enum).toEqual([
      'community',
      'official-desktop',
    ]);
    expect(
      new RegExp(schema.properties.version?.pattern ?? '').test(
        community.version
      )
    ).toBe(true);
    expect(
      new RegExp(schema.properties.version?.pattern ?? '').test('1.2.3-01')
    ).toBe(false);
    expect(schema.properties.compositionSha256?.description).toContain(
      'lexicographic key order'
    );
    expect(schema.$comment).toBe('SPDX-License-Identifier: Apache-2.0');
    expect(RELEASE_PROVENANCE_PROFILES).toEqual([
      'community',
      'official-desktop',
    ]);
  });

  it('parses both valid profiles without preserving caller-owned objects', () => {
    const parsedCommunity = parseReleaseProvenanceCompositionV1(community);
    const parsedOfficial = parseReleaseProvenanceCompositionV1(official);

    expect(parsedCommunity).toEqual(community);
    expect(parsedCommunity).not.toBe(community);
    expect(parsedOfficial).toEqual(official);
  });

  it.each([
    ['a non-object', null, /must be a JSON object/],
    ['an array', [], /must be a JSON object/],
    [
      'a missing field',
      { ...community, publicSha: undefined },
      /publicSha must be/,
    ],
    [
      'an unknown field',
      { ...community, secret: 'not-part-of-v1' },
      /unknown fields: secret/,
    ],
    [
      'another schema version',
      { ...community, schemaVersion: 2 },
      /schemaVersion must be 1/,
    ],
    [
      'another profile',
      { ...community, profile: 'official-web' },
      /profile must be one of/,
    ],
    [
      'a v-prefixed version',
      { ...community, version: 'v0.2.0' },
      /without a v prefix/,
    ],
    [
      'a leading-zero version',
      { ...community, version: '01.2.3' },
      /without a v prefix/,
    ],
    [
      'a leading-zero numeric prerelease identifier',
      { ...community, version: '1.2.3-01' },
      /without a v prefix/,
    ],
    [
      'an uppercase public SHA',
      { ...community, publicSha: PUBLIC_SHA.toUpperCase() },
      /publicSha must be/,
    ],
    [
      'a prefixed distribution digest',
      { ...community, distributionSha256: `sha256:${DISTRIBUTION_SHA256}` },
      /distributionSha256 must be/,
    ],
    [
      'an overlay on a community build',
      { ...community, overlaySha: OVERLAY_SHA },
      /overlaySha must be null for the community profile/,
    ],
    [
      'no overlay on an official build',
      { ...official, overlaySha: null },
      /overlaySha must be a 40-character lowercase Git SHA/,
    ],
  ])('rejects %s', (_case, value, error) => {
    expect(() => parseReleaseProvenanceCompositionV1(value)).toThrow(error);
  });

  it('requires rather than silently accepting an undefined field', () => {
    const { publicSha: _removed, ...missing } = community;
    expect(() => parseReleaseProvenanceCompositionV1(missing)).toThrow(
      /missing publicSha/
    );
  });
});

describe('canonical release composition hashing', () => {
  it('emits the exact lexicographic, whitespace-free hash payload', () => {
    expect(
      canonicalizeReleaseProvenanceCompositionV1({
        version: community.version,
        overlaySha: null,
        publicSha: PUBLIC_SHA,
        schemaVersion: 1,
        distributionSha256: DISTRIBUTION_SHA256,
        profile: 'community',
      })
    ).toBe(
      `{"distributionSha256":"${DISTRIBUTION_SHA256}","overlaySha":null,"profile":"community","publicSha":"${PUBLIC_SHA}","schemaVersion":1,"version":"0.2.0-beta.1+build.7"}`
    );
  });

  it('has a stable SHA-256 known-answer vector', async () => {
    await expect(hashReleaseProvenanceCompositionV1(community)).resolves.toBe(
      '7aac1497e5380a4a934c5eacc6fed2636d26f3f4c5c7eae8bd0aecc7090da57b'
    );
  });

  it('binds every composition input represented by v1', async () => {
    const variants: ReleaseProvenanceCompositionV1[] = [
      official,
      { ...official, version: '0.2.1' },
      { ...official, publicSha: '1'.repeat(40) },
      { ...official, overlaySha: '2'.repeat(40) },
      { ...official, distributionSha256: 'b'.repeat(64) },
      { ...official, profile: 'community', overlaySha: null },
    ];

    const hashes = await Promise.all(
      variants.map(value => hashReleaseProvenanceCompositionV1(value))
    );
    expect(new Set(hashes).size).toBe(variants.length);
  });

  it('passes the exact canonical UTF-8 bytes to SHA-256', async () => {
    const digest = vi.fn(
      async (_algorithm: AlgorithmIdentifier, bytes: BufferSource) => {
        expect(_algorithm).toBe('SHA-256');
        expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(
          canonicalizeReleaseProvenanceCompositionV1(community)
        );
        return new Uint8Array(32).fill(0xab).buffer;
      }
    );

    await expect(
      hashReleaseProvenanceCompositionV1(community, { digest })
    ).resolves.toBe('ab'.repeat(32));
    expect(digest).toHaveBeenCalledOnce();
  });

  it('creates and verifies an official record', async () => {
    const provenance = await createReleaseProvenanceV1(official);

    expect(provenance).toEqual({
      ...official,
      compositionSha256: await hashReleaseProvenanceCompositionV1(official),
    });
    await expect(verifyReleaseProvenanceV1(provenance)).resolves.toEqual(
      provenance
    );
    expect(parseReleaseProvenanceV1(provenance)).toEqual(provenance);
  });

  it('rejects a structurally valid record whose composition was changed', async () => {
    const provenance = await createReleaseProvenanceV1(official);

    await expect(
      verifyReleaseProvenanceV1({
        ...provenance,
        version: '0.2.1',
      })
    ).rejects.toThrow(/compositionSha256 mismatch/);
  });

  it('rejects malformed and additional fields before verifying the digest', async () => {
    const provenance = await createReleaseProvenanceV1(official);

    await expect(
      verifyReleaseProvenanceV1({
        ...provenance,
        privateTag: 'official/v0.2.0',
      })
    ).rejects.toThrow(/unknown fields: privateTag/);
    await expect(
      verifyReleaseProvenanceV1({
        ...provenance,
        compositionSha256: provenance.compositionSha256.toUpperCase(),
      })
    ).rejects.toThrow(/compositionSha256 must be/);
  });
});
