'use client';

import { useMemo, useState } from 'react';
import {
  architectureManifest,
  type ArchitectureConnection,
  type ArchitectureLayer,
  type ArchitectureNode,
  type ArchitectureStatus,
  type ArchitectureZoomKey,
  type ArchitectureZoomLevel,
} from '@/lib/architecture/manifest';

const statusStyle: Record<
  ArchitectureStatus,
  { label: string; border: string; bg: string; text: string }
> = {
  implemented: {
    label: 'Implemented',
    border: '#0ea596',
    bg: 'rgba(14,165,150,0.12)',
    text: '#8ee8dc',
  },
  'active-build': {
    label: 'Active build',
    border: '#d69e2e',
    bg: 'rgba(214,158,46,0.12)',
    text: '#f1d18d',
  },
  designed: {
    label: 'Designed',
    border: '#64748b',
    bg: 'rgba(100,116,139,0.12)',
    text: '#cbd5e1',
  },
};

function getLayer(
  layerKey: ArchitectureNode['layer']
): ArchitectureLayer | null {
  if (!layerKey) {
    return null;
  }

  return (
    architectureManifest.layers.find(layer => layer.key === layerKey) ?? null
  );
}

function getNode(level: ArchitectureZoomLevel, id: string) {
  return level.nodes.find(node => node.id === id)!;
}

function center(node: ArchitectureNode) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function connectionPoints(
  fromNode: ArchitectureNode,
  toNode: ArchitectureNode
) {
  const fromCenter = center(fromNode);
  const toCenter = center(toNode);
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const horizontal = Math.abs(dx) > Math.abs(dy);

  if (horizontal && dx > 0) {
    return {
      from: { x: fromNode.x + fromNode.width, y: fromCenter.y },
      to: { x: toNode.x, y: toCenter.y },
      horizontal,
    };
  }

  if (horizontal) {
    return {
      from: { x: fromNode.x, y: fromCenter.y },
      to: { x: toNode.x + toNode.width, y: toCenter.y },
      horizontal,
    };
  }

  if (dy > 0) {
    return {
      from: { x: fromCenter.x, y: fromNode.y + fromNode.height },
      to: { x: toCenter.x, y: toNode.y },
      horizontal,
    };
  }

  return {
    from: { x: fromCenter.x, y: fromNode.y },
    to: { x: toCenter.x, y: toNode.y + toNode.height },
    horizontal,
  };
}

function ConnectionLine({
  connection,
  level,
}: {
  connection: ArchitectureConnection;
  level: ArchitectureZoomLevel;
}) {
  const fromNode = getNode(level, connection.from);
  const toNode = getNode(level, connection.to);
  const { from, to, horizontal } = connectionPoints(fromNode, toNode);
  const dashed = connection.style === 'dashed';
  const d = horizontal
    ? `M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}`
    : `M${from.x},${from.y} C${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2} ${to.x},${to.y}`;

  return (
    <g>
      <path
        d={d}
        fill="none"
        markerEnd="url(#arrow)"
        stroke={dashed ? '#3f3f46' : '#52525b'}
        strokeDasharray={dashed ? '7 5' : undefined}
        strokeWidth={dashed ? 1.2 : 1.6}
      />
      {connection.label && (
        <text
          x={(from.x + to.x) / 2}
          y={(from.y + to.y) / 2 - 8}
          textAnchor="middle"
          className="fill-neutral-400"
          style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)' }}
        >
          {connection.label}
        </text>
      )}
    </g>
  );
}

