import { redirect } from 'next/navigation';

/** Retired review candidate. The standing bench now mounts the shipped v2. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string }>;
}) {
  const { fixture = 'fanout' } = await searchParams;
  redirect(
    `/hud-gallery/board-study?${new URLSearchParams({ view: 'v2', material: 'gummy', theme: 'night', fixture })}`
  );
}
