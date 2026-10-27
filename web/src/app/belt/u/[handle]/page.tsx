import { BeltApp } from '@/components/belt/BeltApp';

export default async function BeltUserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <BeltApp view="user" handle={handle} />;
}
