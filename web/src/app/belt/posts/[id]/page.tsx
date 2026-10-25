import { BeltApp } from '@/components/belt/BeltApp';

export default async function BeltPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BeltApp view="post" postId={id} />;
}