function MapNode({
  node,
  selected,
  onSelect,
}: {
  node: ArchitectureNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const layer = getLayer(node.layer);
  const status = node.status ? statusStyle[node.status] : null;
  const accent = status?.border ?? layer?.accent ?? '#d4d4d8';

  return (
    <g
      className="cursor-pointer"
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {selected && (
        <rect
          x={node.x - 5}
          y={node.y - 5}
          width={node.width + 10}
          height={node.height + 10}
          rx={12}
          fill="none"
          opacity={0.55}
          stroke={accent}
          strokeWidth={2}
        />
      )}
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={8}
        fill={selected ? 'rgba(24,24,27,0.98)' : 'rgba(12,12,13,0.96)'}
        stroke={accent}
        strokeOpacity={selected ? 0.95 : 0.45}
        strokeWidth={selected ? 1.7 : 1}
      />
      {status && (
        <circle
          cx={node.x + node.width - 14}
          cy={node.y + 14}
          fill={status.border}
          r={4}
        />
      )}
      <foreignObject
        x={node.x + 14}
        y={node.y + 10}
        width={node.width - 28}
        height={node.height - 20}
      >
        <div className="flex h-full flex-col justify-start overflow-hidden pt-1">
          <div className="text-[14px] font-semibold leading-tight text-neutral-100">
            {node.label}
          </div>
          <div className="mt-1.5 line-clamp-1 text-[12px] leading-snug text-neutral-400">
            {node.summary}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function MobileMap({
  currentLevel,
  selectedId,
  onSelect,
}: {
  currentLevel: ArchitectureZoomLevel;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const unlayeredNodes = currentLevel.nodes.filter(node => !node.layer);
  const layeredGroups = architectureManifest.layers
    .map(layer => ({
      layer,
      nodes: currentLevel.nodes.filter(node => node.layer === layer.key),
    }))
    .filter(group => group.nodes.length > 0);

  return (
    <div className="grid gap-4 p-3 sm:p-4 lg:hidden">
      {unlayeredNodes.length > 0 && (
        <div className="grid gap-3">
          {unlayeredNodes.map(node => (
            <MobileNode
              key={node.id}
              node={node}
              onSelect={onSelect}
              selected={selectedId === node.id}
            />
          ))}
        </div>
      )}

      {layeredGroups.map(group => (
        <section
          className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"
          key={group.layer.key}
        >
          <div
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: group.layer.accent }}
          >
            {group.layer.label}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-neutral-500">
            {group.layer.summary}
          </p>
          <div className="mt-3 grid gap-3">
            {group.nodes.map(node => (
              <MobileNode
                key={node.id}
                node={node}
                onSelect={onSelect}
                selected={selectedId === node.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MobileNode({
  node,
  selected,
  onSelect,
}: {
  node: ArchitectureNode;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const layer = getLayer(node.layer);
  const status = node.status ? statusStyle[node.status] : null;
  const accent = status?.border ?? layer?.accent ?? '#d4d4d8';

  return (
    <button
      className={`min-h-24 rounded-md border bg-[#0c0d0f] p-4 text-left transition-colors active:bg-neutral-900 ${
        selected ? 'border-neutral-300' : 'border-neutral-800'
      }`}
      onClick={() => onSelect(node.id)}
      style={{ borderColor: selected ? accent : undefined }}
      type="button"
    >
      <div className="text-base font-semibold leading-tight text-neutral-100">
        {node.label}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-neutral-400">
        {node.summary}
      </div>
      {status && (
        <div
          className="mt-3 w-fit rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide"
          style={{ backgroundColor: status.bg, color: status.text }}
        >
          {status.label}
        </div>
      )}
    </button>
  );
}

function DetailPanel({
  selectedNode,
  currentLevel,
}: {
  selectedNode: ArchitectureNode | null;
  currentLevel: ArchitectureZoomLevel;
}) {
  if (!selectedNode) {
    return (
      <aside className="min-h-[220px] border-t border-neutral-800 bg-neutral-950/70 p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
          Map Detail
        </div>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-neutral-500">
          Select a node to inspect its role in the{' '}
          {currentLevel.label.toLowerCase()} view.
        </p>
      </aside>
    );
  }

  const layer = getLayer(selectedNode.layer);
  const status = selectedNode.status ? statusStyle[selectedNode.status] : null;

  return (
    <aside className="min-h-[220px] border-t border-neutral-800 bg-neutral-950/70 p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
        Map Detail
      </div>
      <div className="mt-4 flex max-w-5xl flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold leading-tight text-neutral-100">
          {selectedNode.label}
        </h2>
        {status && (
          <span
            className="shrink-0 rounded px-2 py-1 font-mono text-[10px] uppercase"
            style={{ backgroundColor: status.bg, color: status.text }}
          >
            {status.label}
          </span>
        )}
      </div>
      {layer && (
        <div
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: layer.accent }}
        >
          {layer.label}
        </div>
      )}
      <p className="mt-4 max-w-4xl text-base leading-relaxed text-neutral-300">
        {selectedNode.summary}
      </p>
      {selectedNode.parentId && (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-600">
          Parent: {selectedNode.parentId}
        </p>
      )}
    </aside>
  );
}

export default function ArchitecturePage() {
  const [zoomKey, setZoomKey] = useState<ArchitectureZoomKey>('system');
  const [selectedId, setSelectedId] = useState<string | null>('exawatt');

  const currentLevel = useMemo(
    () =>
      architectureManifest.zoomLevels.find(level => level.key === zoomKey) ??
      architectureManifest.zoomLevels[0],
    [zoomKey]
  );

  const selectedNode = selectedId
    ? (currentLevel.nodes.find(node => node.id === selectedId) ?? null)
    : null;

  function selectZoom(nextZoomKey: ArchitectureZoomKey) {
    const nextLevel =
      architectureManifest.zoomLevels.find(
        level => level.key === nextZoomKey
      ) ?? architectureManifest.zoomLevels[0];

    setZoomKey(nextZoomKey);
    setSelectedId(nextLevel.nodes[0]?.id ?? null);
  }

  return (
    <main
      className="min-h-screen bg-[var(--exa-public-exhibition-canvas)] text-neutral-100"
      data-public-exhibition-surface="true"
    >
      <div className="mx-auto flex max-w-[1480px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Public Architecture Map
            </div>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight text-neutral-50 md:text-5xl">
              {architectureManifest.title}
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-neutral-400">
              {architectureManifest.summary}
            </p>
          </div>

          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600">
            Reviewed {architectureManifest.lastReviewed}
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-neutral-800 bg-[#0b0c0d]">
          <div className="grid gap-4 border-b border-neutral-800 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                {currentLevel.label}
              </div>
              <h2 className="mt-1 text-2xl font-semibold text-neutral-100">
                {currentLevel.title}
              </h2>
              <p className="mt-2 max-w-4xl text-base leading-relaxed text-neutral-400">
                {currentLevel.summary}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-1 sm:flex sm:flex-wrap">
              {architectureManifest.zoomLevels.map(level => (
                <button
                  aria-pressed={level.key === zoomKey}
                  className={`min-h-11 rounded px-3 text-sm font-medium transition-colors sm:min-w-24 ${
                    level.key === zoomKey
                      ? 'bg-neutral-100 text-neutral-950'
                      : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200'
                  }`}
                  key={level.key}
                  onClick={() => selectZoom(level.key)}
                  type="button"
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="hidden overflow-x-auto lg:block">
              <svg
                aria-label={`${currentLevel.title} diagram`}
                className="h-auto w-full min-w-[1080px]"
                role="img"
                viewBox={`0 0 ${currentLevel.canvas.width} ${currentLevel.canvas.height}`}
              >
                <defs>
                  <marker
                    id="arrow"
                    markerHeight="6"
                    markerWidth="8"
                    orient="auto"
                    refX="7"
                    refY="3"
                  >
                    <polygon fill="#52525b" points="0 0, 8 3, 0 6" />
                  </marker>
                  <pattern
                    id="map-grid"
                    width="32"
                    height="32"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 32 0 L 0 0 0 32"
                      fill="none"
                      stroke="#141518"
                      strokeWidth="0.6"
                    />
                  </pattern>
                </defs>

                <rect
                  fill="url(#map-grid)"
                  height={currentLevel.canvas.height}
                  width={currentLevel.canvas.width}
                />

                {currentLevel.bands?.map(band => {
                  const layer = getLayer(band.layer)!;

                  return (
                    <g key={`${currentLevel.key}-${band.layer}`}>
                      <rect
                        fill={layer.color}
                        height={band.height}
                        rx={14}
                        stroke={layer.accent}
                        strokeOpacity={0.16}
                        width={currentLevel.canvas.width - 48}
                        x={24}
                        y={band.y}
                      />
                      <text
                        className="fill-neutral-500"
                        style={{
                          fontFamily: 'var(--font-geist-mono)',
                          fontSize: 13,
                          fontWeight: 700,
                          letterSpacing: '0.16em',
                          textTransform: 'uppercase',
                        }}
                        x={44}
                        y={band.y + 24}
                      >
                        {layer.label}
                      </text>
                    </g>
                  );
                })}

                {currentLevel.connections.map(connection => (
                  <ConnectionLine
                    connection={connection}
                    key={`${currentLevel.key}-${connection.from}-${connection.to}`}
                    level={currentLevel}
                  />
                ))}

                {currentLevel.nodes.map(node => (
                  <MapNode
                    key={`${currentLevel.key}-${node.id}`}
                    node={node}
                    onSelect={() =>
                      setSelectedId(selectedId === node.id ? null : node.id)
                    }
                    selected={selectedId === node.id}
                  />
                ))}
              </svg>
            </div>

            <MobileMap
              currentLevel={currentLevel}
              onSelect={nodeId =>
                setSelectedId(selectedId === nodeId ? null : nodeId)
              }
              selectedId={selectedId}
            />

            <DetailPanel
              currentLevel={currentLevel}
              selectedNode={selectedNode}
            />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="rounded-lg border border-neutral-800 bg-[#0b0c0d] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-400">
              Dynamic Range
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {architectureManifest.dynamicRange.map(item => (
                <div key={item.label}>
                  <h3 className="text-lg font-semibold text-neutral-100">
                    {item.label}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500">
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-[#0b0c0d] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-400">
              Architecture Rules
            </h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {architectureManifest.principles.map(principle => (
                <div
                  className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-3 text-sm leading-relaxed text-neutral-300"
                  key={principle}
                >
                  {principle}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
