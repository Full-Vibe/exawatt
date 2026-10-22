/** Reads actual v1 rotor transforms or v2 material shader inputs in the page. */
export function sampleBoardWorkMotion() {
  const before = new Map();
  const v2 =
    document.querySelector('[data-spatial-board]')?.dataset.boardView === 'v2';
  const workingIds = new Set(
    [
      ...document.querySelectorAll(
        '[data-lattice-unit][data-board-work="active"]'
      ),
    ].map(node => node.dataset.latticeUnit)
  );
  window.__EVAL_SCENE__.traverse(node => {
    if (v2 && node.name === 'tile-agent-bodies') {
      const work = node.geometry.getAttribute('aWork');
      const wander = node.geometry.getAttribute('aWander');
      for (let i = 0; i < node.count; i++) {
        if (!workingIds.has(node.userData.boardTileBodyIds?.[i])) continue;
        // Read the actual shader inputs for a working body, not a synthetic clock.
        const reader = {
          get rotation() {
            return { z: (work?.getX(i) ?? 0) + (wander?.getX(i) ?? 0) };
          },
        };
        before.set(reader, reader.rotation.z);
      }
    } else if (
      !v2 &&
      node.name.startsWith('mark:') &&
      node.parent?.geometry?.parameters?.thetaLength === Math.PI
    )
      before.set(node, node.rotation.z);
  });
  return before;
}
