import { BeltApp } from '@/components/belt/BeltApp';

export default async function BeltDirectChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BeltApp view="direct" chatId={id} />;
}
