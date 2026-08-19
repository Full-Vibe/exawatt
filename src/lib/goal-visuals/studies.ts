/**
 * Fixed identities for the `/hud-gallery` goal-visual language studies.
 *
 * The gallery bench is the second caller of the goal-visual service, and it
 * sends the same request as the product does: `{ schemaVersion, identityKey }`
 * and nothing else (BUG-091). A study therefore cannot name itself in the
 * request, so its identity is written down here and the service maps the key
 * back to the study recipe it generates from.
 *
 * These are not arbitrary constants. Each is the SHA-256 the hosted route used
 * to derive server-side from the study's retired `{ projectKey, label }` pair,
 * so every study image already generated and cached under that key is still
 * found. `studies.test.ts` recomputes them from that construction; treat a
 * failure there as "this table was edited", never as "regenerate the table".
 */
export const GOAL_VISUAL_STUDY_IDENTITIES = {
  'graphic:0':
    '55d5585dcf3f7a623ccbad4912cddd62ae400f7e6ab04e4070caf89212a184a0',
  'graphic:1':
    '161af1c89627de595d384e67585abf2ea381f3700780681ca22a226e35eb46fc',
  'graphic:2':
    'e3412fc9997b16f28230ea24d38f2692d207b0974f235544a1fcac965e51eb15',
  'metaphor:0':
    'c4b7a551504449081fb6d2747da906ef1b67a45c844e10b2826bd4225c92946e',
  'metaphor:1':
    '64fe9cb7963c134eb7a28186351ca5e7d1fe4f479a98e60338251ca77017eb27',
  'metaphor:2':
    '9e018084f995b06a52df9d5a0577532520b28da066791d24051bf7b99a180393',
  'still-life:0':
    '0183b0635738c098086373bc55c21d75b4825f73f4e160a9faee02df8cc04c7a',
  'still-life:1':
    '4eeb6ea2c15fc505c70084f1c40b604ce64ddf1a7d3014e49dc4a531ab2dff1a',
  'still-life:2':
    '561cc00d73cd5b28daa790817bc43abbc4ee86b883572f9713d78217ad259180',
  'noun-place:0':
    'fe77c4d1f7980a8b0f218ef9ba0182ce1fcf37895fc6ae5447f30335af78c0a2',
  'noun-place:1':
    'fbd2e406c5f57d17502a4f4c4141637742cba1df22c2c1fe7896efe35783bd63',
  'noun-place:2':
    '9205089873d3314bd10d110fdc1b28a8e260cadb270a5d89b8f15bc0e7c1f0e3',
  'artifact:0':
    '1916afa1c40712306f8b5a8a84c4a4e1ed3c4b8eaa6b48690e7cbf05f750bd71',
  'artifact:1':
    '75fdc029d6f8bf023542dae5fab7e289676eead1cb689314fe914b92fdd7980e',
  'artifact:2':
    'f786a575d4ea3208a529a9859fcfb759fb6d6c9157f2282d0ab1e7ea6051c52c',
  'collage:0':
    'c73a23554f2f2cf26c686593445fb37f25b1d1ba2ddc499f203ecd50dcb06ae4',
  'collage:1':
    '64ea6424a024e88fae8bfbbdf31930336ac0ae3a74ac3a90526dd848961f87ee',
  'collage:2':
    'b8004b5c7728d5e92b70ac3c5c7e408c4680b977676558f7b78c54dfaf5f5e9c',
  'diagram-landscape:0':
    '7cd9f4c2f62d4d41d565427b0957766caeea7452dad61d6088cf1882218f9786',
  'diagram-landscape:1':
    'e82d8b3f9a0af874c0d51255b30138f7ba05e3c4e158379ceafb5417c2343c40',
  'diagram-landscape:2':
    '3b58e7606350c595170161dd4bbd4ab6fef20097db5ecd96554fa00317a53fc4',
} as const satisfies Record<string, string>;

export type GoalVisualStudyId = keyof typeof GOAL_VISUAL_STUDY_IDENTITIES;
